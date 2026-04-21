---
title: 'User profile + get_progress (coaching data plumbing)'
type: 'feature'
created: '2026-04-21'
status: 'ready-for-dev'
baseline_commit: '509054e'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture.md'
  - '{project-root}/_bmad-output/planning-artifacts/product-brief.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Brief §5 Flow 3 promises "how am I doing vs my 1500-chunk goal?" — Claude coaches conversationally from a single aggregated snapshot. Today Claude has no tool for this, and the `users` row has a thin, rigid profile (`goal_chunks`, `goal_deadline`, `level`, `method`) that can only be set at key-issue time. Rich personalization — free-form bio, languages, interests, daily time budget — isn't modeled at all.

**Approach:** Broaden the `users` profile schema, add two read/write MCP tools for it, add `get_progress` for the coaching snapshot. The profile is the source of truth Claude reads when creating examples ("tie this chunk to the user's interest in X") and when interpreting progress ("target 13/day; you've been doing 8"). `set_profile` lets Claude — or the user speaking through Claude — update any subset of fields anytime.

## Boundaries & Constraints

**Always:**
- Tenant-scoped: every read/write filters by `user_id`.
- Profile fields are individually nullable; absence means "not set", not "zero".
- `set_profile` requires ≥1 field in the payload (Zod refine). Fields omitted are left untouched. Passing `null` explicitly clears a field.
- `get_progress` and `get_profile` are `readOnlyHint: true, idempotentHint: true`.
- Mature threshold in `get_progress`: `stability >= 21` AND `state = 2` (Anki convention).
- Retention = share of ratings ≥ 3 (Good or Easy) in the window. Null if no reviews in window.
- Streak uses UTC calendar days. `current_streak` counts consecutive days ending today (inclusive); 0 if today has no review.

**Ask First:**
- User-local timezone for streak — deferred; `users.timezone` column added now so we can flip to it later without a migration. MVP uses UTC.
- Profile-driven example generation inside `add_card` (server reads `interests` and injects into a prompt) — out of scope; Claude composes examples client-side.

**Never:**
- No date-range params on `get_progress`. Windows fixed (7d / 30d).
- No pagination. Leeches capped at 10; by_tag at 20.
- No LLM work server-side.
- No validation of `native_language` / `target_languages` against an enum — accept any short string (IETF BCP-47 conventionally but not enforced).

## I/O & Edge-Case Matrix

**`get_profile{}`** — returns the profile dictionary below (all fields, nullable).

**`set_profile{...}`** — partial update; returns the updated profile (same shape as `get_profile`).

**`get_progress{}`** — returns the coaching snapshot below.

| Scenario | Expected |
|----------|----------|
| Empty `set_profile` payload | Validation error "at least one profile field required" |
| `set_profile{about: null}` | Clears `about`; other fields unchanged |
| `set_profile{interests: []}` | Empty array persisted (not null) |
| `get_progress` with no cards | All counts 0; retention d7/d30 null; streak 0/0; leeches []; by_tag []; goal reflects users row |
| `get_progress` with no reviews in last 7d | `retention.d7 = null`; `retention.d30` computed if any reviews exist |
| `goal_chunks = null` | `goal.chunks = null, goal.days_left = null, create_rate.target_per_day = null` |

**Profile shape:**
```ts
{
  name:              string;
  about:             string | null;                // free-form bio, max 2000 chars
  native_language:   string | null;                // e.g. 'vi'
  target_languages:  string[];                     // e.g. ['en', 'zh']; [] if not set
  interests:         string[];                     // e.g. ['AI','cooking']; [] if not set
  level:             string | null;                // e.g. 'B1'
  method:            string | null;                // e.g. 'lexical-chunks'
  daily_time_minutes: number | null;               // realistic target, e.g. 30
  timezone:          string | null;                // IANA, e.g. 'Asia/Ho_Chi_Minh'
  goal_chunks:       number | null;                // e.g. 1500
  goal_deadline:     string | null;                // ISO date, e.g. '2026-07-21'
}
```

**Progress shape:**
```ts
{
  goal:        { chunks: number | null; deadline: string | null; days_left: number | null };
  totals:      { created: number; learning: number; due: number; mature: number };
  retention:   { d7: number | null; d30: number | null };   // 0..1
  streak:      { current: number; longest: number };        // days
  create_rate: { last_7d: number; target_per_day: number | null };
  leeches:     Array<{ card_id: string; front: string; again_count: number }>;  // top 10
  by_tag:      Array<{ tag: string; count: number; mature: number }>;           // top 20
}
```

</frozen-after-approval>

## Code Map

- `migrations/0002_user_profile.sql` -- **new**. `ALTER TABLE users ADD COLUMN` for `about`, `native_language`, `target_languages` (TEXT DEFAULT '[]'), `interests` (TEXT DEFAULT '[]'), `daily_time_minutes`, `timezone`.
- `src/core/types.ts` -- **extend**. Add `Profile` type matching the output shape; update `User` if present.
- `src/core/progress.ts` -- **new**. Pure helpers: `computeStreak(days: string[], today: string): {current, longest}`, `daysLeft(deadlineIso: string | null, now: Date): number | null`, `targetPerDay(chunks, created, daysLeft)`.
- `src/core/users.ts` -- **new**. Pure helpers: `rowToProfile(row)`, `buildProfileUpdate(input): { setClauses, bindArgs }` (mirrors `buildCardUpdate` pattern; throws on empty input; JSON-encodes array fields).
- `src/adapters/mcp.ts` -- **extend**. Register `get_profile`, `set_profile`, `get_progress`. Define `fullProfileShape` and `fullProgressShape` Zod output schemas.
- `scripts/issue-key.ts` -- **keep** existing `--goal-chunks/--goal-deadline/--level/--method` flags for back-compat convenience (Week 4 family CLI). No changes required now.
- `tests/progress.test.ts` -- **new**. Unit-test `computeStreak` + `daysLeft` + `targetPerDay`.
- `tests/users.test.ts` -- **new**. Unit-test `rowToProfile` + `buildProfileUpdate`.

## Tasks & Acceptance

**Execution:**
- [ ] `migrations/0002_user_profile.sql` -- add six `ALTER TABLE users ADD COLUMN` statements. `target_languages` and `interests` are `TEXT NOT NULL DEFAULT '[]'`. Others are nullable TEXT/INTEGER. Run `pnpm migrate` to apply.
- [ ] `src/core/users.ts` -- `rowToProfile(row)`: normalizes nullable columns + JSON-decodes arrays with the same `parseStringArray` guard used by `rowToCard`. `buildProfileUpdate(input)`: returns `{setClauses, bindArgs}`, throws `Error('no profile fields')` if empty. JSON-encode `target_languages` / `interests` when present. `null` values pass through to produce `col = ?` with `args.push(null)`.
- [ ] `src/core/progress.ts` -- `computeStreak(sortedUniqueDays, today)`: returns `{current, longest}`; `current=0` if today not in list; walks backward from today for `current`; scans for longest contiguous run for `longest`. `daysLeft(iso, now)`: returns ceil(`(Date(iso) - now) / 86400000`) or null. `targetPerDay(chunks, created, daysLeft)`: `chunks==null || daysLeft==null || daysLeft<=0` → null; else `Math.max(0, Math.ceil((chunks - created) / daysLeft))`.
- [ ] `src/core/types.ts` -- export `Profile` type mirroring the output shape.
- [ ] `src/adapters/mcp.ts` -- define `fullProfileShape` + `fullProgressShape` (Zod). Register:
  - `get_profile{}` → SELECT users row, `rowToProfile`, return `fullProfileShape`.
  - `set_profile{about?, native_language?, target_languages?, interests?, level?, method?, daily_time_minutes?, timezone?, goal_chunks?, goal_deadline?}` → runtime precheck "at least one field required" (same pattern as `edit_card`), `buildProfileUpdate`, `UPDATE users SET ... WHERE id=?`, re-SELECT, return `fullProfileShape`. Annotations: `readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:false`.
  - `get_progress{}` → `db.batch([...8 reads...], 'read')` covering: users row, card totals (created/learning/due/mature), retention 7d, retention 30d, create_rate 7d, leeches top 10 (`JOIN cards` for `front`), by_tag top 20 (`json_each(cards.tags)`), review days last 90d for streak. Assemble via `computeStreak` + `daysLeft` + `targetPerDay`. Text rendering: 3-5 line human-readable summary (numbers + one-line interpretation hint per mcp-builder P4).
- [ ] `tests/users.test.ts` -- cover `rowToProfile` (all fields set, all null, malformed JSON arrays) + `buildProfileUpdate` (single, multi, empty throws, null clears, array JSON-encoding).
- [ ] `tests/progress.test.ts` -- cover `computeStreak` (empty, today-only, today-missing, gap breaks, longest across gaps), `daysLeft` (past/future/null), `targetPerDay` (null inputs, zero-days-left, normal case).
- [ ] Manual: via Gemini CLI: "What's my profile?" → `get_profile`; "I'm a software dev learning lexical chunks to level up B2 reading; interested in AI and cooking" → `set_profile` (about, interests); "How am I doing?" → `get_progress` with those profile fields reflected.

**Acceptance Criteria:**
- Given a fresh user after migration 0002, when `get_profile` runs, then all new fields are null/`[]` and the tool returns 200 with the full shape.
- Given `set_profile{about: "X", interests: ["AI"]}`, when it succeeds, then `get_profile` returns those values; other fields untouched.
- Given `set_profile{about: null}`, when it runs, then `about` is cleared to null; other fields untouched.
- Given `set_profile{}` (empty), when it runs, then validation error, no SQL executed.
- Given `get_progress` on a user with `goal_chunks=1500`, `goal_deadline=2026-07-21`, `created=340` on 2026-04-21, then `goal.days_left=91` and `create_rate.target_per_day = ceil((1500-340)/91) = 13`.
- Given zero reviews in the last 7d, when `get_progress` runs, then `retention.d7 = null`.
- Given 3+ `rating=1` reviews on a card, when `get_progress` runs, then it appears in `leeches` with correct `again_count`.
- Latency target: `get_progress` < 300 ms p95 local wrangler.

## Spec Change Log

## Design Notes

**Migration choice — `ALTER ADD COLUMN` vs table rewrite:** SQLite allows `ALTER TABLE ... ADD COLUMN`. No rewrite needed for nullable + default columns. Existing rows get the default or null. Cheap and reversible.

**Why `target_languages` / `interests` as JSON arrays, not a separate junction table:** same rationale as `cards.tags` — personal-scale, single-digit cardinality per user, `json_each` works in aggregate queries. Promotes later if multi-user joins become expensive.

**Why `set_profile` supports explicit `null`:** Claude needs to clear fields conversationally ("remove my deadline, I'm no longer time-boxed"). Omission ≠ clear; `null` ≠ omission.

**Why single `db.batch` for `get_progress`:** libsql batch is one round-trip; 8 parallel queries Promise.all would be 8 round-trips. At ~20ms RTT that's 140ms saved.

**`timezone` column added but unused in MVP:** adding now avoids a follow-up migration when streak localization lands. The column sits null; streak math continues to use UTC.

**Why `users.ts` helpers instead of inline in adapter:** mirrors the `cards.ts` pattern (`buildCardUpdate`, `rowToCard`). Testable in isolation, same drift-prevention argument.

## Verification

**Commands:**
- `pnpm migrate` -- expected: applies `0002_user_profile.sql`, `schema_migrations` records it.
- `npx tsc --noEmit` -- expected: clean.
- `npx vitest run` -- expected: all existing tests pass + new `users.test.ts` + `progress.test.ts` green.

**Manual checks:**
- After migration, run `pnpm tsx -e "...SELECT * FROM users..."` — confirm six new columns exist on your user row with default values.
- End-to-end via Gemini CLI per last Execution bullet.
