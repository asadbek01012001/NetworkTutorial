package main

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Schema is applied on every start; all statements are idempotent.
const schema = `
CREATE TABLE IF NOT EXISTS users (
	id         BIGSERIAL PRIMARY KEY,
	username   TEXT NOT NULL UNIQUE,
	token      TEXT UNIQUE,
	ip         TEXT NOT NULL,
	user_agent TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_ip_idx ON users (ip, last_seen DESC);

-- Accounts (2026-10-30): usernames are chosen by people and unique without
-- regard to case; passwords are stored as PBKDF2 hashes. Older databases had
-- auto-generated AdminNN names and an IP/cookie identity: convert in place.
ALTER TABLE users ALTER COLUMN username DROP EXPRESSION IF EXISTS;
ALTER TABLE users ALTER COLUMN token DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

-- One row per logged-in browser; only the SHA-256 of the token is kept.
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	ip         TEXT NOT NULL DEFAULT '',
	user_agent TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
	expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS progress (
	user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	lesson_id   TEXT NOT NULL,
	position    DOUBLE PRECISION NOT NULL DEFAULT 0,
	-- Seconds of real playback counted from heartbeats; gates "video done".
	watched     DOUBLE PRECISION NOT NULL DEFAULT 0,
	last_beat   TIMESTAMPTZ,
	video_done  BOOLEAN NOT NULL DEFAULT false,
	test_passed BOOLEAN NOT NULL DEFAULT false,
	best_score  INT NOT NULL DEFAULT 0,
	updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, lesson_id)
);

-- When best_score last improved; breaks ties in the rating.
ALTER TABLE progress ADD COLUMN IF NOT EXISTS best_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS test_attempts (
	id         BIGSERIAL PRIMARY KEY,
	user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	lesson_id  TEXT NOT NULL,
	score      INT NOT NULL,
	total      INT NOT NULL,
	answers    JSONB NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_attempts_user_idx ON test_attempts (user_id, lesson_id);

-- General exam over the whole course; kept apart from test_attempts and
-- progress so it never counts towards the rating.
CREATE TABLE IF NOT EXISTS exam_attempts (
	id         BIGSERIAL PRIMARY KEY,
	user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	score      INT NOT NULL,
	total      INT NOT NULL,
	answers    JSONB NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_attempts_user_idx ON exam_attempts (user_id);
-- Every attempt gets its own random questions (with answers), stored when it
-- starts; score and answers are filled in once it is submitted.
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS questions JSONB;
ALTER TABLE exam_attempts ALTER COLUMN score DROP NOT NULL;
ALTER TABLE exam_attempts ALTER COLUMN answers DROP NOT NULL;
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
UPDATE exam_attempts SET checked_at = created_at WHERE checked_at IS NULL AND score IS NOT NULL;

-- Interactive practice tasks; the expected answer never leaves the server
-- before the task is checked (once).
CREATE TABLE IF NOT EXISTS practice_tasks (
	id         BIGSERIAL PRIMARY KEY,
	user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind       TEXT NOT NULL,
	task       JSONB NOT NULL,
	answer     JSONB NOT NULL,
	given      JSONB,
	score      INT,
	total      INT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	checked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS practice_tasks_user_idx ON practice_tasks (user_id, kind);
-- Number of the task in the fixed bank of its kind (older rows: NULL).
ALTER TABLE practice_tasks ADD COLUMN IF NOT EXISTS num INT;
`

func openDB(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
