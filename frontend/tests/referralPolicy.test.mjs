import assert from "node:assert/strict";
import test from "node:test";

import {
  REFERRAL_INVITE_LIFETIME_SECONDS,
  referralAvailability,
  referralCycleFor,
  referralInviteExpiry,
} from "../../account-backend/referral-policy.js";
import { referralGrant } from "../../account-backend/referral-service.js";

const unix = (value) => Math.floor(Date.parse(value) / 1000);

test("referral cycles renew every six calendar months from account creation", () => {
  const created = unix("2026-01-31T12:30:00Z");
  assert.deepEqual(referralCycleFor(created, unix("2026-07-30T23:59:59Z")), {
    startedAt: created,
    endsAt: unix("2026-07-31T12:30:00Z"),
  });
  assert.deepEqual(referralCycleFor(created, unix("2026-08-01T00:00:00Z")), {
    startedAt: unix("2026-07-31T12:30:00Z"),
    endsAt: unix("2027-01-31T12:30:00Z"),
  });
});

test("unused active codes reserve slots, used codes consume slots, and quota never exceeds two", () => {
  assert.deepEqual(referralAvailability([
    { invite_id: null, consumed_at: null },
    { invite_id: null, consumed_at: null },
  ]), { limit: 2, used: 0, active: 0, available: 2 });
  assert.deepEqual(referralAvailability([
    { invite_id: "invite-1", consumed_at: null },
    { invite_id: null, consumed_at: 100 },
  ]), { limit: 2, used: 1, active: 1, available: 0 });
});

test("a generated referral invitation expires after exactly three days", () => {
  const now = unix("2026-09-04T18:00:00Z");
  assert.equal(referralInviteExpiry(now), now + REFERRAL_INVITE_LIFETIME_SECONDS);
  assert.equal(REFERRAL_INVITE_LIFETIME_SECONDS, 259_200);
});

test("a referred account cannot outlive or exceed its inviter's access grant", () => {
  assert.deepEqual(referralGrant({ max_sessions: 2, grant_expires_at: 1_800_000_000 }), {
    maxSessions: 2,
    expiresAt: 1_800_000_000,
  });
  assert.deepEqual(referralGrant({ max_sessions: 0, grant_expires_at: null }), {
    maxSessions: 1,
    expiresAt: null,
  });
});

test("referral database migration keeps admin invitations isolated", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../../account-backend/migrations/0002_user_referrals.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS referral_invites/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS referral_slots/);
  assert.doesNotMatch(migration, /ALTER TABLE invites/);
});

test("redemption advances the inviter cycle before consuming a slot", async () => {
  const { readFile } = await import("node:fs/promises");
  const service = await readFile(new URL("../../account-backend/referral-service.js", import.meta.url), "utf8");
  const consume = service.match(/export async function consumeReferralInvitation[\s\S]*?\n}/)?.[0] || "";
  assert.match(consume, /await syncReferralSlots\(env, owner, now\)/);
  assert.ok(consume.indexOf("await syncReferralSlots") < consume.indexOf("SET status = 'used'"));
  assert.match(service, /grant_expires_at IS NOT NULL AND grant_expires_at <= \?2/);
});
