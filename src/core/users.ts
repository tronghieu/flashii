// Pure user-profile helpers. No I/O. Mirrors the cards.ts pattern
// (`buildCardUpdate`, `rowToCard`). Testable in isolation.
import { parseStringArray } from './cards.js';

export interface Profile {
  name: string;
  about: string | null;
  native_language: string | null;
  target_languages: string[];
  interests: string[];
  level: string | null;
  method: string | null;
  daily_time_minutes: number | null;
  timezone: string | null;
  goal_chunks: number | null;
  goal_deadline: string | null;
}

export interface ProfileEditInput {
  about?: string | null;
  native_language?: string | null;
  target_languages?: string[];
  interests?: string[];
  level?: string | null;
  method?: string | null;
  daily_time_minutes?: number | null;
  timezone?: string | null;
  goal_chunks?: number | null;
  goal_deadline?: string | null;
}

export interface ProfileUpdateSql {
  setClauses: string[];
  bindArgs: unknown[];
}

// Normalize a users-table row into a Profile. Tolerant of nulls + malformed JSON.
export function rowToProfile(row: Record<string, unknown>): Profile {
  const id = String(row.id ?? '');
  const nullableNum = (v: unknown): number | null => (v == null ? null : Number(v));
  const nullableStr = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    name: String(row.name ?? ''),
    about: nullableStr(row.about),
    native_language: nullableStr(row.native_language),
    target_languages: parseStringArray(row.target_languages ?? '[]', 'target_languages', id),
    interests: parseStringArray(row.interests ?? '[]', 'interests', id),
    level: nullableStr(row.level),
    method: nullableStr(row.method),
    daily_time_minutes: nullableNum(row.daily_time_minutes),
    timezone: nullableStr(row.timezone),
    goal_chunks: nullableNum(row.goal_chunks),
    goal_deadline: nullableStr(row.goal_deadline),
  };
}

// Build SET clauses + bind args for an UPDATE on users. Uses `key in input`
// semantics so an explicit `null` means "clear field"; absence means untouched.
// Throws `no profile fields` if no supported key is present.
export function buildProfileUpdate(input: ProfileEditInput): ProfileUpdateSql {
  const setClauses: string[] = [];
  const bindArgs: unknown[] = [];
  const push = (col: string, val: unknown) => {
    setClauses.push(`${col} = ?`);
    bindArgs.push(val);
  };
  if ('about' in input) push('about', input.about ?? null);
  if ('native_language' in input) push('native_language', input.native_language ?? null);
  if ('target_languages' in input) {
    push('target_languages', JSON.stringify(input.target_languages ?? []));
  }
  if ('interests' in input) {
    push('interests', JSON.stringify(input.interests ?? []));
  }
  if ('level' in input) push('level', input.level ?? null);
  if ('method' in input) push('method', input.method ?? null);
  if ('daily_time_minutes' in input) {
    push('daily_time_minutes', input.daily_time_minutes ?? null);
  }
  if ('timezone' in input) push('timezone', input.timezone ?? null);
  if ('goal_chunks' in input) push('goal_chunks', input.goal_chunks ?? null);
  if ('goal_deadline' in input) push('goal_deadline', input.goal_deadline ?? null);
  if (setClauses.length === 0) {
    throw new Error('no profile fields');
  }
  return { setClauses, bindArgs };
}
