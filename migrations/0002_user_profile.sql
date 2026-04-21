-- Broaden user profile for coaching (spec: spec-get-progress.md).
-- ALTER ADD COLUMN is non-rewriting in SQLite; existing rows get DEFAULT or NULL.

ALTER TABLE users ADD COLUMN about TEXT;
ALTER TABLE users ADD COLUMN native_language TEXT;
ALTER TABLE users ADD COLUMN target_languages TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN interests TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN daily_time_minutes INTEGER;
ALTER TABLE users ADD COLUMN timezone TEXT;
