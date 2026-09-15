CREATE TABLE IF NOT EXISTS website_announcements (
 id INTEGER PRIMARY KEY CHECK(id=1),
 json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 next_at INTEGER
);
INSERT OR IGNORE INTO website_announcements(id,json) VALUES(1,'{"url":"https://charming-medialab.wasmer.app/","message":"Visit the Charming MediaLab website for the app download, installation instructions and account help.","enabled":false,"timezone":"America/New_York","time":"18:00","repeat":"weekly","weekday":5}');
ALTER TABLE bot_jobs ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX bot_jobs_dedupe ON bot_jobs(dedupe_key) WHERE dedupe_key IS NOT NULL;
