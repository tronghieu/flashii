---
title: 'Image generation pipeline (Gemini Nano Banana Pro + R2)'
type: 'feature'
created: '2026-04-21'
status: 'in-progress'
baseline_commit: '783b13f9fb706943fdc2a18b9473d951d5cf181b'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture.md'
  - '{project-root}/_bmad-output/planning-artifacts/product-brief.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Brief §5 promises mnemonic images on cards Claude judges to benefit from one (concrete nouns), but `add_card` currently has no `needs_image` path and the server has no image generation or storage. Cards stay text-only.

**Approach:** Add `needs_image` + `image_prompt` to `add_card`. When set, call Gemini Nano Banana Pro (`gemini-3-pro-image-preview`) via raw `fetch`, write returned PNG to an R2 binding at `{user_id}/{card_id}.png`, serve it from the same Worker via `GET /img/:userId/:cardId.png`, and persist the absolute URL in `cards.image_url`. On any image failure, insert the card with `image_url=NULL` and return success — Claude retries later via `regenerate_image` (G3).

## Boundaries & Constraints

**Always:**
- Image bytes accessed only through Worker route — no public R2 dev URL, no `r2.dev` dependency.
- Card insert is the source of truth: if image fails, card is still created (status `ready`, `image_url=NULL`).
- Public image route requires no auth in MVP — single-user product, image keys are unguessable ULIDs.
- Image URL stored in DB is **absolute** (Claude needs to render it via Markdown `![](url)`).

**Ask First:**
- Switching default model to a cheaper one (e.g. `gemini-2.5-flash-image` at ~$0.04 vs Nano Banana Pro at ~$0.13/image) — brief explicitly locks Nano Banana Pro.
- Adding signed URLs / auth on the image route — not in MVP scope.

**Never:**
- No `@google/genai` SDK (pulls Node deps; raw `fetch` works fine).
- No retries on Gemini failure inside `add_card` (Claude can call `regenerate_image` later — keeps add_card under the brief's <10s budget).
- No `add_from_text` tool — deferred (see deferred-work.md).
- No image edit / multi-image input — text-prompt → single image only.
- No multipart upload (PNGs are <5MB).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Text-only add | `needs_image` omitted or false | Insert card, `image_url=NULL`, return `{id, due_at}` (no image_url field set) | N/A |
| Image happy path | `needs_image=true`, `image_prompt="..."` | Call Gemini → get PNG → R2 PUT → INSERT card with absolute `image_url` → return `{id, due_at, image_url}` | N/A |
| Missing image_prompt | `needs_image=true` and `image_prompt` empty/missing | Reject before Gemini call: validation error | Zod refine |
| Gemini blocked / safety | `finishReason ∈ {SAFETY, PROHIBITED_CONTENT, IMAGE_SAFETY}` or no `inlineData` part | Insert card with `image_url=NULL`, return `{id, due_at}`, log warn with `finishReason` | Swallow, do not throw |
| Gemini HTTP error / timeout | non-200 or fetch throws | Same as safety: insert card without image, log warn | Swallow |
| R2 PUT failure | `env.IMAGES.put` throws | Insert card with `image_url=NULL`, log warn | Swallow |
| Public image GET | `GET /img/{userId}/{cardId}.png`, object exists | 200, `Content-Type: image/png`, `Cache-Control: public, max-age=31536000, immutable`, body = R2 object stream | N/A |
| Public image GET miss | object not in R2 | 404 JSON `{error: "not_found"}` | N/A |

</frozen-after-approval>

## Code Map

- `wrangler.jsonc` -- add `r2_buckets` binding `IMAGES` → `flashii-card-images`.
- `src/infra/env.ts` -- add `IMAGES: R2Bucket`, `GEMINI_API_KEY: string` to Env.
- `src/infra/gemini.ts` -- **new**. Pure-fetch wrapper: `generateImage(prompt, apiKey): Promise<{bytes: Uint8Array; mimeType: string} | {blocked: string}>`. Returns discriminated result, never throws on safety/network.
- `src/infra/images.ts` -- **new**. `storeImage(env, userId, cardId, bytes): Promise<string>` writes to R2 with content-type + cache headers, returns absolute URL using `baseUrl` passed from request context.
- `src/adapters/mcp.ts` -- extend `add_card` input schema (`needs_image`, `image_prompt`); orchestrate Gemini → R2 → INSERT; include `image_url` in response when set. Read `baseUrl` from `ToolCtx`.
- `src/index.ts` -- compute `baseUrl` from `c.req.url` origin, pass into MCP `authContext.props`. Add `app.get('/img/:userId/:cardId\\.png', ...)` route reading from `env.IMAGES`.
- `tests/gemini.test.ts` -- **new**. Unit-test `generateImage` parsing for happy path, safety block, malformed response (mock `fetch`).
- `tests/images.test.ts` -- **new**. Unit-test `storeImage` URL composition.

## Tasks & Acceptance

**Execution:**
- [x] `wrangler.jsonc` -- added `r2_buckets: [{binding: "IMAGES", bucket_name: "flashii-card-images"}]`.
- [x] `src/infra/env.ts` -- added `IMAGES: R2Bucket` and `GEMINI_API_KEY: string`.
- [x] `src/infra/gemini.ts` -- implemented `generateImage` with discriminated `{ok:true, bytes, mimeType} | {ok:false, reason}` result. Added `imageConfig: {aspectRatio:'1:1', imageSize:'1K'}` for cost optimization (~½ cost vs 2K default).
- [x] `src/infra/images.ts` -- implemented `storeImage`, `imageKey`, `imageUrl` helpers. Cache headers `public, max-age=31536000, immutable`.
- [x] `src/adapters/mcp.ts` -- extended `add_card` schema + handler. Tool description enriched with Nano Banana Pro prompt-engineering guidance (when to use, how to write image_prompt, failure semantics) per system-prompt-creator P4/P5/P9. `cardShape` outputSchema includes `image_url`. `get_due` text now embeds `![mnemonic](url)` so Claude renders the image inline.
- [x] `src/index.ts` -- compute `baseUrl` from `c.req.url` origin, pass `env` + `baseUrl` via `authContext.props`. Added `GET /img/:userId/:filename{.+\\.png}` route.
- [x] `tests/gemini.test.ts` (6 tests) + `tests/images.test.ts` (4 tests) -- all green.
- [ ] Manual (user action): `wrangler r2 bucket create flashii-card-images`; add `GEMINI_API_KEY=...` to `.dev.vars`; restart `wrangler dev`; end-to-end add_card with image via Claude; verify image renders in chat.

**Acceptance Criteria:**
- Given `needs_image=false`, when `add_card` runs, then no Gemini call is made and `image_url` is null in DB and response.
- Given `needs_image=true` with valid `image_prompt`, when Gemini returns an image, then card is inserted with `image_url=https://<host>/img/<userId>/<cardId>.png` AND that URL returns the PNG bytes with `Content-Type: image/png`.
- Given `needs_image=true` with valid `image_prompt`, when Gemini returns `finishReason: SAFETY`, then card is still inserted with `image_url=NULL` and add_card returns 200 (no error to Claude); a `console.warn` records the block reason.
- Given `needs_image=true` and `image_prompt` empty, when add_card runs, then validation fails before any external call.
- Given a request to `/img/{userId}/{cardId}.png` for a non-existent object, then 404 is returned.

## Spec Change Log

## Design Notes

**Why Worker-served image route over R2 public bucket:** `pub-<hash>.r2.dev` is rate-limited and Cloudflare-flagged "non-production". Custom domain (`images.flashii.app`) needs zone setup we don't have. Worker route reuses the existing `/mcp` deployment — zero infra additions.

**Why swallow Gemini failures instead of retry-in-band:** brief §6 latency budget is "~5–10s with image". Gemini p99 is 10–30s; one retry blows that. Architecture §6 explicitly says "Never block the whole add_card on image gen". `regenerate_image` (G3) handles retries on Claude's prompt.

**Why discriminated return from `generateImage`:** safety blocks are HTTP 200 with an empty `inlineData`. Throwing would conflate "API down" with "model refused" — caller needs to distinguish for logging. Discriminated `{bytes}|{blocked}` keeps the call site explicit and exhaustive.

**Cost note:** Nano Banana Pro is ~$0.13/image. Brief budget is <$10/month → ~75 images/month. Acceptable for personal use because Claude only flags concrete nouns. If cost overruns, swap model id in one place — interface is unchanged.

## Verification

**Commands:**
- `bun run build` (or `tsc --noEmit`) -- expected: clean compile, no type errors on new R2/env shape.
- `bun test tests/gemini.test.ts tests/images.test.ts` -- expected: all green.
- `wrangler dev` then `curl -X POST localhost:8787/mcp ...` end-to-end with `needs_image=false` -- expected: card inserted, no Gemini call.
- `wrangler r2 object list flashii-card-images --prefix <userId>/` (after a needs_image=true call from Claude) -- expected: object present.

**Manual checks (if no CLI):**
- In Claude Desktop with the connector, ask "create a card for the chunk 'red apple', tag it 'food', generate a mnemonic image". Verify Claude renders the image inline in chat.
