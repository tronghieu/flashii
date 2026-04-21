// Pure domain types. No I/O, no library imports beyond ts-fsrs enums.
import { Rating, State } from 'ts-fsrs';

export { Rating, State };
export type { Profile } from './users.js';

export type RatingValue = 1 | 2 | 3 | 4;

export interface User {
  id: string;
  api_key_hash: string;
  name: string;
  goal_chunks: number | null;
  goal_deadline: string | null;
  level: string | null;
  method: string | null;
  created_at: string;
}

export interface Card {
  id: string;
  user_id: string;
  front: string;
  back: string;
  ipa: string | null;
  examples: string[];
  tags: string[];
  image_url: string | null;
  status: 'ready' | 'suspended';
  state: State;
  stability: number;
  difficulty: number;
  due_at: string;
  last_reviewed_at: string | null;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  created_at: string;
}

export interface Review {
  id: string;
  user_id: string;
  card_id: string;
  rating: RatingValue;
  reviewed_at: string;
  elapsed_days: number;
  stability_after: number;
  difficulty_after: number;
  due_after: string;
}

// Subset of Card needed by the FSRS scheduler. Mirrors ts-fsrs `Card` shape.
export interface CardState {
  state: State;
  stability: number;
  difficulty: number;
  due: Date;
  last_review: Date | null;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
}

export interface AddCardInput {
  front: string;
  back: string;
  ipa?: string;
  examples: string[];
  tags: string[];
}
