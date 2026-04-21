// Per-isolate libSQL client cache. Use the /web subpath — Workers-compatible.
import { createClient, type Client } from '@libsql/client/web';
import type { Env } from './env.js';

const cache = new WeakMap<object, Client>();

export function getDb(env: Env): Client {
  let client = cache.get(env);
  if (!client) {
    client = createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN });
    cache.set(env, client);
  }
  return client;
}

// Retry wrapper for read-only operations only (one retry, 100ms backoff).
// NEVER wrap non-idempotent writes (INSERT/UPDATE/db.batch) — a transient failure
// after partial server commit would double-write or PK-conflict on retry.
export async function withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn('libsql read retry after error:', err);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return await fn();
  }
}
