ALTER TABLE admin_profiles ADD COLUMN can_manage_announcements INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_announcements IN(0,1));
CREATE TABLE app_announcements (
 id TEXT PRIMARY KEY,
 json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','canceled')),
 starts_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX app_announcements_active ON app_announcements(status,starts_at,expires_at);
CREATE TABLE app_announcement_receipts (
 announcement_id TEXT NOT NULL REFERENCES app_announcements(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 installed_version INTEGER NOT NULL,
 checked_at INTEGER NOT NULL,
 displayed_at INTEGER,
 dismissed_at INTEGER,
 opened_at INTEGER,
 PRIMARY KEY(announcement_id,session_id)
);
