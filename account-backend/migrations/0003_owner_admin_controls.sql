-- Additive migration. Existing account timers, credentials and sessions are unchanged.
-- Pin the verified original administrator; do not infer ownership from a username
-- or automatically promote whichever administrator happens to log in first.
CREATE TABLE admin_owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT
);
INSERT INTO admin_owner(singleton, user_id)
SELECT 1, id FROM users WHERE id = '7e2775af-7a81-4669-a800-9a9c6b7ad2a1' AND role = 'admin';

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
);
INSERT INTO admin_profiles(user_id) SELECT user_id FROM admin_owner;

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
INSERT OR IGNORE INTO admin_user_attribution(user_id,admin_user_id,origin,created_at)
SELECT u.id,i.created_by_user_id,'admin_invite',u.created_at
FROM invites i JOIN users u ON u.id=i.redeemed_by_user_id JOIN admin_profiles p ON p.user_id=i.created_by_user_id
WHERE i.status='used' AND u.role='user';
INSERT INTO admin_account_stats(admin_user_id,accounts_created,invites_created)
SELECT p.user_id,
  (SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=p.user_id AND i.status='used'),
  (SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=p.user_id)
FROM admin_profiles p;

CREATE INDEX idx_admin_attribution_owner ON admin_user_attribution(admin_user_id,origin,user_id);
CREATE INDEX idx_invites_creator_status ON invites(created_by_user_id,status,expires_at);
CREATE INDEX idx_users_role_created ON users(role,created_at,id);
CREATE INDEX idx_users_role_expiry ON users(role,expires_at,id);
CREATE INDEX idx_users_role_username ON users(role,username,id);
CREATE INDEX idx_audit_actor_created ON audit_log(admin_user_id,created_at,id);

-- Counts survive deletion; the association to the deleted viewer does not.
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
