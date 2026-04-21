// Pure card helpers. No I/O.
import { newCard } from './fsrs.js';
import type { AddCardInput, Card } from './types.js';

// Lexicographically-sortable, time-ordered ULID-ish id.
// Crockford base32, no deps. Good enough for personal-scale rows.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(now: Date = new Date()): string {
  const ts = now.getTime();
  let timeChars = '';
  let t = ts;
  for (let i = 0; i < 10; i++) {
    timeChars = CROCKFORD[t % 32] + timeChars;
    t = Math.floor(t / 32);
  }
  const randBytes = new Uint8Array(10);
  crypto.getRandomValues(randBytes);
  let randChars = '';
  for (const byte of randBytes) {
    randChars += CROCKFORD[byte % 32];
  }
  return timeChars + randChars;
}

export interface NewCardRow {
  id: string;
  user_id: string;
  front: string;
  back: string;
  ipa: string | null;
  examples: string;
  tags: string;
  status: 'ready';
  state: number;
  stability: number;
  difficulty: number;
  due_at: string;
  last_reviewed_at: null;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  created_at: string;
}

export function buildNewCard(
  input: AddCardInput,
  userId: string,
  now: Date = new Date(),
): NewCardRow {
  const seed = newCard(now);
  return {
    id: newId(now),
    user_id: userId,
    front: input.front,
    back: input.back,
    ipa: input.ipa ?? null,
    examples: JSON.stringify(input.examples),
    tags: JSON.stringify(input.tags),
    status: 'ready',
    state: seed.state,
    stability: seed.stability,
    difficulty: seed.difficulty,
    due_at: seed.due.toISOString(),
    last_reviewed_at: null,
    elapsed_days: seed.elapsed_days,
    scheduled_days: seed.scheduled_days,
    reps: seed.reps,
    lapses: seed.lapses,
    created_at: now.toISOString(),
  };
}

// JSON-encode the tag list for binding into json_each(?).
// Empty array means "no tag filter" — query SQL handles that branch via `?2 = '[]'`.
export function tagFilterArg(tags: string[] | undefined): string {
  return JSON.stringify(tags ?? []);
}

export interface CardEditInput {
  front?: string;
  back?: string;
  ipa?: string | null;
  examples?: string[];
  tags?: string[];
}

export interface CardUpdateSql {
  setClauses: string[];
  bindArgs: unknown[];
}

// Build the SET clauses + bind args for an UPDATE on the `cards` table.
// Only user-editable columns are supported; status/FSRS/image_url/created_at are
// intentionally not handled here — dedicated tools and submit_rating own those.
export function buildCardUpdate(input: CardEditInput): CardUpdateSql {
  const setClauses: string[] = [];
  const bindArgs: unknown[] = [];
  if (input.front !== undefined) {
    setClauses.push('front = ?');
    bindArgs.push(input.front);
  }
  if (input.back !== undefined) {
    setClauses.push('back = ?');
    bindArgs.push(input.back);
  }
  if (input.ipa !== undefined) {
    setClauses.push('ipa = ?');
    bindArgs.push(input.ipa);
  }
  if (input.examples !== undefined) {
    setClauses.push('examples = ?');
    bindArgs.push(JSON.stringify(input.examples));
  }
  if (input.tags !== undefined) {
    setClauses.push('tags = ?');
    bindArgs.push(JSON.stringify(input.tags));
  }
  if (setClauses.length === 0) {
    throw new Error('no editable fields');
  }
  return { setClauses, bindArgs };
}

export function parseStringArray(raw: unknown, field: string, ownerId: string): string[] {
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch (err) {
    console.warn(`parseStringArray: bad JSON in ${field} for ${ownerId}`, err);
    return [];
  }
}

// Treat empty/whitespace strings as null so `new Date('')` (Invalid Date → NaN) never reaches FSRS.
function nullableTimestamp(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length === 0 ? null : s;
}

export function rowToCard(row: Record<string, unknown>): Card {
  const id = String(row.id);
  return {
    id,
    user_id: String(row.user_id),
    front: String(row.front),
    back: String(row.back),
    ipa: row.ipa == null ? null : String(row.ipa),
    examples: parseStringArray(row.examples, 'examples', id),
    tags: parseStringArray(row.tags, 'tags', id),
    image_url: row.image_url == null ? null : String(row.image_url),
    status: String(row.status) as Card['status'],
    state: Number(row.state),
    stability: Number(row.stability),
    difficulty: Number(row.difficulty),
    due_at: String(row.due_at),
    last_reviewed_at: nullableTimestamp(row.last_reviewed_at),
    elapsed_days: Number(row.elapsed_days),
    scheduled_days: Number(row.scheduled_days),
    reps: Number(row.reps),
    lapses: Number(row.lapses),
    created_at: String(row.created_at),
  };
}
