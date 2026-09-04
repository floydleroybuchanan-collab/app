-- User referral invitations are intentionally separate from administrator
-- invitations so existing admin durations and controls keep their behavior.
CREATE TABLE IF NOT EXISTS referral_invites (
    id TEXT PRIMARY KEY,
    invite_code TEXT NOT NULL UNIQUE,
    owner_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unused'
        CHECK (status IN ('unused', 'active', 'disabled', 'code_expired', 'account_expired', 'canceled')),
    network_slot_number INTEGER CHECK (network_slot_number BETWEEN 1 AND 6),
    max_sessions INTEGER NOT NULL,
    grant_expires_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,
    redeemed_by_user_id TEXT,
    redeemed_at INTEGER,
    ended_at INTEGER,
    end_reason TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id)
);

-- Two fixed slots make the allowance concurrency-safe. An unused invitation
-- reserves a slot; redemption consumes it; expiry releases it. At a six-month
-- boundary consumed slots reset, while a still-active code continues to occupy
-- one of the two non-stacking slots until it is used or expires.
CREATE TABLE IF NOT EXISTS referral_slots (
    owner_user_id TEXT NOT NULL,
    slot_number INTEGER NOT NULL CHECK (slot_number IN (1, 2)),
    invite_id TEXT,
    consumed_at INTEGER,
    cycle_started_at INTEGER NOT NULL,
    cycle_ends_at INTEGER NOT NULL,
    PRIMARY KEY (owner_user_id, slot_number),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Six fixed network positions enforce the lifetime active-referral cap without
-- exposing an invited person's identity to the inviter. A pending code reserves
-- its position, redemption keeps it occupied, and cancellation/expiry releases it.
CREATE TABLE IF NOT EXISTS referral_network_slots (
    owner_user_id TEXT NOT NULL,
    slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 6),
    invite_id TEXT,
    PRIMARY KEY (owner_user_id, slot_number),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_referral_invites_owner
ON referral_invites(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_invites_code
ON referral_invites(invite_code);

CREATE INDEX IF NOT EXISTS idx_referral_invites_expiry
ON referral_invites(status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_slots_invite
ON referral_slots(invite_id)
WHERE invite_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_network_slots_invite
ON referral_network_slots(invite_id)
WHERE invite_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_invites_redeemed_user
ON referral_invites(redeemed_by_user_id)
WHERE redeemed_by_user_id IS NOT NULL;
