-- Explicit system provenance, separate from the existing administrator authorization relationship.
-- No fake login/admin identity is created; original invitations, permissions and audit actors remain intact.
CREATE TABLE IF NOT EXISTS bot_invitation_sources (
 invite_id TEXT PRIMARY KEY,
 account_id TEXT,
 authorizing_admin_id TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'bot_telegram' CHECK(source='bot_telegram'),
 creator_label TEXT NOT NULL DEFAULT 'Mr Charm' CHECK(creator_label='Mr Charm'),
 issued_at INTEGER NOT NULL,
 registered_at INTEGER,
 ended_at INTEGER,
 end_reason TEXT,
 evidence TEXT NOT NULL CHECK(evidence IN ('token_created_event','live_token_created'))
);
CREATE INDEX IF NOT EXISTS idx_bot_source_account ON bot_invitation_sources(account_id);
CREATE INDEX IF NOT EXISTS idx_bot_source_authorizer ON bot_invitation_sources(authorizing_admin_id);
CREATE TRIGGER IF NOT EXISTS bot_source_audit AFTER INSERT ON bot_invitation_sources BEGIN
 INSERT INTO audit_log(user_id,admin_user_id,action,details,created_at)
 VALUES(NEW.account_id,NULL,'bot_invitation_source_recorded',json_object('source',NEW.source,'creator_label',NEW.creator_label,'invite_id',NEW.invite_id,'authorizing_admin_id',NEW.authorizing_admin_id,'evidence',NEW.evidence,'issued_at',NEW.issued_at),unixepoch());
END;
CREATE TRIGGER IF NOT EXISTS bot_source_created AFTER INSERT ON bot_events WHEN NEW.action='token_created' BEGIN
 INSERT OR IGNORE INTO bot_invitation_sources(invite_id,account_id,authorizing_admin_id,issued_at,registered_at,evidence)
 SELECT i.id,i.redeemed_by_user_id,i.created_by_user_id,i.created_at,i.redeemed_at,'live_token_created'
 FROM invites i JOIN bot_members m ON m.invite_id=i.id
 WHERE m.telegram_id=NEW.telegram_id AND i.created_at=NEW.created_at AND i.created_by_user_id IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS bot_source_registered AFTER UPDATE OF redeemed_by_user_id ON invites
 WHEN NEW.redeemed_by_user_id IS NOT NULL AND EXISTS(SELECT 1 FROM bot_invitation_sources WHERE invite_id=NEW.id AND account_id IS NULL) BEGIN
 UPDATE bot_invitation_sources SET account_id=NEW.redeemed_by_user_id,registered_at=NEW.redeemed_at WHERE invite_id=NEW.id;
 INSERT INTO audit_log(user_id,admin_user_id,action,details,created_at)
 VALUES(NEW.redeemed_by_user_id,NULL,'bot_account_registered',json_object('source','bot_telegram','creator_label','Mr Charm','invite_id',NEW.id),unixepoch());
END;
CREATE TRIGGER IF NOT EXISTS bot_source_ended BEFORE DELETE ON users WHEN OLD.role='user' BEGIN
 UPDATE bot_invitation_sources SET ended_at=unixepoch(),end_reason=(SELECT end_reason FROM admin_user_attribution WHERE user_id=OLD.id)
 WHERE account_id=OLD.id AND ended_at IS NULL;
END;
-- A Telegram link alone is NOT proof of bot issuance. Match the actual creation event and timestamp.
INSERT OR IGNORE INTO bot_invitation_sources(invite_id,account_id,authorizing_admin_id,issued_at,registered_at,evidence)
SELECT i.id,i.redeemed_by_user_id,i.created_by_user_id,i.created_at,i.redeemed_at,'token_created_event'
FROM invites i WHERE i.created_by_user_id IS NOT NULL AND EXISTS (
 SELECT 1 FROM bot_members m JOIN bot_events e ON e.telegram_id=m.telegram_id
 WHERE m.invite_id=i.id AND e.action='token_created' AND e.created_at=i.created_at
);
