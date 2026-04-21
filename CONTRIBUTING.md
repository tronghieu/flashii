# Contributing

Thanks for considering a contribution.

## Before You Start

- Read the project overview in [README.md](/Users/luutronghieu/Projects/flashii/README.md:1)
- Keep changes scoped and reviewable
- Prefer small pull requests over large mixed changes

## Development Workflow

Install dependencies:

```bash
pnpm install
```

Run local development:

```bash
pnpm dev
```

Run checks before opening a PR:

```bash
pnpm typecheck
pnpm test
```

If your change touches the schema, add a migration under [migrations](/Users/luutronghieu/Projects/flashii/migrations:1) and verify it with:

```bash
TURSO_URL=libsql://your-db.turso.io TURSO_TOKEN=your-token pnpm migrate
```

## Coding Expectations

- Follow the existing TypeScript style and module boundaries
- Keep Worker code compatible with Cloudflare Workers
- Put domain logic in `src/core` and platform-specific logic in `src/infra` or `src/adapters`
- Add or update tests for behavior changes
- Avoid mixing unrelated refactors into feature or bug-fix PRs

## Pull Requests

When opening a PR, include:

- What changed
- Why it changed
- How you tested it
- Any schema, secret, or deployment impact

## Security

Do not commit secrets, real API keys, or private tokens. Use `.dev.vars` for local secrets and Wrangler secrets for deployed environments.
