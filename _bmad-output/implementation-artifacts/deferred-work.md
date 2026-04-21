# Deferred Work

Goals split out of the initial scope. Pick up after the active spec is shipped.

## From: spec-mcp-skeleton (2026-04-21)

Source: `_bmad-output/planning-artifacts/product-brief.md` §7 Roadmap

### G2 — Image generation (Week 2)
- ~~Integrate Gemini Nano Banana Pro for `needs_image=true` flow~~ → split into spec-image-pipeline (2026-04-21)
- ~~R2 upload pipeline (`bucket/user_id/card_id.png`)~~ → split into spec-image-pipeline (2026-04-21)
- `add_from_text` tool (paragraph → candidate chunks via simple tokenization) — **deferred**: brief notes server-side is "simple tokenization", but Claude can already extract chunks conversationally without a server tool. Revisit only if user reports the conversational flow is too slow.
- Validate Claude iOS Connector mobile flow — manual test; not a code task.
- **Depends on**: G1 (MCP skeleton)

### G3 — Polish tools (Week 3) — split per goal (2026-04-21)
- `edit_card` + `suspend_card` — small CRUD spec, independent of image pipeline.
- ~~`regenerate_image`~~ — **shipped 2026-04-21** alongside the edit/suspend/delete tool batch. Reuses `generateImage` + `storeImage` from the image pipeline; overwrites the R2 object at the same `{userId}/{cardId}.png` key. Fails fast (returns error, keeps old `image_url`) — different from `add_card` which is fail-open — because user explicitly requested the regeneration.
- `get_progress` — single aggregation query; standalone spec.
- `explain_mistake` — re-evaluate need; brief says "mostly Claude-side". Likely delete from roadmap if Claude can self-coach from `get_progress` + conversation context.
- Usage logging + cost monitoring — cross-cutting infra; defer until first cost surprise.
- **Depends on**: G1, partially spec-image-pipeline (`regenerate_image` only).

### G4 — Family CLI (Week 4+)
- CLI: `flashii user add "<name>"` → issue API key
- Export command for data portability
- **Depends on**: G1

## From: spec-mcp-skeleton review (2026-04-21)

Surfaced by step-04 reviewers; not blockers for G1 (single-user MVP).

- **Concurrent submit_rating race**: SELECT-then-batch-write in `src/adapters/mcp.ts` is not under a single transaction. Two parallel calls on the same card would drift `cards` snapshot from `reviews` log. Mitigation later: optimistic concurrency (UPDATE … WHERE last_reviewed_at IS ?prev) or interactive transaction. Likelihood with one human + one Claude session is ~0; revisit when family joins (G4).
- **`submit_rating` should reject `status='suspended'` cards**: Add `AND status='ready'` to the SELECT. Fold into G3 alongside `suspend_card`.
- **Foreign key enforcement**: `cards.user_id` and `reviews.user_id`/`card_id` reference `users(id)` but SQLite FK enforcement is off by default; libSQL `/web` doesn't auto-enable it. No DELETE flows exist yet, so no orphan risk today. Enable `PRAGMA foreign_keys = ON` per request when adding any DELETE in G3+.
- **CORS / OPTIONS preflight on `/mcp`**: `app.all('/mcp')` returns 401 with no `Access-Control-Allow-*` headers, blocking browser-based MCP clients. Claude Desktop / iOS / Code are not browsers, so MVP is unaffected. Add CORS middleware before the bearer check when (if) a web app is built.
- **DB client cache key**: `WeakMap<env, Client>` may miss when Workers hands a fresh `env` object per fetch. Perf-only (extra `createClient` calls), not correctness. Switch to a module-level `Map<string, Client>` keyed by `env.TURSO_URL` if traffic shows churn.
- **`scripts/issue-key.ts` print-after-insert**: If stdout fails (EPIPE) after the `INSERT users` succeeded but before `console.log(api_key)`, the plaintext key is unrecoverable. Print key to stdout *before* the INSERT, or print to stderr separately. Low likelihood; revisit alongside G4 CLI rewrite.
- **Architecture.md drift**: `cards` table grew three columns required for FSRS rehydration (`state`, `elapsed_days`, `scheduled_days`) that aren't in `architecture.md` §3. Add when refreshing the architecture doc.
