CREATE TABLE IF NOT EXISTS website_release (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 1,
 json TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT
);
INSERT OR IGNORE INTO website_release(id,json,updated_at) VALUES(1,'{"download_url":"https://drive.proton.me/urls/V59W1MJQER#FSTBtDsOnl9q","version":"2.2.0-RC6","build":190,"release_date":"2026-09-15","size_bytes":155228772,"title":"Charming MediaLab update","notes":"Persistent Real-Debrid connection, easier navigation and release protection."}',unixepoch());
CREATE TABLE IF NOT EXISTS website_release_history(id INTEGER PRIMARY KEY AUTOINCREMENT,revision INTEGER NOT NULL,json TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT);
CREATE TABLE IF NOT EXISTS app_presence (
 session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL, mode TEXT NOT NULL, playing INTEGER NOT NULL,
 last_seen INTEGER NOT NULL, started_at INTEGER NOT NULL, build INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS app_presence_seen ON app_presence(last_seen,user_id);
CREATE TABLE IF NOT EXISTS app_usage_daily (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day INTEGER NOT NULL,
 iptv_seconds INTEGER NOT NULL DEFAULT 0, vod_seconds INTEGER NOT NULL DEFAULT 0,
 foreground_seconds INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0, signins INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,day)
);
CREATE INDEX IF NOT EXISTS app_usage_day ON app_usage_daily(day,user_id);
CREATE TABLE IF NOT EXISTS app_usage_metadata(id INTEGER PRIMARY KEY CHECK(id=1),started_at INTEGER NOT NULL);
INSERT OR IGNORE INTO app_usage_metadata VALUES(1,unixepoch());
