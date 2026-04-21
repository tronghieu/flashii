// Bearer token → user_id resolution via sha256 lookup. Web Crypto only.
import type { Client } from '@libsql/client/web';

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function resolveUserId(
  db: Client,
  bearerToken: string,
): Promise<string | null> {
  if (!bearerToken) return null;
  const hash = await sha256Hex(bearerToken);
  const { rows } = await db.execute({
    sql: 'SELECT id FROM users WHERE api_key_hash = ? LIMIT 1',
    args: [hash],
  });
  const row = rows[0];
  return row ? String(row.id) : null;
}

export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}
