-- Server-side login sessions. The browser holds a random token in an HttpOnly cookie;
-- only its SHA-256 hash is stored here, so a leaked database cannot be used to hijack sessions.
CREATE TABLE sessions (
  id_hash      text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
