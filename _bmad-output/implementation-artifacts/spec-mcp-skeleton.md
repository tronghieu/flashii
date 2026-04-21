---
title: 'MCP Server Skeleton (G1)'
type: 'feature'
created: '2026-04-21'
status: 'done'
baseline_commit: 'NO_VCS'
context:
  - '{project-root}/_bmad-output/planning-artifacts/product-brief.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Author needs a working MCP backend that Claude Desktop/iOS can connect to today, so the conversational-review hypothesis (Brief §8 risk #1) can be validated within 3 days using real cards. Without this skeleton no other goal in the roadmap can ship.

**Approach:** Bootstrap a single Cloudflare Worker exposing three MCP tools (`add_card` text-only, `get_due`, `submit_rating`) over Streamable HTTP with bearer-token auth. Storage is Turso (libSQL) via `@libsql/client/web`. Scheduling is `ts-fsrs` v5 wrapped as a pure function. Defer image generation, `add_from_text`, polish tools, and CLI to G2–G4 (see `deferred-work.md`).

## Boundaries & Constraints

**Always:**
- `src/core/` is pure TS — no imports from `infra/` or `adapters/`. Data in, data out.
- `reviews` table is append-only. `cards` FSRS columns are a materialized snapshot rebuildable from `reviews`.
- All DB writes that touch FSRS state happen in a single `db.batch([...], 'write')` (atomic INSERT review + UPDATE card).
- Every tool input is validated with Zod before reaching `core/`.
- Bearer-token check runs once in Hono middleware; `user_id` flows to tool handlers via `agents/mcp` `authContext`.
- Tag filter queries pass tags as a single JSON-encoded parameter into `json_each(?)`. Never interpolate tag strings into SQL.
- Secrets (`TURSO_URL`, `TURSO_TOKEN`) only via `wrangler secret put` / `.dev.vars`. Never commit.

**Ask First:**
- Adding any new tool beyond the three named above.
- Switching MCP transport, auth scheme, or replacing `agents/mcp` `createMcpHandler` with a different wiring.
- Schema changes after the first migration is applied to remote Turso.

**Never:**
- No image generation, R2 upload, or Gemini calls (G2).
- No `add_from_text`, `edit_card`, `regenerate_image`, `suspend_card`, `get_progress`, `explain_mistake` (G2/G3).
- No Durable Objects, no OAuth, no login UI, no web app surface.
- No reimplementing FSRS — call `ts-fsrs` directly.
- No ORM. Raw SQL with parameter binding.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| `add_card` happy path | Valid bearer, `{front, back, examples[2-3], tags[]}` | INSERT card with `state=New`, `due_at=now`, `stability=0`, `difficulty=0`; return `{id, due_at}` | N/A |
| `add_card` missing required field | Bearer OK, `back` empty | Zod rejects → MCP error message naming the field | No DB write |
| `get_due` no filter | Valid bearer | Return cards where `user_id=me AND status='ready' AND due_at<=now`, ordered by `due_at`, limit 20 | N/A |
| `get_due` with tags | Valid bearer, `tags=["AI"]` | Return only cards whose `tags` JSON array contains any supplied tag | N/A |
| `submit_rating` happy path | Valid bearer, `{card_id, rating:1\|2\|3\|4}`, card belongs to user | `db.batch`: INSERT reviews row + UPDATE cards FSRS columns; return `{due_at, stability, difficulty}` | N/A |
| `submit_rating` foreign card | Bearer of user A, `card_id` belongs to user B | MCP error "card not found"; no write | 404-style error |
| Missing/invalid bearer | No `Authorization` or unknown token hash | HTTP 401 from Hono middleware before MCP handler runs | No DB read |
| Turso transient failure | First call to `db.execute` throws | Retry once after 100 ms; surface error if it fails again | Logged to `console` |

</frozen-after-approval>

## Code Map

- `package.json` -- deps, scripts (dev/deploy/migrate/typecheck)
- `wrangler.jsonc` -- Worker config (compat date, vars, custom domain placeholder, observability)
- `tsconfig.json` -- strict ESM TS targeted at Workers
- `.dev.vars.example` -- template for local secrets
- `migrations/0001_init.sql` -- users / cards / reviews schema + indexes from `architecture.md` §3
- `scripts/migrate.ts` -- read `migrations/*.sql` in order, apply via `@libsql/client` against `TURSO_URL`
- `scripts/issue-key.ts` -- generate 32-byte API key, print once, INSERT users row with sha256 hash (used by author to seed himself; not the G4 CLI)
- `src/core/types.ts` -- `Card`, `Review`, `User`, `Rating`, `CardState` shapes
- `src/core/fsrs.ts` -- pure `schedule(state, rating, now) => {next, log}` wrapping `ts-fsrs` v5
- `src/core/cards.ts` -- pure `buildNewCard(input, userId, now)`, `tagFilterArgs(tags)`
- `src/core/reviews.ts` -- pure `applyRating(currentState, rating, now)` returning the row deltas
- `src/infra/db.ts` -- `getDb(env)` lazy per-isolate client cache; uses `@libsql/client/web`
- `src/infra/auth.ts` -- `resolveUserId(env, bearerToken) => string | null` (sha256 lookup)
- `src/adapters/mcp.ts` -- `createServer()` registering `add_card`, `get_due`, `submit_rating` via `server.registerTool` with Zod input + `outputSchema`; reads `user_id` from `getMcpAuthContext()`; calls `core/` + `infra/db.ts`
- `src/index.ts` -- Hono app: `/health`, `/mcp` route mounts `createMcpHandler(server, { authContext: ... })` after bearer middleware

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- pin deps: `hono ^4.12`, `@modelcontextprotocol/sdk ^1.29`, `agents ^0.11`, `@libsql/client ^0.17`, `ts-fsrs ^5.3`, `zod ^4`; devDeps `wrangler ^4.84`, `@cloudflare/workers-types`, `typescript ^5.6`
- [x] `tsconfig.json` -- strict, ESM, `moduleResolution: Bundler`, Workers types
- [x] `wrangler.jsonc` -- name `flashii-api`, main `src/index.ts`, latest compat date, observability on
- [x] `.dev.vars.example` + `.gitignore` (ignore `.dev.vars`, `node_modules`, `local.db*`)
- [x] `migrations/0001_init.sql` -- create `users`, `cards`, `reviews`, `idx_cards_due`, `idx_reviews_user_time` exactly as architecture §3
- [x] `scripts/migrate.ts` -- read SQL files in lexical order; track applied versions in `schema_migrations(version, applied_at)`; idempotent
- [x] `scripts/issue-key.ts` -- arg `--name`; print key once, store hash
- [x] `src/core/types.ts` -- types for User, Card, Review, Rating (1|2|3|4), CardState
- [x] `src/core/fsrs.ts` -- export `schedule(state | null, rating, now)`; `enable_fuzz: true`, `request_retention: 0.9`; pure
- [x] `src/core/cards.ts` + `src/core/reviews.ts` -- pure helpers, no I/O
- [x] `src/infra/db.ts` -- WeakMap-cached client per `env`; uses `/web` subpath
- [x] `src/infra/auth.ts` -- `sha256` via Web Crypto; SELECT `id FROM users WHERE api_key_hash=?`
- [x] `src/adapters/mcp.ts` -- register three tools with Zod input + `outputSchema` + `structuredContent`; annotations: `add_card.destructiveHint:false idempotentHint:false`, `get_due.readOnlyHint:true`, `submit_rating.destructiveHint:false idempotentHint:false`
- [x] `src/index.ts` -- Hono `/health` returns `{ok:true}`; `/mcp` runs bearer middleware then `createMcpHandler(createServer(), { authContext: { userId } })`
- [x] `tests/fsrs.test.ts` + `tests/cards.test.ts` -- vitest unit tests for I/O matrix happy-path and edge-case rows that hit pure `core/` (skip rows that need DB/HTTP)

**Acceptance Criteria:**
- Given a clean checkout, when `pnpm install && pnpm typecheck && pnpm test` runs, then all pass with zero TS errors and all unit tests green.
- Given `turso dev` running locally and a seeded user via `scripts/issue-key.ts`, when `wrangler dev` is up and a Streamable HTTP MCP client posts a `tools/list` to `/mcp` with the bearer token, then it receives the three tool definitions including their `outputSchema`.
- Given Claude Desktop is connected to the local URL with the bearer in its connector config, when the author asks Claude "add a card for the chunk 'fine-tune a model'" and approves, then a row appears in `cards` and Claude's `add_card` call returns the new id within 2 s.
- Given at least one card exists with `due_at <= now`, when `get_due` is called with no filter, then the row is returned; with `tags:["AI"]` filter, only cards tagged AI are returned.
- Given a card returned by `get_due`, when `submit_rating` is called with `rating:3`, then a `reviews` row is inserted, the card's `due_at`/`stability`/`difficulty` are updated atomically (single `db.batch`), and the response carries the new `due_at`.
- Given a bearer that doesn't match any `users.api_key_hash`, when any MCP request is made, then the response is HTTP 401 and no DB query against `cards`/`reviews` runs.

## Spec Change Log

### 2026-04-21 — Review iteration 1 (patches only, no loopback)

Findings from blind hunter, edge case hunter, and acceptance auditor. No `intent_gap` or `bad_spec` triggered, so the frozen intent stayed locked. Patches applied directly, defers appended to `deferred-work.md`.

Patches:
- `src/infra/db.ts`: renamed `withRetry` → `withReadRetry`; only retries reads, logs `console.warn` on retry. Reason: the old wrapper retried any error including non-idempotent `db.batch` writes, which on a transient post-commit failure would either double-INSERT or fail with PK conflict on the second attempt and surface a spurious user error.
- `src/adapters/mcp.ts`: `add_card` and `submit_rating` no longer wrap their writes in any retry. `submit_rating`'s pre-check SELECT and `get_due` SELECT use `withReadRetry`. `submit_rating` now returns `{isError:true, content:[…]}` for missing/cross-user cards instead of throwing. `examples` Zod min raised from 1 to 2 to match the frozen "examples[2-3]" contract.
- `src/core/cards.ts`: `rowToCard` wraps JSON.parse for `examples`/`tags` in try/catch (defaults to `[]` on bad data) so one corrupt row no longer poisons the whole `get_due` response. Empty/whitespace `last_reviewed_at` strings normalized to `null` so `new Date('')` (Invalid Date → NaN) never reaches FSRS.
- `scripts/migrate.ts`: replaced `sql.split(/;\s*\n/)` with libSQL `executeMultiple`, wrapped each migration body + the version-row INSERT in `BEGIN/COMMIT`. Reason: the old splitter would shred future migrations containing semicolons inside trigger bodies or string literals, and partial application left the schema-versions table out of sync.

KEEP (must survive any re-derivation):
- `core/` purity (no `infra`/`adapters` imports anywhere under `src/core/`).
- Single `db.batch([INSERT review, UPDATE card], 'write')` in `submit_rating`.
- Bearer middleware-then-mount pattern in `src/index.ts`.
- Tag filter implemented as `?3 = '[]' OR EXISTS (json_each(c.tags) JOIN json_each(?3))`, never via string interpolation.

## Design Notes

**Why `agents/mcp` `createMcpHandler` instead of bare SDK transport:** Cloudflare's `agents@^0.11.4` exports a stateless `createMcpHandler(server, opts)` that returns a `(req, env, ctx) => Response` — exactly what a Hono route needs. No Durable Object, no session storage. Auth context flows in through `opts.authContext`, retrieved inside tools via `getMcpAuthContext()`. This is the path the Cloudflare docs explicitly recommend for stateless servers.

**FSRS pure-function wrapper (matches architecture.md §5, ts-fsrs v5 API):**
```ts
import { fsrs, generatorParameters, createEmptyCard, Rating, type Card } from 'ts-fsrs';
const f = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));
export function schedule(state: CardState | null, rating: Rating, now: Date) {
  const card: Card = state ? hydrate(state) : createEmptyCard(now);
  return f.next(card, now, rating); // → { card, log }
}
```
Persist `state`, `elapsed_days`, `scheduled_days` alongside stability/difficulty/due — dropping them degrades scheduling accuracy.

**Tag filter (parameterized, injection-safe):**
```sql
SELECT c.* FROM cards c
WHERE c.user_id = ? AND c.status = 'ready' AND c.due_at <= ?
  AND (?2 = '[]' OR EXISTS (
    SELECT 1 FROM json_each(c.tags) ct JOIN json_each(?2) qt ON qt.value = ct.value
  ))
ORDER BY c.due_at LIMIT ?
```
Tags arrive as `JSON.stringify(tags ?? [])` — one bind, no string interpolation.

## Verification

**Commands:**
- `pnpm install` -- expected: lockfile written, no peer-dep errors
- `pnpm typecheck` -- expected: 0 errors (`tsc --noEmit`)
- `pnpm test` -- expected: vitest green for `core/` units
- `pnpm migrate` (against local `turso dev`) -- expected: `schema_migrations` row for `0001_init` after first run, no-op on second run
- `pnpm dev` (`wrangler dev`) -- expected: `/health` returns `{ok:true}`; `/mcp` returns 401 without bearer, returns tool list with valid bearer
- `pnpm deploy` -- not required to pass for spec acceptance, but the script must exist and `wrangler deploy --dry-run` succeeds

**Manual checks:**
- Connect Claude Desktop's custom MCP connector to the local `wrangler dev` URL with the issued bearer; confirm three tools appear and a round trip of add → due → rate completes end-to-end on one real card.

## Suggested Review Order

**Entry point — request lifecycle**

- Hono app: bearer middleware then per-request `createMcpHandler`. Single mount point for all auth.
  [`index.ts:14`](../../src/index.ts#L14)

**MCP tool surface (the user-visible API)**

- `add_card` registration: Zod input, `outputSchema`, annotations, raw INSERT (no retry on writes).
  [`mcp.ts:43`](../../src/adapters/mcp.ts#L43)
- `get_due` registration: tag-filter SQL with `json_each` parameterized branch.
  [`mcp.ts:106`](../../src/adapters/mcp.ts#L106)
- `submit_rating`: read-then-batch pattern; not-found returns tool-error not throw.
  [`mcp.ts:170`](../../src/adapters/mcp.ts#L170)

**Pure domain (the only logic worth unit-testing)**

- FSRS pure wrapper around ts-fsrs v5; module-level scheduler instance.
  [`fsrs.ts:16`](../../src/core/fsrs.ts#L16)
- `applyRating` returns the deltas the adapter atomically applies — keeps the SQL caller dumb.
  [`reviews.ts:34`](../../src/core/reviews.ts#L34)
- `buildNewCard` + ULID-ish id generator + safe `rowToCard` (try/catch JSON, null-empty timestamps).
  [`cards.ts:27`](../../src/core/cards.ts#L27)

**Persistence boundary**

- Per-isolate libSQL client cache via `@libsql/client/web`.
  [`db.ts:7`](../../src/infra/db.ts#L7)
- `withReadRetry` — reads only, logs warn on retry. Writes are never retried.
  [`db.ts:18`](../../src/infra/db.ts#L18)
- Bearer → user_id via SHA-256 lookup; Web Crypto only.
  [`auth.ts:9`](../../src/infra/auth.ts#L9)

**Schema & migrations**

- Schema (users / cards / reviews + indexes). Note FSRS columns added beyond architecture §3.
  [`0001_init.sql:3`](../../migrations/0001_init.sql#L3)
- Migration runner: `executeMultiple` inside `BEGIN/COMMIT`; idempotent via `schema_migrations`.
  [`migrate.ts:64`](../../scripts/migrate.ts#L64)
- API key issuance script (single-shot CLI; the proper CLI lands in G4).
  [`issue-key.ts:69`](../../scripts/issue-key.ts#L69)

**Tests & config (peripherals)**

- Unit tests for the only pure surface — `core/`.
  [`fsrs.test.ts:1`](../../tests/fsrs.test.ts#L1)
  [`cards.test.ts:1`](../../tests/cards.test.ts#L1)
- Pinned dependency versions and dev/deploy scripts.
  [`package.json:1`](../../package.json#L1)
- Worker config — compat date, `nodejs_compat`, observability.
  [`wrangler.jsonc:1`](../../wrangler.jsonc#L1)
