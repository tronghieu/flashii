// Rotate the API key for an existing user. Prints the new key once.
// Usage:
//   pnpm rotate-key --name "Lưu Hiếu"
//   pnpm rotate-key --user-id 01K6...
import { createClient } from '@libsql/client';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadDevVars(): Promise<void> {
  if (process.env.TURSO_URL) return;
  try {
    const text = await readFile(join(__dirname, '..', '.dev.vars'), 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith('--')) {
        out[key] = val;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  await loadDevVars();
  const args = parseArgs();
  const name = args.name;
  const userId = args['user-id'];
  if (!name && !userId) {
    console.error('Usage: pnpm rotate-key --name "<name>" | --user-id <id>');
    process.exit(1);
  }

  const url = process.env.TURSO_URL;
  if (!url) {
    console.error('TURSO_URL not set (env or .dev.vars)');
    process.exit(1);
  }
  const client = createClient({ url, authToken: process.env.TURSO_TOKEN ?? '' });

  const lookupSql = userId
    ? 'SELECT id, name FROM users WHERE id = ? LIMIT 2'
    : 'SELECT id, name FROM users WHERE name = ? LIMIT 2';
  const { rows } = await client.execute({
    sql: lookupSql,
    args: [userId ?? name!],
  });
  if (rows.length === 0) {
    console.error(`No user found for ${userId ? `id=${userId}` : `name="${name}"`}`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`Multiple users matched — use --user-id to disambiguate. Matches:`);
    for (const r of rows) console.error(`  id=${String(r.id)} name="${String(r.name)}"`);
    process.exit(1);
  }
  const target = rows[0]!;
  const targetId = String(target.id);
  const targetName = String(target.name);

  const apiKey = randomBytes(32).toString('hex');
  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');

  await client.execute({
    sql: 'UPDATE users SET api_key_hash = ? WHERE id = ?',
    args: [apiKeyHash, targetId],
  });

  console.log('user_id:', targetId);
  console.log('name:   ', targetName);
  console.log('api_key:', apiKey);
  console.log('\nKey rotated. Save the new api_key now — it is not stored, only its sha256 hash.');
  console.log('The previous key is no longer valid.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
