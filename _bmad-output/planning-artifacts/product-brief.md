# Product Brief: Flashii

**Author**: Lưu Hiếu
**Date**: 2026-04-21
**Status**: Draft v1

---

## 1. Summary

Flashii is a personal, AI-native flashcard system designed to replace Anki for the author's own language learning and future family use. Unlike traditional flashcard apps, Flashii has **no UI of its own** — it is a headless backend exposed through the Model Context Protocol (MCP), consumed by AI clients the user already owns (Claude Desktop, Claude iOS, Claude Code). Card creation is AI-generated (definitions, examples, mnemonic images), and review happens as a natural conversation with Claude. A web app can be added later as a second adapter over the same core.

## 2. Problem

The author uses Anki today but is blocked by three concrete pains:

1. **Manual card creation is the largest friction** — writing cards by hand is slow and uninspired; no images, no pronunciations, no contextual examples without heavy manual effort.
2. **iPhone is the primary device, but Anki has no usable free mobile path** — AnkiMobile is paid ($25), AnkiWeb is unusable on mobile browsers.
3. **Anki cannot tutor** — it only flips cards; it cannot explain *why* an answer was wrong, which is where learning compounds.

Adjacent products (Quizlet, RemNote, Mochi, NotebookLM) either target mass-market shallow learning or sprinkle AI on top of a traditional flashcard UI. None position the flashcard system as an MCP-native memory layer that existing AI clients consume.

## 3. Target User (MVP)

**Primary user (v1)**: the author himself.
- Vietnamese native speaker
- Current level: A2–B1 (domain-limited — strong on IT English, weaker on general English)
- Primary device: iPhone; secondary: Mac
- Already uses Claude Desktop + Claude iOS daily
- Learning goal: English first, Chinese after

**Future users (v2+)**: family members (parents, kids, spouse) — same architecture, additional API keys.

Flashii is explicitly **not** for volume memorizers (med students drilling 10k+ USMLE cards). Those users need traditional flash-tap flow; Flashii optimizes for depth-over-speed.

## 4. Goals & Success Metrics

### Personal 3-month learning goal
- Method: **Lexical chunks** (collocations and phrase patterns, not isolated words)
- Target: **1500 English lexical chunks** learned (≈17 new chunks/day)
- Expected outcome: general-English reading and listening reach solid B1

### Product success metrics (MVP window: weeks 1–12)
- Daily review completed ≥80% of days
- Median per-card review latency <500 ms on mobile
- Card creation friction: adding a new chunk takes <15 s end-to-end ("say the chunk, get a finished card")
- Monthly operating cost <$10

## 5. Solution

A single MCP server exposing two independent flows over the same data core.

### Flow 1 — Card Creation (conversational, AI content from Claude itself)
User chats with Claude: *"I want to learn lexical chunks about AI."*
- Claude proposes candidate chunks (e.g., *"fine-tune a model", "zero-shot learning", "prompt injection"*)
- User approves the list
- Claude generates the full content for each card (definition, IPA, 2–3 example sentences) in the conversation
- Claude decides per card whether an image is useful (concrete nouns benefit, abstract verbs usually don't)
- Claude calls MCP `add_card` with the finished content: `{front, back, examples, ipa, tags[], needs_image?, image_prompt?}` — tags are inferred by Claude from the conversation (e.g., `["AI", "verb-phrase"]`); a card may carry many tags
- Server responsibilities are thin: if `needs_image=true`, call **Gemini Nano Banana Pro** to generate the mnemonic image, upload to R2, then insert the card row with status `ready`; otherwise just insert
- Latency budget per `add_card`: <2 s without image, ~5–10 s with image

**Key architectural consequence**: the MCP server does not hold an LLM API key and makes no LLM calls. All language-intelligence lives in the user's existing Claude subscription. The server is storage + FSRS + optional image generation.

### Flow 2 — Daily Review (fast, cached, conversational)
User tells Claude: *"Let's review."*
- MCP tool `get_due` returns cards due now (image URLs, no LLM involvement); accepts optional `tags: string[]` filter so the user can scope a session (*"Let's review only AI chunks"*)
- Claude presents each card; user answers; Claude calls `submit_rating`
- Server runs FSRS (`ts-fsrs`) as a pure function, appends to review log, updates card state
- Latency budget: <200 ms p95 per rating
- When the user rates "Again," Claude explains the mistake conversationally using context already in the session — no extra server round-trip required

The two flows are deliberately separated in code and (eventually) in deploy. Review is boring, fast, and cache-friendly. Creation is generative, slower, and retry-tolerant.

### Flow 3 — Progress Coaching (on-demand, read-only)
User asks Claude: *"How am I doing against my 1500-chunk goal?"*
- MCP tool `get_progress` returns an aggregated summary (no raw review log): totals (created / learning / due / mature), retention rate (7d/30d), daily streak, create-rate vs. target, top leeches (Again ≥ 3), distribution by tag, and the user's declared goal/level/method from the `users` table
- Claude interprets the numbers conversationally — praises, flags drift from target, recommends retutoring on specific leeches, spots domain imbalance (e.g., IT-heavy vs. daily-life)
- Server does zero LLM work; all coaching intelligence lives in the Claude conversation
- Latency budget: <300 ms (single aggregation query)

### Architecture (one-line version)
`Core domain (pure TS) → Protocol adapters (MCP today, REST later) → Turso (SQLite) + R2 (images)` on Cloudflare Workers, auth via API key in `Authorization: Bearer …` header.

### Deliberate non-goals for MVP
- No web app (possible later via a REST adapter on the same core)
- No offline review (remote MCP + Claude clients require network)
- No audio playback in-chat (pronunciation stays as IPA text; audio may come later as tap-out link)
- No shared-deck ecosystem migration from Anki (a one-time `.apkg` importer is optional, not required)
- No deck hierarchy — cards are grouped by flat **tags** (many-to-many) stored as a JSON array on the card; Claude assigns tags during creation and filters by tags during review
- No OAuth/login UI — API keys manually provisioned

## 6. Stack & Cost

| Layer | Choice | Rationale | Cost (1 user) |
|---|---|---|---|
| Compute | Cloudflare Workers (+ Hono) | Edge, free tier generous, fits MCP HTTPS requirement | $0 |
| Database | Turso (libSQL) | Managed SQLite at the edge; fits personal scale | $0 |
| Image storage | Cloudflare R2 | S3-compatible, generous free egress | $0 |
| SRS | `ts-fsrs` library | Same FSRS algorithm Anki 23.10+ uses; standalone; research-backed | $0 |
| LLM (content generation) | **Claude (client-side)** — user's existing subscription | Server holds no LLM key; all content is produced in the Claude conversation | $0 incremental |
| Image generation | **Gemini Nano Banana Pro** (Gemini API) | Strong at text-in-image and editing; called only when Claude marks a card as benefiting from an image | ~$1–3/mo |
| Auth | API key (bearer header) | Simplest thing that works; Claude Connector supports custom headers | $0 |
| Language | TypeScript | Matches Workers + `ts-fsrs` + future web app | — |

**Total expected run cost**: **<$5/month** for single-user MVP (image generation only; no server-side LLM cost).

## 7. Roadmap

### Week 1 — MCP server skeleton
- Turso schema: `users` (includes `goal_chunks`, `goal_deadline`, `level`, `method`), `cards` (with `tags` JSON array), `reviews` (append-only)
- MCP tools: `add_card` (text-only, no image yet), `get_due` (with optional `tags` filter), `submit_rating`
- FSRS wired in
- Deploy to Cloudflare Workers; connect Claude Desktop; review 10 real chunks for 3 days

### Week 2 — Mobile + image generation
- Integrate **Gemini Nano Banana Pro** for mnemonic image when `needs_image=true`
- R2 upload pipeline
- Connect Claude iOS Connector; validate mobile review flow
- Add `add_from_text` (paste a paragraph, Claude extracts candidate chunks)

### Week 3 — Polish
- `edit_card`, `regenerate_image`, `suspend_card`
- `get_progress` tool (aggregated stats for Claude-side coaching)
- `explain_mistake` tool (optional, Claude-side mostly)
- Usage logging, cost monitoring

### Week 4+ — Family readiness
- CLI: `flashii user add "<name>"` → issue API key
- Row-level `user_id` already in schema from Week 1 (locked decision)
- Export command for data portability

### Later — Web app (optional)
- Add `adapters/rest.ts` over the same `core/`
- Next.js on Cloudflare Pages; Clerk for web auth; Clerk user → Flashii `api_key` mapping
- Offline-capable PWA for mobile web review

## 8. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Conversational review feels too slow vs Anki tap flow | Validate via 3-day manual experiment (paste 10 cards into Claude Desktop, quiz by hand) **before** writing code |
| LLM token cost drifts above $10/mo | Monitor per-session token usage; switch create-time model to Gemini Flash if needed |
| FSRS integration bugs destroy scheduling | Use official `ts-fsrs`; review log is append-only from day 1 so state is always reconstructible |
| Mobile typing friction for free-text answers | Lean on Claude iOS voice input; server-side parse lenient ratings ("good", "3", "nhớ rồi") |
| User loses interest after novelty fades | Product is for the author himself — if he doesn't use it after week 2, kill the project; no sunk-cost fallacy |

## 9. Decisions Locked (do not relitigate)

- **No Anki.** Flashii is a standalone system, not an AnkiConnect plugin.
- **No self-written SRS.** Use `ts-fsrs`.
- **No server-side LLM.** Content generation happens in the Claude conversation; the server only receives finished cards.
- **Gemini Nano Banana Pro** is the image generation provider.
- **Create and Review are separate flows** with different latency budgets, different tools, different code paths.
- **API key auth** for MCP; no OAuth, no magic link, no login UI in MVP.
- **TypeScript + Cloudflare Workers + Turso + R2.**
- **`user_id` everywhere from day 1** so family extension is a CLI command, not a refactor.
- **Core logic stays protocol-agnostic** so a REST adapter can serve a future web app.
