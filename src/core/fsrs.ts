// Pure wrapper over ts-fsrs v5. No I/O.
// See _bmad-output/planning-artifacts/architecture.md §5.
import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
  type ReviewLog,
} from 'ts-fsrs';
import type { CardState, RatingValue } from './types.js';

const scheduler = fsrs(
  generatorParameters({ enable_fuzz: true, request_retention: 0.9 }),
);

export interface ScheduleResult {
  card: FsrsCard;
  log: ReviewLog;
}

const RATING_MAP: Record<RatingValue, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

export function toRating(r: RatingValue): Grade {
  return RATING_MAP[r];
}

function hydrate(state: CardState): FsrsCard {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.last_review ? new Date(state.last_review) : undefined,
  } as FsrsCard;
}

export function newCard(now: Date): FsrsCard {
  return createEmptyCard(now);
}

export function schedule(
  state: CardState | null,
  rating: RatingValue,
  now: Date,
): ScheduleResult {
  const card = state ? hydrate(state) : createEmptyCard(now);
  const { card: next, log } = scheduler.next(card, now, toRating(rating));
  return { card: next, log };
}

export { State };
