import { describe, expect, it } from 'vitest';
import { schedule, newCard, State } from '../src/core/fsrs.js';

describe('fsrs.schedule', () => {
  it('initialises a brand-new card on first review with rating Good', () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const { card, log } = schedule(null, 3, now);
    expect(card.due.getTime()).toBeGreaterThan(now.getTime());
    expect(card.reps).toBeGreaterThan(0);
    expect(card.state).not.toBe(State.New);
    expect(log.rating).toBe(3);
  });

  it('Again resets state into Learning/Relearning and counts a lapse for review cards', () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const { card: first } = schedule(null, 3, now);
    const second = schedule(
      {
        state: first.state,
        stability: first.stability,
        difficulty: first.difficulty,
        due: first.due,
        last_review: now,
        elapsed_days: first.elapsed_days,
        scheduled_days: first.scheduled_days,
        reps: first.reps,
        lapses: first.lapses,
      },
      1,
      new Date(first.due.getTime()),
    );
    expect(second.card.due.getTime()).toBeGreaterThan(first.due.getTime());
  });

  it('newCard returns a New-state card due now-ish', () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const c = newCard(now);
    expect(c.state).toBe(State.New);
    expect(c.reps).toBe(0);
    expect(c.lapses).toBe(0);
  });
});
