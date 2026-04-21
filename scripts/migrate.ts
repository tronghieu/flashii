// Apply migrations/*.sql in lexical order. Idempotent via schema_migrations table.
// Usage: TURSO_URL=... TURSO_TOKEN=... pnpm migrate
import { createClient } from '@libsql/client';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

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
    // file optional
  }
}

async function main(): Promise<void> {
  await loadDevVars();
  const url = process.env.TURSO_URL;
  if (!url) {
    console.error('TURSO_URL not set (env or .dev.vars)');
    process.exit(1);
  }
  const client = createClient({ url, authToken: process.env.TURSO_TOKEN ?? '' });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const { rows } = await client.execute({
      sql: 'SELECT 1 FROM schema_migrations WHERE version = ?',
      args: [version],
    });
    if (rows.length > 0) {
      console.log(`skip   ${version}`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

    // Apply each migration as one atomic unit. executeMultiple parses raw SQL
    // (handles trigger bodies / string-literal semicolons) and BEGIN/COMMIT
    // ensures partial application rolls back on failure.
    const escVer = version.replace(/'/g, "''");
    const escAt = new Date().toISOString().replace(/'/g, "''");
    const wrapped = `BEGIN;\n${sql}\nINSERT INTO schema_migrations (version, applied_at) VALUES ('${escVer}', '${escAt}');\nCOMMIT;`;
    try {
      await client.executeMultiple(wrapped);
    } catch (err) {
      await client.executeMultiple('ROLLBACK;').catch(() => {});
      throw new Error(`migration ${version} failed: ${(err as Error).message}`);
    }
    console.log(`apply  ${version}`);
  }
  console.log('migrations done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
