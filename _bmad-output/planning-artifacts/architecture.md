# Architecture: Flashii

**Author**: Lưu Hiếu
**Date**: 2026-04-21
**Status**: Draft v1
**Source**: `product-brief.md`

---

## 1. Component Diagram

```
┌─────────────────────┐     ┌─────────────────────┐
│  Claude Desktop     │     │  Claude iOS         │
│  Claude Code        │     │  (Connector)        │
└──────────┬──────────┘     └──────────┬──────────┘
           │      MCP over HTTPS       │
           │      Authorization: Bearer <api_key>
           └────────────┬──────────────┘
                        ▼
           ┌────────────────────────────┐
           │  Cloudflare Worker (Hono)  │
           │  ┌──────────────────────┐  │
           │  │  adapters/mcp.ts     │  │  ← protocol
           │  ├──────────────────────┤  │
           │  │  core/               │  │  ← pure TS
           │  │    cards.ts          │  │
           │  │    reviews.ts        │  │
           │  │    progress.ts       │  │
           │  │    fsrs.ts (wrap)    │  │
           │  └──────────────────────┘  │
           └──────┬─────────────┬───────┘
                  │             │
            ┌─────▼────┐  ┌─────▼────────┐
            │  Turso   │  │  R2 (images) │
            │ (libSQL) │  └──────────────┘
            └──────────┘
                  │
            ┌─────▼──────────────────┐
            │  Gemini Nano Banana Pro│ ← on needs_image=true
            └────────────────────────┘
```

## 2. Module Layout

```
src/
├── core/                       # pure business logic, zero I/O imports
│   ├── cards.ts                # createCard, listDue, tagFilter
│   ├── reviews.ts              # appendReview, materializeState
│   ├── progress.ts             # aggregateProgress
│   ├── fsrs.ts                 # ts-fsrs wrapper (pure)
│   └── types.ts                # Card, Review, User, Rating
├── adapters/
│   └── mcp.ts                  # MCP tool handlers → calls core/
├── infra/
│   ├── db.ts                   # Turso client
│   ├── r2.ts                   # R2 upload
│   ├── gemini.ts               # image gen
│   └── auth.ts                 # bearer token → user_id
└── index.ts                    # Hono app bootstrap
```

**Rule**: `core/` never imports from `infra/` or `adapters/`. Data is passed in, results returned. This makes a REST adapter a pure additive change later.

## 3. Database Schema (Turso / SQLite)

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,        -- ULID
  api_key_hash    TEXT NOT NULL UNIQUE,    -- sha256(api_key)
  name            TEXT NOT NULL,
  goal_chunks     INTEGER,                 -- e.g., 1500
  goal_deadline   TEXT,                    -- ISO date
  level           TEXT,                    -- 'A2', 'B1', etc.
  method          TEXT,                    -- 'lexical-chunks'
  created_at      TEXT NOT NULL
);

CREATE TABLE cards (
  id              TEXT PRIMARY KEY,        -- ULID
  user_id         TEXT NOT NULL REFERENCES users(id),
  front           TEXT NOT NULL,           -- the chunk/phrase
  back            TEXT NOT NULL,           -- definition
  ipa             TEXT,
  examples        TEXT NOT NULL,           -- JSON array of strings
  tags            TEXT NOT NULL DEFAULT '[]', -- JSON array
  image_url       TEXT,                    -- R2 URL or NULL
  status          TEXT NOT NULL,           -- 'ready' | 'suspended'
  -- FSRS state (materialized from reviews):
  stability       REAL NOT NULL DEFAULT 0,
  difficulty      REAL NOT NULL DEFAULT 0,
  due_at          TEXT NOT NULL,           -- ISO timestamp
  last_reviewed_at TEXT,
  reps            INTEGER NOT NULL DEFAULT 0,
  lapses          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_cards_due ON cards(user_id, status, due_at);

CREATE TABLE reviews (                     -- append-only source of truth
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  card_id         TEXT NOT NULL REFERENCES cards(id),
  rating          INTEGER NOT NULL,        -- 1=Again, 2=Hard, 3=Good, 4=Easy
  reviewed_at     TEXT NOT NULL,
  elapsed_days    REAL NOT NULL,
  stability_after REAL NOT NULL,
  difficulty_after REAL NOT NULL,
  due_after       TEXT NOT NULL
);

CREATE INDEX idx_reviews_user_time ON reviews(user_id, reviewed_at);
```

**Key decisions**:
- `reviews` is append-only; `cards` FSRS columns are a materialized snapshot for fast `get_due` queries. On any bug, state can be rebuilt by replaying `reviews`.
- `tags` is a JSON array on `cards`; query with `json_each(cards.tags)`. No join table, no deck hierarchy.
- ULIDs for lexicographic sort + time-ordered inserts.

## 4. MCP Tool Contracts

All tools require `Authorization: Bearer <api_key>` header, resolved to `user_id` in `infra/auth.ts`.

### `add_card`
```ts
input: {
  front: string;
  back: string;
  ipa?: string;
  examples: string[];         // 2-3 sentences
  tags: string[];             // e.g. ["AI", "verb-phrase"]
  needs_image?: boolean;
  image_prompt?: string;      // required if needs_image
}
output: { id: string; image_url?: string; due_at: string }
latency: <2s text / <10s with image
```

### `add_from_text`
```ts
input: { text: string; tags?: string[] }  // paste a paragraph
output: { candidates: Array<{front: string; back: string; ...}> }
// Claude reviews candidates, then calls add_card for each approved one.
// Server-side: simple tokenization/n-gram extraction (no LLM).
```

### `get_due`
```ts
input: { tags?: string[]; limit?: number }  // default 20
output: { cards: Array<Card> }              // full card incl. image_url
latency: <200ms p95
```

### `submit_rating`
```ts
input: { card_id: string; rating: 1 | 2 | 3 | 4 }
output: { due_at: string; stability: number; difficulty: number }
// Side effects: insert review row, update cards FSRS columns.
latency: <200ms p95
```

### `get_progress`
```ts
input: {}
output: {
  goal:    { chunks: number; deadline: string; days_left: number }
  totals:  { created: number; learning: number; due: number; mature: number }
  retention: { d7: number; d30: number }   // % Good+Easy
  streak:  { current: number; longest: number }
  create_rate: { last_7d: number; target_per_day: number }
  leeches: Array<{card_id: string; front: string; again_count: number}>
  by_tag:  Array<{tag: string; count: number; mature: number}>
}
latency: <300ms (single aggregation query)
```

### `edit_card` / `regenerate_image` / `suspend_card`
Thin CRUD. `suspend_card` sets `status='suspended'` (excluded from `get_due`).

## 5. FSRS Integration

Use `ts-fsrs` directly; do not reimplement.

```ts
// core/fsrs.ts
import { FSRS, generatorParameters } from 'ts-fsrs';
const fsrs = new FSRS(generatorParameters({ enable_fuzz: true }));

export function schedule(card: CardState, rating: Rating, now: Date) {
  const { card: next, log } = fsrs.next(card, now, rating);
  return { next, log };  // pure, no I/O
}
```

`reviews.ts` is the only module that calls `schedule()` — it applies the result to `cards` row + appends `reviews` row in a single transaction.

## 6. Image Generation Pipeline

Called inline inside `add_card` when `needs_image=true`:

```
1. Call Gemini Nano Banana Pro with image_prompt
2. Receive PNG bytes
3. Upload to R2: bucket/user_id/card_id.png
4. Build public URL: https://images.flashii.app/user_id/card_id.png
5. Write cards row with image_url set, status='ready'
```

On Gemini failure: insert card with `image_url=NULL`, return success (Claude can retry via `regenerate_image` later). Never block the whole `add_card` on image gen.

## 7. Auth Flow

```
Request → Hono middleware → infra/auth.ts:
  1. Read Authorization: Bearer <token>
  2. hash = sha256(token)
  3. SELECT id FROM users WHERE api_key_hash = hash
  4. If found: attach user_id to context; else 401
```

Provisioning: CLI `flashii user add "<name>"` generates random 32-byte key, prints once, stores hash. No rotation UI for MVP.

## 8. Error Handling

- **Validation errors** (bad input): return MCP error with clear message; no retry.
- **Gemini failure**: swallow, insert card without image, log.
- **Turso transient failure**: retry once with 100ms backoff; then surface.
- **FSRS never fails**: pure function; input is type-checked.

All errors logged to Workers `console` (Cloudflare tail for debugging).

## 9. Sequence Diagrams

### Create (with image)
```
Claude → add_card{needs_image:true} → Worker
Worker → Gemini (image_prompt) → PNG bytes
Worker → R2 PUT → image_url
Worker → Turso INSERT cards → {id, image_url, due_at}
Worker → Claude: success
```

### Review (rating)
```
Claude → get_due{tags:["AI"]} → Worker → Turso SELECT → cards[]
Claude shows card, user answers
Claude → submit_rating{card_id, rating} → Worker
Worker → fsrs.schedule(cardState, rating) → {next, log}
Worker → Turso TX: INSERT reviews + UPDATE cards → {due_at, ...}
Worker → Claude: success
```

### Progress
```
Claude → get_progress → Worker → single SQL with CTEs:
  - totals from cards
  - retention from reviews WHERE reviewed_at > now-30d
  - streak from reviews day-grouped
  - leeches from reviews GROUP BY card_id HAVING SUM(rating=1) >= 3
Worker → Claude: aggregated JSON
Claude interprets + responds to user conversationally
```

## 10. Deployment

- **Repo**: single TypeScript package, `pnpm` or `bun`
- **Dev**: `wrangler dev` (local Miniflare + local Turso)
- **Prod**: `wrangler deploy` to Cloudflare Workers
- **Secrets**: `GEMINI_API_KEY`, `TURSO_URL`, `TURSO_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET` via `wrangler secret put`
- **Custom domain**: `api.flashii.app` (Workers route), `images.flashii.app` (R2 public bucket)

## 11. Future: REST Adapter (not MVP)

When web app is built:
- Add `src/adapters/rest.ts` — exposes the same `core/` functions as HTTP endpoints
- Auth: Clerk JWT → look up `user_id` (new table `clerk_users` mapping `clerk_id → user_id`)
- Zero changes to `core/`, `infra/`, or `adapters/mcp.ts`

## 12. Open / Deferred

- `.apkg` importer (optional, not MVP)
- Audio playback (IPA only for now)
- Web app + Clerk (later phase)
- Per-user usage metering / rate limiting (add when family joins)
