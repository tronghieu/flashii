import { describe, expect, it, vi } from 'vitest';
import { buildProfileUpdate, rowToProfile } from '../src/core/users.js';

describe('rowToProfile', () => {
  it('parses a fully-populated row', () => {
    const p = rowToProfile({
      id: 'user_x',
      name: 'Hieu',
      about: 'software dev learning lexical chunks',
      native_language: 'vi',
      target_languages: '["en","zh"]',
      interests: '["AI","cooking"]',
      level: 'B2',
      method: 'lexical-chunks',
      daily_time_minutes: 30,
      timezone: 'Asia/Ho_Chi_Minh',
      goal_chunks: 1500,
      goal_deadline: '2026-07-21',
    });
    expect(p.name).toBe('Hieu');
    expect(p.about).toBe('software dev learning lexical chunks');
    expect(p.native_language).toBe('vi');
    expect(p.target_languages).toEqual(['en', 'zh']);
    expect(p.interests).toEqual(['AI', 'cooking']);
    expect(p.level).toBe('B2');
    expect(p.method).toBe('lexical-chunks');
    expect(p.daily_time_minutes).toBe(30);
    expect(p.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(p.goal_chunks).toBe(1500);
    expect(p.goal_deadline).toBe('2026-07-21');
  });

  it('normalises nulls and defaults array fields to []', () => {
    const p = rowToProfile({
      id: 'user_y',
      name: 'NewUser',
      about: null,
      native_language: null,
      target_languages: '[]',
      interests: '[]',
      level: null,
      method: null,
      daily_time_minutes: null,
      timezone: null,
      goal_chunks: null,
      goal_deadline: null,
    });
    expect(p.about).toBeNull();
    expect(p.native_language).toBeNull();
    expect(p.target_languages).toEqual([]);
    expect(p.interests).toEqual([]);
    expect(p.level).toBeNull();
    expect(p.method).toBeNull();
    expect(p.daily_time_minutes).toBeNull();
    expect(p.timezone).toBeNull();
    expect(p.goal_chunks).toBeNull();
    expect(p.goal_deadline).toBeNull();
  });

  it('tolerates malformed JSON in array columns (returns [])', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = rowToProfile({
      id: 'user_z',
      name: 'z',
      target_languages: 'not-json',
      interests: '{"not":"array"}',
    });
    expect(p.target_languages).toEqual([]);
    expect(p.interests).toEqual([]);
    warn.mockRestore();
  });
});

describe('buildProfileUpdate', () => {
  it('builds a single SET clause for a single field', () => {
    const { setClauses, bindArgs } = buildProfileUpdate({ about: 'bio' });
    expect(setClauses).toEqual(['about = ?']);
    expect(bindArgs).toEqual(['bio']);
  });

  it('supports multiple fields in a single call', () => {
    const { setClauses, bindArgs } = buildProfileUpdate({
      about: 'bio',
      level: 'B1',
      daily_time_minutes: 30,
    });
    expect(setClauses).toEqual([
      'about = ?',
      'level = ?',
      'daily_time_minutes = ?',
    ]);
    expect(bindArgs).toEqual(['bio', 'B1', 30]);
  });

  it('throws "no profile fields" on empty input', () => {
    expect(() => buildProfileUpdate({})).toThrow('no profile fields');
  });

  it('treats explicit null as clear (not skip)', () => {
    const { setClauses, bindArgs } = buildProfileUpdate({
      about: null,
      goal_deadline: null,
    });
    expect(setClauses).toEqual(['about = ?', 'goal_deadline = ?']);
    expect(bindArgs).toEqual([null, null]);
  });

  it('JSON-encodes target_languages and interests', () => {
    const { setClauses, bindArgs } = buildProfileUpdate({
      target_languages: ['en', 'zh'],
      interests: ['AI'],
    });
    expect(setClauses).toEqual(['target_languages = ?', 'interests = ?']);
    expect(bindArgs).toEqual(['["en","zh"]', '["AI"]']);
  });

  it('encodes empty arrays as "[]" (clear)', () => {
    const { bindArgs } = buildProfileUpdate({ interests: [] });
    expect(bindArgs).toEqual(['[]']);
  });
});
