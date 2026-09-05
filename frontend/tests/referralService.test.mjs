import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildReferralSummary,
  consumeReferralInvitation,
  createReferralInvitation,
  deleteReferralHistory,
  releaseReferralForAccount,
} from "../../account-backend/referral-service.js";
import { REFERRAL_INVITE_LIFETIME_SECONDS } from "../../account-backend/referral-policy.js";

function d1Environment(database) {
  const boundStatement = (sql, values) => ({
    _runSync() {
      const result = database.prepare(sql).run(...values);
      return { meta: { changes: Number(result.changes) } };
    },
    async run() {
      return this._runSync();
    },
    async all() {
      return { results: database.prepare(sql).all(...values) };
    },
    async first() {
      return database.prepare(sql).get(...values) || null;
    },
  });

  return {
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return boundStatement(sql, values);
          },
        };
      },
      async batch(statements) {
        database.exec("BEGIN IMMEDIATE");
        try {
          const results = statements.map((statement) => statement._runSync());
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}

async function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      max_sessions INTEGER NOT NULL
    );
  `);
  const migration = await readFile(new URL("../../account-backend/migrations/0002_user_referrals.sql", import.meta.url), "utf8");
  database.exec(migration);
  return { database, env: d1Environment(database) };
}

function addUser(database, user) {
  database.prepare(`
    INSERT INTO users (id, status, created_at, expires_at, max_sessions)
    VALUES (?1, ?2, ?3, ?4, ?5)
  `).run(user.id, user.status, user.created_at, user.expires_at, user.max_sessions);
}

test("referral service atomically caps rapid generation and refunds expired codes", async () => {
  const { database, env } = await fixture();
  const now = Math.floor(Date.UTC(2026, 0, 15, 12) / 1000);
  const owner = {
    id: "owner",
    status: "active",
    created_at: now,
    expires_at: now + 365 * 24 * 60 * 60,
    max_sessions: 2,
  };
  addUser(database, owner);

  const attempts = await Promise.allSettled([
    createReferralInvitation(env, owner, now),
    createReferralInvitation(env, owner, now),
    createReferralInvitation(env, owner, now),
  ]);
  const created = attempts.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const rejected = attempts.filter((result) => result.status === "rejected");
  assert.equal(created.length, 2);
  assert.equal(new Set(created.map((invite) => invite.invite_code)).size, 2);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);

  const reserved = await buildReferralSummary(env, owner, now);
  assert.deepEqual(
    { available: reserved.available, active: reserved.active, used: reserved.used },
    { available: 0, active: 2, used: 0 },
  );

  const afterExpiry = await buildReferralSummary(env, owner, now + REFERRAL_INVITE_LIFETIME_SECONDS);
  assert.deepEqual(
    { available: afterExpiry.available, active: afterExpiry.active, used: afterExpiry.used },
    { available: 2, active: 0, used: 0 },
  );
  assert.ok(afterExpiry.invitations.every((invite) => invite.status === "code_expired"));
});

test("redeeming a referral consumes one slot exactly once", async () => {
  const { database, env } = await fixture();
  const now = Math.floor(Date.UTC(2026, 2, 1, 9) / 1000);
  const owner = {
    id: "owner",
    status: "active",
    created_at: now - 30 * 24 * 60 * 60,
    expires_at: now + 90 * 24 * 60 * 60,
    max_sessions: 2,
  };
  addUser(database, owner);
  addUser(database, { ...owner, id: "friend" });

  const invitation = await createReferralInvitation(env, owner, now);
  const stored = database.prepare("SELECT * FROM referral_invites WHERE id = ?1").get(invitation.id);
  assert.equal(await consumeReferralInvitation(env, stored, "friend", now + 10), true);
  assert.equal(await consumeReferralInvitation(env, stored, "friend", now + 11), false);

  const summary = await buildReferralSummary(env, owner, now + 11);
  assert.deepEqual(
    { available: summary.available, active: summary.active, used: summary.used },
    { available: 1, active: 0, used: 1 },
  );
  assert.equal(summary.invitations[0].status, "active");
  assert.equal(summary.invitations[0].redeemed_at, now + 10);
});

test("six active invited accounts cap the network and cancellation returns one allowance", async () => {
  const { database, env } = await fixture();
  const now = Math.floor(Date.UTC(2026, 3, 1, 9) / 1000);
  const owner = { id: "owner", status: "active", created_at: now, expires_at: now + 40000000, max_sessions: 2 };
  addUser(database, owner);

  for (let index = 1; index <= 6; index += 1) {
    const friend = { ...owner, id: `friend-${index}` };
    addUser(database, friend);
    const invitation = await createReferralInvitation(env, owner, now + index * 10);
    const stored = database.prepare("SELECT * FROM referral_invites WHERE id = ?1").get(invitation.id);
    assert.equal(await consumeReferralInvitation(env, stored, friend.id, now + index * 10 + 1), true);
    if (index % 2 === 0 && index < 6) {
      database.prepare("UPDATE referral_slots SET consumed_at = NULL WHERE owner_user_id = ?1").run(owner.id);
    }
  }

  const full = await buildReferralSummary(env, owner, now + 100);
  assert.equal(full.active_accounts, 6);
  assert.equal(full.network_available, 0);
  assert.equal(full.available, 0);

  assert.equal(await releaseReferralForAccount(env, "friend-3", "user_canceled", now + 101), true);
  database.prepare("DELETE FROM users WHERE id = ?1").run("friend-3");
  const released = await buildReferralSummary(env, owner, now + 102);
  assert.equal(released.active_accounts, 5);
  assert.equal(released.available, 1);
  assert.equal(released.invitations.find((item) => item.network_slot_number === 3)?.status, "canceled");
  const ended = released.invitations.find((item) => item.status === "canceled");
  assert.deepEqual(await deleteReferralHistory(env, owner.id, ended.id), { ok: true });
});
