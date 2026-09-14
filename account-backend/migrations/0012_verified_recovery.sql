CREATE TABLE account_recovery_grants (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 challenge_id TEXT UNIQUE,
 used_at INTEGER
);
CREATE INDEX account_recovery_user ON account_recovery_grants(user_id,expires_at);
