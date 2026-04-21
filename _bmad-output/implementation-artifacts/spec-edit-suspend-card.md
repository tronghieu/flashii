---
title: 'edit_card + suspend/unsuspend/delete_card MCP tools'
type: 'feature'
created: '2026-04-21'
status: 'in-progress'
baseline_commit: '23a10b7'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture.md'
  - '{project-root}/_bmad-output/planning-artifacts/product-brief.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Cards are write-once today. Claude cannot fix a typo, retag, pull a card out of rotation, put it back, or remove a mistake. Brief §7 Week 3 lists `edit_card` + `suspend_card`; `unsuspend_card` + `delete_card` are added here to close the lifecycle.

**Approach:** Four MCP tools. `edit_card` mutates any subset of `{front, back, ipa, examples, tags}` — status is not editable via edit (dedicated verbs own it). `suspend_card` / `unsuspend_card` flip `status` between `suspended` and `ready`. `delete_card` hard-deletes the `cards` row and all its `reviews` rows in one batch — no soft-delete, no audit. Also fold the deferred review finding: `submit_rating` rejects non-ready cards.

## Boundaries & Constraints

**Always:**
- Tenant isolation: every mutation has `WHERE id=? AND user_id=?`. Cross-tenant miss returns "not found" — never leak existence.
- `edit_card` requires at least one editable field (Zod refine).
- `edit_card` does **not** touch `status`, `image_url`, FSRS columns, or `created_at`.
- `delete_card` removes `cards` row + all `reviews` rows in one `db.batch`; `destructiveHint: true`, description tells Claude to confirm first.
- `submit_rating` rejects `status != 'ready'` with a message naming the card and how to unsuspend.

**Ask First:**
- Enabling `PRAGMA foreign_keys = ON`. Current stance: explicit batch in `delete_card`.

**Never:**
- No bulk ops, no audit table, no partial FSRS reset, no soft-delete, no cross-tool transactions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|---------------|----------------------------|
| Edit fields | `edit_card{card_id, front?, back?, ipa?, examples?, tags?}` (≥1 field) | UPDATE listed columns, re-SELECT, return `fullCardShape`. Tags overwrite, not merge. |
| Edit empty | `edit_card{card_id}` | Zod refine rejects: "at least one field required" |
| Suspend / Unsuspend | `suspend_card{card_id}` / `unsuspend_card{card_id}` | UPDATE status; idempotent (ok if already in target state); return `fullCardShape` |
| Delete happy | `delete_card{card_id}` | SELECT ownership check → `db.batch(DELETE reviews, DELETE cards)` → `{id, deleted:true, reviews_deleted:N}` |
| Not found / cross-tenant | any mutation, bad id | `isError` "Card not found: <id>" |
| Rate non-ready card | `submit_rating` when `status != 'ready'` | `isError` "Card is suspended: <id>. Call `unsuspend_card` first." No reviews row. |

</frozen-after-approval>

## Code Map

- `src/core/cards.ts` -- **extend**. Add `buildCardUpdate(input) -> { setClauses: string[], bindArgs: unknown[] }` pure helper. Handles editable fields → SQL column mapping + JSON-encoding of `examples`/`tags`. Throws on empty input. `status` is *not* an input here — dedicated tools set it via their own one-line UPDATE.
- `src/adapters/mcp.ts` -- **extend**. Register `edit_card`, `suspend_card`, `unsuspend_card`, `delete_card`. Add a status guard in `submit_rating`.
- `tests/cards.test.ts` -- **extend**. Unit-test `buildCardUpdate`: single field, multi-field, tags/examples JSON encoding, empty input throws.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/cards.ts` -- add `buildCardUpdate(input: { front?, back?, ipa?, examples?, tags? })`. Throws `Error('no editable fields')` if no field present. Returns `{ setClauses, bindArgs }` with `examples`/`tags` JSON-stringified.
- [x] `src/adapters/mcp.ts` -- register `edit_card` tool. Input: `card_id` + optional `front`, `back`, `ipa`, `examples`, `tags`. Zod refine requires at least one optional field set. Handler: `buildCardUpdate` → `UPDATE cards SET ... WHERE id=? AND user_id=?` → if `rowsAffected === 0` return `isError` "Card not found"; else `SELECT * FROM cards WHERE id=? AND user_id=?` → return `fullCardShape`.
- [x] `src/adapters/mcp.ts` -- register `suspend_card` + `unsuspend_card`. Input: `card_id`. Handler: `UPDATE cards SET status=? WHERE id=? AND user_id=?` with `'suspended'` / `'ready'` respectively. Same not-found handling as `edit_card`. Re-SELECT and return `fullCardShape`.
- [x] `src/adapters/mcp.ts` -- register `delete_card` tool. Input: `card_id`. `destructiveHint: true`. Handler: first `SELECT id FROM cards WHERE id=? AND user_id=?` to confirm ownership (return `isError` "Card not found" on miss); then `db.batch([{DELETE FROM reviews WHERE card_id=? AND user_id=?}, {DELETE FROM cards WHERE id=? AND user_id=?}], 'write')`. Output: `{ id, deleted: true, reviews_deleted: number }` using `rowsAffected` from the first statement. Description must tell Claude to confirm with the user first.
- [x] `src/adapters/mcp.ts` -- in `submit_rating`, after the SELECT, if `card.status !== 'ready'` return `isError` with "Card is suspended: <id>. Call `unsuspend_card` first." Place the check before `applyRating` so no FSRS work is wasted.
- [x] `tests/cards.test.ts` -- add tests for `buildCardUpdate` (single, multi, JSON encoding, empty throws).
- [ ] Manual: via Claude, add a card → `edit_card` to fix a typo → `list_cards` to verify → `suspend_card` → `get_due` confirms exclusion → `submit_rating` on suspended card returns the clear error → `unsuspend_card` restores it → `delete_card` removes it → `list_cards` confirms it's gone and Turso has no orphan reviews.

**Acceptance Criteria:**
- Given a card owned by user A, when user B calls any of `edit_card`/`suspend_card`/`unsuspend_card`/`delete_card` with that card_id, then response is "Card not found" — existence is not leaked.
- Given `edit_card({card_id, front:"X"})`, when it succeeds, then `front='X'` and all other columns (status, FSRS state, due_at, image_url, created_at) are byte-identical to before.
- Given a suspended card, when `get_due` runs, then the card is not returned (existing `status='ready'` filter already covers this).
- Given a suspended card, when `submit_rating` is called, then it errors with the unsuspend hint, and no `reviews` row is inserted.
- Given `unsuspend_card` on a suspended card, when it succeeds, then `get_due` returns it again at the next query (assuming due_at has passed).
- Given `delete_card` on a card with N historical reviews, when it succeeds, then `cards` has no row for that id AND `reviews` has zero rows for that card_id; response reports `reviews_deleted = N`.

## Spec Change Log

**2026-04-21 — implementation deviations (non-frozen)**
- `edit_card` validation: Zod `.refine()` on a whole object is not expressible when `inputSchema` is a **shape object** (not a `z.object(...)`). Replaced with a runtime precheck in the handler that returns the same spec message: "at least one of front/back/ipa/examples/tags is required". Semantics preserved.
- Extracted `setCardStatus(cardId, status)` local helper inside `createServer()` to avoid duplicating the UPDATE + re-SELECT + `fullCardShape` mapping between `suspend_card` and `unsuspend_card`.

## Design Notes

**Dedicated verbs over enum:** specific tool names improve Claude's routing and let `destructiveHint` apply only where it belongs (`delete_card`).

**Tags overwrite, not merge:** Claude can read current tags from `list_cards` and compose the final set; merge semantics would double the tool surface for no gain.

**Explicit DELETE batch over FK cascade:** FK enforcement is off in libsql; an explicit batch is self-contained. Revisit if a second DELETE path appears.

**Re-SELECT after UPDATE:** one extra round-trip guarantees the returned row matches what `list_cards` would return — no adapter/DB drift.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean.
- `npx vitest run` -- expected: all existing tests still pass + new `buildCardUpdate` tests green.

**Manual checks:**
- Flow described in the last Execution bullet, run via Claude Desktop with `wrangler dev`.
