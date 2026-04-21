// Hono entry. Auth via `?key=` query param OR `Authorization: Bearer <key>` header
// (header takes precedence). Both resolve to the same `users.api_key_hash` lookup.
import { Hono } from 'hono';
import { createMcpHandler } from 'agents/mcp';
import { createServer } from './adapters/mcp.js';
import { getDb } from './infra/db.js';
import { extractBearer, resolveUserId } from './infra/auth.js';
import type { Env, Variables } from './infra/env.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/health', (c) => c.json({ ok: true, service: 'flashii-api' }));

app.all('/mcp', async (c) => {
  const token =
    extractBearer(c.req.header('authorization')) ?? c.req.query('key') ?? null;
  if (!token) {
    return c.json({ error: 'missing_key' }, 401);
  }
  const db = getDb(c.env);
  const userId = await resolveUserId(db, token);
  if (!userId) {
    return c.json({ error: 'invalid_key' }, 401);
  }

  const baseUrl = new URL(c.req.url).origin;
  const server = createServer();
  const handler = createMcpHandler(server, {
    authContext: { props: { userId, db, env: c.env, baseUrl } },
  });
  return handler(c.req.raw, c.env, c.executionCtx);
});

// Public image route — keys are unguessable ULIDs, no auth needed in MVP.
app.get('/img/:userId/:filename{.+\\.png}', async (c) => {
  const key = `${c.req.param('userId')}/${c.req.param('filename')}`;
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
