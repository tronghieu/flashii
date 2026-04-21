// Hono entry. Bearer auth → resolve user → mount MCP handler at /mcp.
import { Hono } from 'hono';
import { createMcpHandler } from 'agents/mcp';
import { createServer } from './adapters/mcp.js';
import { getDb } from './infra/db.js';
import { extractBearer, resolveUserId } from './infra/auth.js';
import type { Env, Variables } from './infra/env.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/health', (c) => c.json({ ok: true, service: 'flashii-api' }));

app.all('/mcp', async (c) => {
  const token = extractBearer(c.req.header('authorization'));
  if (!token) {
    return c.json({ error: 'missing_bearer' }, 401);
  }
  const db = getDb(c.env);
  const userId = await resolveUserId(db, token);
  if (!userId) {
    return c.json({ error: 'invalid_bearer' }, 401);
  }

  const server = createServer();
  const handler = createMcpHandler(server, {
    authContext: { props: { userId, db } },
  });
  return handler(c.req.raw, c.env, c.executionCtx);
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
