-- Contact-directory labels are separate from verified bot account/token links.
CREATE TABLE account_telegram_contacts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL DEFAULT '',
  telegram_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX account_telegram_contact_username ON account_telegram_contacts(lower(username)) WHERE username<>'';
CREATE UNIQUE INDEX account_telegram_contact_id ON account_telegram_contacts(telegram_id) WHERE telegram_id IS NOT NULL;
ALTER TABLE bot_support_admins ADD COLUMN contact_username TEXT NOT NULL DEFAULT '';
