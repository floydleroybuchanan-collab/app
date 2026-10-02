CREATE TABLE IF NOT EXISTS bot_join_requests (
 group_id TEXT NOT NULL,
 telegram_id TEXT NOT NULL,
 update_id INTEGER NOT NULL,
 requested_at INTEGER NOT NULL,
 user_chat_id TEXT NOT NULL,
 invite_link TEXT,
 group_invite_id TEXT,
 token_id TEXT,
 waiting_sent INTEGER NOT NULL DEFAULT 0,
 welcome_sent INTEGER NOT NULL DEFAULT 0,
 token_sent INTEGER NOT NULL DEFAULT 0,
 approved_at INTEGER,
 state TEXT NOT NULL DEFAULT 'pending',
 last_error TEXT,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(group_id,telegram_id)
);
