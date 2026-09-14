CREATE TABLE account_challenges (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN('reset','link','access','registration')),
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 telegram_id TEXT,
 token_hash TEXT NOT NULL UNIQUE,
 bot_hash TEXT NOT NULL UNIQUE,
 code_hash TEXT NOT NULL UNIQUE,
 payload TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN('waiting','approved','denied','consumed','canceled')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 completion_id TEXT
);
CREATE INDEX account_challenges_user ON account_challenges(user_id,kind,status);
CREATE TABLE account_security_rate(rate_key TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE TABLE account_reset_cooldown(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,completed_at INTEGER NOT NULL);
