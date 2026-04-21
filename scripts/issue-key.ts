// Issue an API key for a user. Prints the key once; only the sha256 hash is stored.
// Usage: pnpm issue-key --name "Lưu Hiếu" [--goal-chunks 1500] [--goal-deadline 2026-07-21] [--level B1] [--method lexical-chunks]
import { createClient } from '@libsql/client';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'node:process';

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

function newId(): string {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let ts = Date.now();
  let timeChars = '';
  for (let i = 0; i < 10; i++) {
    timeChars = CROCKFORD[ts % 32] + timeChars;
    ts = Math.floor(ts / 32);
  }
  const rand = randomBytes(10);
  let randChars = '';
  for (const byte of rand) randChars += CROCKFORD[byte % 32];
  return timeChars + randChars;
}

async function main(): Promise<void> {
  await loadDevVars();
  const args = parseArgs();
  const name = args.name;
  if (!name) {
    console.error('Usage: pnpm issue-key --name "<name>" [--goal-chunks N] [--goal-deadline YYYY-MM-DD] [--level B1] [--method lexical-chunks]');
    process.exit(1);
  }

  const url = process.env.TURSO_URL;
  if (!url) {
    console.error('TURSO_URL not set (env or .dev.vars)');
    process.exit(1);
  }
  const client = createClient({ url, authToken: process.env.TURSO_TOKEN ?? '' });

  const apiKey = randomBytes(32).toString('hex');
  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');

  const id = newId();
  const now = new Date().toISOString();

  await client.execute({
    sql: `INSERT INTO users
            (id, api_key_hash, name, goal_chunks, goal_deadline, level, method, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      apiKeyHash,
      name,
      args['goal-chunks'] ? Number(args['goal-chunks']) : null,
      args['goal-deadline'] ?? null,
      args.level ?? null,
      args.method ?? null,
      now,
    ],
  });

  console.log('user_id:', id);
  console.log('api_key:', apiKey);
  console.log('\nSave the api_key now — it is not stored, only its sha256 hash.');
  console.log('Use it as: Authorization: Bearer ' + apiKey);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
