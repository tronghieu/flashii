import { describe, expect, it } from 'vitest';
import { buildNewCard, newId, rowToCard, tagFilterArg } from '../src/core/cards.js';
import { applyRating } from '../src/core/reviews.js';
import type { Card } from '../src/core/types.js';

describe('newId', () => {
  it('produces 20-char ids and sorts time-ascending', async () => {
    const a = newId(new Date('2026-04-21T00:00:00Z'));
    await new Promise((r) => setTimeout(r, 2));
    const b = newId(new Date('2026-04-21T00:00:01Z'));
    expect(a).toHaveLength(20);
    expect(b).toHaveLength(20);
    expect(a < b).toBe(true);
  });
});

describe('buildNewCard', () => {
  it('serialises examples and tags as JSON arrays and stamps a due_at', () => {
    const row = buildNewCard(
      {
        front: 'fine-tune a model',
        back: 'to adapt a pre-trained ML model',
        examples: ['We fine-tuned the model on our data.', 'Fine-tuning is cheap now.'],
        tags: ['AI', 'verb-phrase'],
      },
      'user_x',
      new Date('2026-04-21T00:00:00Z'),
    );
    expect(row.user_id).toBe('user_x');
    expect(JSON.parse(row.examples)).toHaveLength(2);
    expect(JSON.parse(row.tags)).toEqual(['AI', 'verb-phrase']);
    expect(row.status).toBe('ready');
    expect(typeof row.due_at).toBe('string');
    expect(row.reps).toBe(0);
  });
});

describe('tagFilterArg', () => {
  it('returns "[]" for undefined or empty array', () => {
    expect(tagFilterArg(undefined)).toBe('[]');
    expect(tagFilterArg([])).toBe('[]');
  });
  it('JSON-encodes tags', () => {
    expect(tagFilterArg(['AI', 'verb'])).toBe('["AI","verb"]');
  });
});

describe('applyRating', () => {
  const baseCard: Card = {
    id: 'card_1',
    user_id: 'user_x',
    front: 'fine-tune',
    back: 'def',
    ipa: null,
    examples: ['ex'],
    tags: ['AI'],
    image_url: null,
    status: 'ready',
    state: 0,
    stability: 0,
    difficulty: 0,
    due_at: '2026-04-21T00:00:00.000Z',
    last_reviewed_at: null,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    created_at: '2026-04-21T00:00:00.000Z',
  };

  it('returns review row + card update with consistent due_after', () => {
    const now = new Date('2026-04-21T08:00:00Z');
    const delta = applyRating(baseCard, 3, now);
    expect(delta.reviewRow.card_id).toBe(baseCard.id);
    expect(delta.reviewRow.user_id).toBe(baseCard.user_id);
    expect(delta.reviewRow.rating).toBe(3);
    expect(delta.reviewRow.due_after).toBe(delta.cardUpdate.due_at);
    expect(delta.cardUpdate.last_reviewed_at).toBe(now.toISOString());
    expect(delta.cardUpdate.reps).toBeGreaterThan(0);
  });
});

describe('rowToCard', () => {
  it('parses JSON columns and coerces nullables', () => {
    const card = rowToCard({
      id: 'c1',
      user_id: 'u1',
      front: 'f',
      back: 'b',
      ipa: null,
      examples: '["a","b"]',
      tags: '["x"]',
      image_url: null,
      status: 'ready',
      state: 0,
      stability: 0,
      difficulty: 0,
      due_at: '2026-04-21T00:00:00.000Z',
      last_reviewed_at: null,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      created_at: '2026-04-21T00:00:00.000Z',
    });
    expect(card.examples).toEqual(['a', 'b']);
    expect(card.tags).toEqual(['x']);
    expect(card.ipa).toBeNull();
  });
});
