ALTER TABLE admin_profiles ADD COLUMN can_manage_bot INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_bot IN(0,1));
CREATE TABLE bot_content(key TEXT PRIMARY KEY, body TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, updated_by TEXT);
CREATE TABLE bot_content_history(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT NOT NULL,body TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT);
CREATE TABLE bot_settings(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
INSERT INTO bot_settings VALUES(1,'{"enabled":false,"group_id":"","bot_username":"CharmIPTVAssistantBot","auto_tokens":true,"token_days":90,"connections":2,"invite_days":7,"downloads_enabled":true,"accounts_enabled":true,"reminder_enabled":false,"reminder_hours":6}',1);
CREATE TABLE bot_members(telegram_id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'unknown',requested_at INTEGER,joined_at INTEGER,updated_at INTEGER NOT NULL,invite_id TEXT UNIQUE REFERENCES invites(id) ON DELETE SET NULL,account_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,ever_assigned INTEGER NOT NULL DEFAULT 0,blocked INTEGER NOT NULL DEFAULT 0,dm_started INTEGER NOT NULL DEFAULT 0);
CREATE INDEX bot_member_username ON bot_members(username);
CREATE TABLE bot_events(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',admin_id TEXT,created_at INTEGER NOT NULL);
CREATE INDEX bot_events_member ON bot_events(telegram_id,created_at);
CREATE TABLE bot_updates(id INTEGER PRIMARY KEY,status TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE bot_rate(telegram_id TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE TABLE bot_support_admins(telegram_id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE bot_support(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE bot_conversations(telegram_id TEXT PRIMARY KEY,state TEXT NOT NULL,json TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE bot_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,chat_id TEXT NOT NULL,message_id INTEGER,body TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',due_at INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '');
CREATE TABLE bot_runtime(key TEXT PRIMARY KEY,value TEXT NOT NULL);
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
