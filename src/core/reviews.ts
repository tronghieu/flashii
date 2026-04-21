// Pure review helper. Consumes current card state, applies FSRS, returns deltas the
// caller should INSERT into reviews and UPDATE on cards (single transaction).
import { schedule } from './fsrs.js';
import { newId } from './cards.js';
import type { Card, RatingValue } from './types.js';

export interface RatingDelta {
  reviewRow: {
    id: string;
    user_id: string;
    card_id: string;
    rating: RatingValue;
    reviewed_at: string;
    elapsed_days: number;
    stability_after: number;
    difficulty_after: number;
    due_after: string;
  };
  cardUpdate: {
    state: number;
    stability: number;
    difficulty: number;
    due_at: string;
    last_reviewed_at: string;
    elapsed_days: number;
    scheduled_days: number;
    reps: number;
    lapses: number;
  };
}

export function applyRating(
  card: Card,
  rating: RatingValue,
  now: Date = new Date(),
): RatingDelta {
  const { card: next, log } = schedule(
    {
      state: card.state,
      stability: card.stability,
      difficulty: card.difficulty,
      due: new Date(card.due_at),
      last_review: card.last_reviewed_at ? new Date(card.last_reviewed_at) : null,
      elapsed_days: card.elapsed_days,
      scheduled_days: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
    },
    rating,
    now,
  );

  return {
    reviewRow: {
      id: newId(now),
      user_id: card.user_id,
      card_id: card.id,
      rating,
      reviewed_at: now.toISOString(),
      elapsed_days: log.elapsed_days,
      stability_after: next.stability,
      difficulty_after: next.difficulty,
      due_after: next.due.toISOString(),
    },
    cardUpdate: {
      state: next.state,
      stability: next.stability,
      difficulty: next.difficulty,
      due_at: next.due.toISOString(),
      last_reviewed_at: now.toISOString(),
      elapsed_days: next.elapsed_days,
      scheduled_days: next.scheduled_days,
      reps: next.reps,
      lapses: next.lapses,
    },
  };
}
