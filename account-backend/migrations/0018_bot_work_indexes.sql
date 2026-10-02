-- Keep minute maintenance from scanning retained private replies and completed jobs.
-- Index maintenance adds writes when indexed records change; these indexes target
-- the repeated reads of growing tables rather than changing retention behavior.
CREATE INDEX IF NOT EXISTS bot_responses_group_due ON bot_responses(due_at,lease_until) WHERE chat_id GLOB '-*';
CREATE INDEX IF NOT EXISTS bot_responses_group_created ON bot_responses(created_at) WHERE chat_id GLOB '-*';
CREATE INDEX IF NOT EXISTS bot_jobs_status_due ON bot_jobs(status,due_at,id);
CREATE INDEX IF NOT EXISTS bot_jobs_kind_chat ON bot_jobs(kind,chat_id);
