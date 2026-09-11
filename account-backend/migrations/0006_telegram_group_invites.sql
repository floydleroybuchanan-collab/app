-- Additive: group admission links are separate from app registration invites.
CREATE TABLE bot_group_invites (
 id TEXT PRIMARY KEY,
 group_id TEXT NOT NULL,
 telegram_id TEXT,
 recipient_label TEXT NOT NULL DEFAULT 'New member',
 request_key TEXT UNIQUE,
 username TEXT NOT NULL DEFAULT '',
 invite_link TEXT UNIQUE,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER,
 status TEXT NOT NULL CHECK(status IN ('creating','active','pending','approving','used','revoked','expired','failed')),
 approval_mode TEXT NOT NULL DEFAULT 'manual' CHECK(approval_mode IN ('manual','automatic')),
 request_at INTEGER,
 used_at INTEGER,
 used_by TEXT,
 used_username TEXT,
 joined_at INTEGER,
 revoked_at INTEGER,
 last_error TEXT,
 lease_token TEXT,
 last_attempt_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX bot_group_invites_one_active ON bot_group_invites(group_id,telegram_id)
 WHERE status IN ('creating','active','pending','approving');
CREATE INDEX bot_group_invites_cleanup ON bot_group_invites(status,revoked_at,lease_until);
CREATE TABLE bot_group_invite_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 invite_id TEXT NOT NULL REFERENCES bot_group_invites(id),
 update_id INTEGER NOT NULL,
 telegram_id TEXT NOT NULL,
 username TEXT NOT NULL DEFAULT '',
 requested_at INTEGER NOT NULL,
 processed_at INTEGER,
 outcome TEXT NOT NULL,
 UNIQUE(invite_id,update_id)
);
