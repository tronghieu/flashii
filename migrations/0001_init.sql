-- Flashii initial schema. See _bmad-output/planning-artifacts/architecture.md §3.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  api_key_hash    TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  goal_chunks     INTEGER,
  goal_deadline   TEXT,
  level           TEXT,
  method          TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  front             TEXT NOT NULL,
  back              TEXT NOT NULL,
  ipa               TEXT,
  examples          TEXT NOT NULL,                        -- JSON array of strings
  tags              TEXT NOT NULL DEFAULT '[]',           -- JSON array of strings
  image_url         TEXT,
  status            TEXT NOT NULL DEFAULT 'ready',        -- 'ready' | 'suspended'
  -- FSRS materialized snapshot (rebuildable from reviews):
  state             INTEGER NOT NULL DEFAULT 0,           -- 0=New 1=Learning 2=Review 3=Relearning
  stability         REAL NOT NULL DEFAULT 0,
  difficulty        REAL NOT NULL DEFAULT 0,
  due_at            TEXT NOT NULL,
  last_reviewed_at  TEXT,
  elapsed_days      REAL NOT NULL DEFAULT 0,
  scheduled_days    REAL NOT NULL DEFAULT 0,
  reps              INTEGER NOT NULL DEFAULT 0,
  lapses            INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_due
  ON cards(user_id, status, due_at);

CREATE TABLE IF NOT EXISTS reviews (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  card_id           TEXT NOT NULL REFERENCES cards(id),
  rating            INTEGER NOT NULL,                     -- 1=Again 2=Hard 3=Good 4=Easy
  reviewed_at       TEXT NOT NULL,
  elapsed_days      REAL NOT NULL,
  stability_after   REAL NOT NULL,
  difficulty_after  REAL NOT NULL,
  due_after         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_user_time
  ON reviews(user_id, reviewed_at);
