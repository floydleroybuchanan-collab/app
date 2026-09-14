-- Durable cleanup covers private chats and recipient-only group responses.
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
CREATE INDEX bot_responses_due ON bot_responses(due_at,lease_until);
CREATE INDEX bot_responses_recipient ON bot_responses(recipient_id,generation);
