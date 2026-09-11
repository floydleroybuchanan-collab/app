CREATE TABLE IF NOT EXISTS app_controls (
 id INTEGER PRIMARY KEY CHECK(id=1),
 json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO app_controls(id,json) VALUES(1,'{"multiview_max":4,"provider_limits":{"primary":0,"secondary":0,"tertiary":0,"quaternary":0},"update":{"version_code":0,"message":"","url":""}}');
CREATE TABLE IF NOT EXISTS app_service_errors (
 day INTEGER PRIMARY KEY,
 count INTEGER NOT NULL DEFAULT 0,
 last_at INTEGER NOT NULL
);
