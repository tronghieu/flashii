# Flashii

Flashii is an AI-native flashcard system for learning through conversation instead of a traditional flashcard app UI.

The simplest way to understand it: Flashii is a personal memory layer that plugs into AI clients such as Claude Desktop, Claude iOS, or Claude Code through MCP. The learner talks to Claude to create cards, review due cards, and get coaching. Flashii handles the durable backend work: storing cards, scheduling reviews with FSRS, serving mnemonic images, and protecting access with API keys.

Flashii was created as a lightweight Anki replacement for language learning, especially for learning lexical chunks such as collocations, phrase patterns, and useful expressions. It is optimized for depth and explanation rather than high-speed deck drilling.

## What Flashii Is

- A headless flashcard backend exposed through the Model Context Protocol (MCP)
- A spaced-repetition system using FSRS scheduling
- A personal learning database for cards, reviews, tags, progress, and user goals
- An optional mnemonic image pipeline backed by Gemini and Cloudflare R2
- A foundation for future adapters, such as a REST API or web app, without changing the core learning model

## How It Feels To Use

As a learner, you do not open a Flashii app. You open Claude and talk naturally.

For card creation:

1. Ask Claude for learning material, for example: "I want to learn lexical chunks about AI."
2. Claude proposes useful chunks and helps refine the list.
3. Claude writes the card content: definition, examples, IPA, tags, and optional image prompt.
4. Claude calls Flashii through MCP to save the finished cards.
5. Flashii stores the cards and, when requested, generates and stores mnemonic images.

For daily review:

1. Say: "Let's review."
2. Claude asks Flashii for cards due now, optionally filtered by tags such as `AI` or `daily-life`.
3. Claude quizzes you conversationally.
4. After each answer, Claude submits your rating to Flashii.
5. Flashii updates the FSRS schedule, while Claude can explain mistakes in plain language.

For progress coaching:

1. Ask: "How am I doing against my 1500-chunk goal?"
2. Flashii returns aggregated progress data.
3. Claude interprets the numbers, highlights drift, and suggests what to review or create next.

## Who It Is For

Flashii is best for learners who already use an AI assistant daily and want the assistant to become their tutor, not just a card generator. The MVP targets personal language learning on iPhone and Mac, with family use planned later through additional API keys.

It is not designed for users who need to blast through very large decks with a tap-only interface, such as medical exam decks with tens of thousands of cards. For that workflow, a traditional app like Anki is still a better fit.

## Current API Shape

Flashii currently runs as a Cloudflare Worker that exposes an authenticated MCP server. It stores structured learning data in Turso, generated card images in Cloudflare R2, and can optionally call Gemini to create mnemonic images during card creation.

The current production shape is:

- Runtime: Cloudflare Workers + Hono
- API surface: `/health`, `/mcp`, and public image serving at `/img/:userId/:filename.png`
- Database: Turso / libSQL
- Object storage: Cloudflare R2
- Image generation: Gemini image model via `GEMINI_API_KEY`

## Features

- Add, edit, list, suspend, unsuspend, and delete flashcards
- Review cards with FSRS scheduling
- Read coaching-oriented profile and progress data
- Optionally generate and store card images in R2
- Authenticate MCP requests with API keys hashed in the database

## Architecture

Source layout:

- [src/index.ts](/Users/luutronghieu/Projects/flashii/src/index.ts:1): Worker entrypoint and HTTP routes
- [src/adapters/mcp.ts](/Users/luutronghieu/Projects/flashii/src/adapters/mcp.ts:1): MCP tool registration and request handling
- [src/core](/Users/luutronghieu/Projects/flashii/src/core): domain logic for cards, reviews, progress, and users
- [src/infra](/Users/luutronghieu/Projects/flashii/src/infra): auth, env types, Turso client, Gemini, and R2 helpers
- [migrations](/Users/luutronghieu/Projects/flashii/migrations): SQL schema migrations
- [scripts](/Users/luutronghieu/Projects/flashii/scripts): operational scripts such as key issuance and migrations
- [tests](/Users/luutronghieu/Projects/flashii/tests): unit tests

## Requirements

- Node.js 20+
- pnpm 9+
- A Cloudflare account with Workers enabled
- A Turso database
- An R2 bucket
- A Gemini API key if you want image generation

## Local Development

Install dependencies:

```bash
pnpm install
```

Create local secrets:

```bash
cp .dev.vars.example .dev.vars
```

Populate `.dev.vars` with at least:

```dotenv
TURSO_URL=libsql://your-db.turso.io
TURSO_TOKEN=your-token
GEMINI_API_KEY=your-gemini-key
```

Optional local values:

```dotenv
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
LOG_LEVEL=info
```

Run the Worker locally:

```bash
pnpm dev
```

Run checks:

```bash
pnpm typecheck
pnpm test
```

Apply migrations to your target Turso database:

```bash
TURSO_URL=libsql://your-db.turso.io TURSO_TOKEN=your-token pnpm migrate
```

## Cloudflare Configuration

This project expects the following Cloudflare resources and bindings:

- Worker name: `flashii-api`
- R2 binding: `IMAGES`
- R2 bucket name: `flashii-card-images` by default in [wrangler.jsonc](/Users/luutronghieu/Projects/flashii/wrangler.jsonc:1)

Required secrets on the deployed Worker:

- `TURSO_URL`
- `TURSO_TOKEN`
- `GEMINI_API_KEY`

Optional secret:

- `GEMINI_IMAGE_MODEL`

Set secrets with Wrangler:

```bash
npx wrangler secret put TURSO_URL
npx wrangler secret put TURSO_TOKEN
npx wrangler secret put GEMINI_API_KEY
```

Deploy:

```bash
pnpm run deploy
```

Alternative explicit command:

```bash
pnpm run cf:deploy
```

Smoke test after deploy:

```bash
curl https://<your-worker-url>/health
curl -i https://<your-worker-url>/mcp
```

## Authentication

`/mcp` supports two ways to pass an API key:

- `Authorization: Bearer <key>`
- Query string fallback: `/mcp?key=<key>`

Header-based auth is the recommended production path. Query-string auth exists mainly for convenience and lightweight testing.

## API Surface

- `GET /health`: basic health check
- `ALL /mcp`: authenticated MCP endpoint
- `GET /img/:userId/:filename.png`: public image fetch from R2

## Security Notes

- API keys are stored as SHA-256 hashes in the `users` table, not in plaintext
- Query-string auth is less safe than bearer headers because it can leak through logs and history
- Image routes are public by design in the current MVP
- This Worker depends on external services and costs can come from Cloudflare, Turso, R2, and Gemini usage

## Project Status

This is an active early-stage project. The core deploy path is working, but the public API and operational model may still change.

## Contributing

See [CONTRIBUTING.md](/Users/luutronghieu/Projects/flashii/CONTRIBUTING.md:1).

## License

[MIT](/Users/luutronghieu/Projects/flashii/LICENSE:1)
