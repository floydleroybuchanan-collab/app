CREATE TABLE users (     id TEXT PRIMARY KEY,     username TEXT NOT NULL UNIQUE,     email TEXT NOT NULL UNIQUE,     password_hash TEXT NOT NULL,      role TEXT NOT NULL DEFAULT 'user'         CHECK (role IN ('user', 'admin')),      status TEXT NOT NULL DEFAULT 'active'         CHECK (status IN ('active', 'disabled', 'expired')),      max_sessions INTEGER NOT NULL DEFAULT 1,      created_at INTEGER NOT NULL DEFAULT (unixepoch()),     activated_at INTEGER,     expires_at INTEGER,     last_login_at INTEGER );
CREATE TABLE invites (     id TEXT PRIMARY KEY,     invite_code TEXT NOT NULL UNIQUE,      status TEXT NOT NULL DEFAULT 'unused'         CHECK (status IN ('unused', 'used', 'disabled', 'expired')),      account_duration_days INTEGER,     max_sessions INTEGER NOT NULL DEFAULT 1,      created_by_user_id TEXT,     created_at INTEGER NOT NULL DEFAULT (unixepoch()),     expires_at INTEGER,      redeemed_by_user_id TEXT,     redeemed_at INTEGER,      FOREIGN KEY (created_by_user_id) REFERENCES users(id),     FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id) );
CREATE TABLE sessions (     id TEXT PRIMARY KEY,     user_id TEXT NOT NULL,      token_hash TEXT NOT NULL UNIQUE,      created_at INTEGER NOT NULL DEFAULT (unixepoch()),     last_activity_at INTEGER NOT NULL DEFAULT (unixepoch()),     expires_at INTEGER NOT NULL,      revoked INTEGER NOT NULL DEFAULT 0,      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE );
CREATE TABLE password_reset_tokens (     id TEXT PRIMARY KEY,     user_id TEXT NOT NULL,      token_hash TEXT NOT NULL UNIQUE,      created_at INTEGER NOT NULL DEFAULT (unixepoch()),     expires_at INTEGER NOT NULL,     used INTEGER NOT NULL DEFAULT 0,      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE );
CREATE TABLE user_preferences (     user_id TEXT PRIMARY KEY,      preferences_json TEXT NOT NULL DEFAULT '{}',      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE );
CREATE TABLE audit_log (     id INTEGER PRIMARY KEY AUTOINCREMENT,      user_id TEXT,     admin_user_id TEXT,      action TEXT NOT NULL,     details TEXT,      created_at INTEGER NOT NULL DEFAULT (unixepoch()) );
CREATE TABLE referral_invites ( id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','active','disabled','code_expired','account_expired','canceled')), network_slot_number INTEGER CHECK (network_slot_number BETWEEN 1 AND 6), max_sessions INTEGER NOT NULL, grant_expires_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()), expires_at INTEGER NOT NULL, redeemed_by_user_id TEXT, redeemed_at INTEGER, ended_at INTEGER, end_reason TEXT, FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id));
CREATE TABLE referral_slots ( owner_user_id TEXT NOT NULL, slot_number INTEGER NOT NULL CHECK (slot_number IN (1,2)), invite_id TEXT, consumed_at INTEGER, cycle_started_at INTEGER NOT NULL, cycle_ends_at INTEGER NOT NULL, PRIMARY KEY (owner_user_id,slot_number), FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE referral_network_slots ( owner_user_id TEXT NOT NULL, slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 6), invite_id TEXT, PRIMARY KEY (owner_user_id,slot_number), FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE admin_owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT
);
CREATE TABLE admin_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  can_create_invites INTEGER NOT NULL DEFAULT 0 CHECK (can_create_invites IN (0,1)),
  can_manage_all INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_all IN (0,1)),
  can_change_time INTEGER NOT NULL DEFAULT 0 CHECK (can_change_time IN (0,1)),
  can_change_sessions INTEGER NOT NULL DEFAULT 0 CHECK (can_change_sessions IN (0,1)),
  can_suspend INTEGER NOT NULL DEFAULT 0 CHECK (can_suspend IN (0,1)),
  can_delete_users INTEGER NOT NULL DEFAULT 0 CHECK (can_delete_users IN (0,1)),
  can_reset_password INTEGER NOT NULL DEFAULT 0 CHECK (can_reset_password IN (0,1)),
  can_force_logout INTEGER NOT NULL DEFAULT 0 CHECK (can_force_logout IN (0,1)),
  can_revoke_invites INTEGER NOT NULL DEFAULT 0 CHECK (can_revoke_invites IN (0,1)),
  can_delete_invites INTEGER NOT NULL DEFAULT 0 CHECK (can_delete_invites IN (0,1)),
  can_view_audit INTEGER NOT NULL DEFAULT 0 CHECK (can_view_audit IN (0,1)),
  max_duration_days INTEGER NOT NULL DEFAULT 90 CHECK (max_duration_days BETWEEN 1 AND 3650),
  max_sessions INTEGER NOT NULL DEFAULT 2 CHECK (max_sessions BETWEEN 1 AND 20),
  max_accounts_total INTEGER NOT NULL DEFAULT 0 CHECK (max_accounts_total BETWEEN 0 AND 1000000),
  max_open_accounts INTEGER NOT NULL DEFAULT 0 CHECK (max_open_accounts BETWEEN 0 AND 1000000),
  max_pending_invites INTEGER NOT NULL DEFAULT 0 CHECK (max_pending_invites BETWEEN 0 AND 1000),
  max_invite_valid_days INTEGER NOT NULL DEFAULT 7 CHECK (max_invite_valid_days BETWEEN 1 AND 365),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, viewer_access INTEGER NOT NULL DEFAULT 0 CHECK(viewer_access IN (0,1)), can_manage_bot INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_bot IN(0,1)), can_manage_announcements INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_announcements IN(0,1)));
CREATE TABLE admin_account_stats (
  admin_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  accounts_created INTEGER NOT NULL DEFAULT 0,
  accounts_expired INTEGER NOT NULL DEFAULT 0,
  accounts_canceled INTEGER NOT NULL DEFAULT 0,
  accounts_deleted INTEGER NOT NULL DEFAULT 0,
  invites_created INTEGER NOT NULL DEFAULT 0,
  tracking_started_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE admin_user_attribution (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL CHECK (origin IN ('admin_invite','referral')),
  created_at INTEGER NOT NULL,
  end_reason TEXT
);
CREATE TABLE "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE bot_content(key TEXT PRIMARY KEY, body TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, updated_by TEXT);
CREATE TABLE bot_content_history(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT NOT NULL,body TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT);
CREATE TABLE bot_settings(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE bot_members(telegram_id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'unknown',requested_at INTEGER,joined_at INTEGER,updated_at INTEGER NOT NULL,invite_id TEXT UNIQUE REFERENCES invites(id) ON DELETE SET NULL,account_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,ever_assigned INTEGER NOT NULL DEFAULT 0,blocked INTEGER NOT NULL DEFAULT 0,dm_started INTEGER NOT NULL DEFAULT 0);
CREATE TABLE bot_events(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',admin_id TEXT,created_at INTEGER NOT NULL);
CREATE TABLE bot_updates(id INTEGER PRIMARY KEY,status TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE bot_rate(telegram_id TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE TABLE bot_support_admins(telegram_id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 0, contact_username TEXT NOT NULL DEFAULT '');
CREATE TABLE bot_support(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE bot_conversations(telegram_id TEXT PRIMARY KEY,state TEXT NOT NULL,json TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE bot_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,chat_id TEXT NOT NULL,message_id INTEGER,body TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',due_at INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '', dedupe_key TEXT);
CREATE TABLE bot_runtime(key TEXT PRIMARY KEY,value TEXT NOT NULL);
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
CREATE TABLE app_controls (
 id INTEGER PRIMARY KEY CHECK(id=1),
 json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE app_service_errors (
 day INTEGER PRIMARY KEY,
 count INTEGER NOT NULL DEFAULT 0,
 last_at INTEGER NOT NULL
);
CREATE TABLE account_telegram_contacts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL DEFAULT '',
  telegram_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE bot_responses (
 response_key TEXT PRIMARY KEY,
 recipient_id TEXT NOT NULL,
 generation TEXT NOT NULL,
 chat_id TEXT NOT NULL,
 message_id INTEGER NOT NULL,
 ephemeral INTEGER NOT NULL DEFAULT 0 CHECK(ephemeral IN(0,1)),
 created_at INTEGER NOT NULL,
 due_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0
);
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
CREATE TABLE account_security_rate(rate_key TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE TABLE account_reset_cooldown(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,completed_at INTEGER NOT NULL);
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
CREATE TABLE website_announcements (
 id INTEGER PRIMARY KEY CHECK(id=1),
 json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 next_at INTEGER
);
CREATE TABLE website_release (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 1,
 json TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT
);
CREATE TABLE website_release_history(id INTEGER PRIMARY KEY AUTOINCREMENT,revision INTEGER NOT NULL,json TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT);
CREATE TABLE app_presence (
 session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL, mode TEXT NOT NULL, playing INTEGER NOT NULL,
 last_seen INTEGER NOT NULL, started_at INTEGER NOT NULL, build INTEGER NOT NULL
);
CREATE TABLE app_usage_daily (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day INTEGER NOT NULL,
 iptv_seconds INTEGER NOT NULL DEFAULT 0, vod_seconds INTEGER NOT NULL DEFAULT 0,
 foreground_seconds INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0, signins INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,day)
);
CREATE TABLE app_usage_metadata(id INTEGER PRIMARY KEY CHECK(id=1),started_at INTEGER NOT NULL);
CREATE TABLE bot_join_requests (
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
CREATE TRIGGER admin_account_created AFTER INSERT ON admin_user_attribution
WHEN NEW.origin='admin_invite'
BEGIN
  UPDATE admin_account_stats SET accounts_created=accounts_created+1 WHERE admin_user_id=NEW.admin_user_id;
END;
CREATE TRIGGER admin_invite_created AFTER INSERT ON invites
BEGIN
  UPDATE admin_account_stats SET invites_created=invites_created+1 WHERE admin_user_id=NEW.created_by_user_id;
END;
CREATE TRIGGER admin_account_ended BEFORE DELETE ON users WHEN OLD.role='user'
BEGIN
  UPDATE admin_account_stats SET
    accounts_expired=accounts_expired+CASE WHEN (SELECT end_reason FROM admin_user_attribution WHERE user_id=OLD.id)='account_expired' THEN 1 ELSE 0 END,
    accounts_canceled=accounts_canceled+CASE WHEN (SELECT end_reason FROM admin_user_attribution WHERE user_id=OLD.id)='user_canceled' THEN 1 ELSE 0 END,
    accounts_deleted=accounts_deleted+CASE WHEN (SELECT end_reason FROM admin_user_attribution WHERE user_id=OLD.id)='admin_deleted' THEN 1 ELSE 0 END
  WHERE admin_user_id=(SELECT admin_user_id FROM admin_user_attribution WHERE user_id=OLD.id AND origin='admin_invite');
END;
CREATE TRIGGER bot_account_registered AFTER UPDATE OF redeemed_by_user_id ON invites WHEN NEW.redeemed_by_user_id IS NOT NULL BEGIN
 UPDATE bot_members SET account_id=NEW.redeemed_by_user_id WHERE invite_id=NEW.id;
 INSERT INTO bot_events(telegram_id,action,created_at) SELECT telegram_id,'account_activated',unixepoch() FROM bot_members WHERE invite_id=NEW.id;
END;
CREATE TRIGGER bot_account_removed BEFORE DELETE ON users BEGIN
 UPDATE bot_members SET blocked=1 WHERE account_id=OLD.id;
END;
CREATE TRIGGER bot_invite_removed BEFORE DELETE ON invites BEGIN
 UPDATE bot_members SET blocked=1 WHERE invite_id=OLD.id AND account_id IS NULL;
END;
