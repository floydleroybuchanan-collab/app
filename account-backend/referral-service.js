import {
  REFERRAL_ACTIVE_LIMIT,
  REFERRAL_LIMIT,
  referralAvailability,
  referralCycleFor,
  referralInviteExpiry,
} from "./referral-policy.js";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const END_STATUSES = new Set(["disabled", "code_expired", "account_expired", "canceled"]);

function makeInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const characters = Array.from(bytes, (value) => INVITE_ALPHABET[value % INVITE_ALPHABET.length]);
  return `CHARM-${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

function changed(result) {
  return Number(result?.meta?.changes || 0);
}

async function readAllowanceSlots(env, ownerUserId) {
  const result = await env.DB.prepare(`
    SELECT s.*, i.status AS invite_status, i.expires_at AS invite_expires_at,
      i.grant_expires_at AS invite_grant_expires_at
    FROM referral_slots s
    LEFT JOIN referral_invites i ON i.id = s.invite_id
    WHERE s.owner_user_id = ?1
    ORDER BY s.slot_number
  `).bind(ownerUserId).all();
  return result.results || [];
}

async function readNetworkSlots(env, ownerUserId) {
  const result = await env.DB.prepare(`
    SELECT n.*, i.status AS invite_status
    FROM referral_network_slots n
    LEFT JOIN referral_invites i ON i.id = n.invite_id
    WHERE n.owner_user_id = ?1
    ORDER BY n.slot_number
  `).bind(ownerUserId).all();
  return result.results || [];
}

async function expireUnusedInvites(env, ownerUserId, now) {
  const expired = await env.DB.prepare(`
    SELECT id FROM referral_invites
    WHERE owner_user_id = ?1 AND status = 'unused'
      AND (expires_at <= ?2 OR (grant_expires_at IS NOT NULL AND grant_expires_at <= ?2))
  `).bind(ownerUserId, now).all();
  for (const invitation of expired.results || []) {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE referral_invites SET status = 'code_expired', ended_at = ?2,
          end_reason = 'unused_code_expired'
        WHERE id = ?1 AND status = 'unused'
      `).bind(invitation.id, now),
      env.DB.prepare(`UPDATE referral_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`)
        .bind(ownerUserId, invitation.id),
      env.DB.prepare(`UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`)
        .bind(ownerUserId, invitation.id),
    ]);
  }
}

async function ensureFixedSlots(env, user, cycle) {
  await env.DB.batch(Array.from({ length: REFERRAL_LIMIT }, (_, index) => env.DB.prepare(`
    INSERT OR IGNORE INTO referral_slots (
      owner_user_id, slot_number, invite_id, consumed_at, cycle_started_at, cycle_ends_at
    ) VALUES (?1, ?2, NULL, NULL, ?3, ?4)
  `).bind(user.id, index + 1, cycle.startedAt, cycle.endsAt)));
  await env.DB.batch(Array.from({ length: REFERRAL_ACTIVE_LIMIT }, (_, index) => env.DB.prepare(`
    INSERT OR IGNORE INTO referral_network_slots (owner_user_id, slot_number, invite_id)
    VALUES (?1, ?2, NULL)
  `).bind(user.id, index + 1)));
}

export async function syncReferralSlots(env, user, now) {
  const cycle = referralCycleFor(Number(user.created_at), now);
  await ensureFixedSlots(env, user, cycle);
  await expireUnusedInvites(env, user.id, now);

  let allowanceSlots = await readAllowanceSlots(env, user.id);
  const allowanceRepairs = [];
  for (const slot of allowanceSlots) {
    const cycleChanged = Number(slot.cycle_started_at) !== cycle.startedAt;
    const liveUnusedCode = slot.invite_id != null
      && slot.invite_status === "unused"
      && Number(slot.invite_expires_at) > now
      && (slot.invite_grant_expires_at == null || Number(slot.invite_grant_expires_at) > now);
    if (cycleChanged) {
      allowanceRepairs.push(env.DB.prepare(`
        UPDATE referral_slots SET invite_id = ?3, consumed_at = NULL,
          cycle_started_at = ?4, cycle_ends_at = ?5
        WHERE owner_user_id = ?1 AND slot_number = ?2
      `).bind(user.id, slot.slot_number, liveUnusedCode ? slot.invite_id : null, cycle.startedAt, cycle.endsAt));
    } else if (slot.invite_id != null && !liveUnusedCode) {
      allowanceRepairs.push(env.DB.prepare(`
        UPDATE referral_slots SET invite_id = NULL
        WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id = ?3
      `).bind(user.id, slot.slot_number, slot.invite_id));
    }
  }
  if (allowanceRepairs.length) await env.DB.batch(allowanceRepairs);

  const networkSlots = await readNetworkSlots(env, user.id);
  const networkRepairs = networkSlots
    .filter((slot) => slot.invite_id != null && !["unused", "active"].includes(slot.invite_status))
    .map((slot) => env.DB.prepare(`
      UPDATE referral_network_slots SET invite_id = NULL
      WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id = ?3
    `).bind(user.id, slot.slot_number, slot.invite_id));
  if (networkRepairs.length) await env.DB.batch(networkRepairs);

  allowanceSlots = await readAllowanceSlots(env, user.id);
  return { cycle, allowanceSlots, networkSlots: await readNetworkSlots(env, user.id) };
}

export async function releaseReferralForAccount(env, redeemedUserId, reason, now) {
  const invitation = await env.DB.prepare(`
    SELECT id, owner_user_id FROM referral_invites
    WHERE redeemed_by_user_id = ?1 AND status = 'active'
    ORDER BY redeemed_at DESC LIMIT 1
  `).bind(redeemedUserId).first();
  if (!invitation) return false;
  const status = reason === "account_expired" ? "account_expired" : "canceled";
  const ended = await env.DB.prepare(`
    UPDATE referral_invites SET status = ?2, redeemed_by_user_id = NULL,
      ended_at = ?3, end_reason = ?4
    WHERE id = ?1 AND status = 'active'
  `).bind(invitation.id, status, now, reason).run();
  if (changed(ended) !== 1) return false;
  await env.DB.batch([
    env.DB.prepare(`UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`)
      .bind(invitation.owner_user_id, invitation.id),
    env.DB.prepare(`
      UPDATE referral_slots SET consumed_at = NULL
      WHERE owner_user_id = ?1 AND slot_number = (
        SELECT slot_number FROM referral_slots
        WHERE owner_user_id = ?1 AND consumed_at IS NOT NULL AND invite_id IS NULL
        ORDER BY consumed_at DESC LIMIT 1
      )
    `).bind(invitation.owner_user_id),
  ]);
  return true;
}

async function releaseEndedAccountsForOwner(env, ownerUserId, now) {
  const result = await env.DB.prepare(`
    SELECT i.redeemed_by_user_id
    FROM referral_invites i
    LEFT JOIN users u ON u.id = i.redeemed_by_user_id
    WHERE i.owner_user_id = ?1 AND i.status = 'active'
      AND (u.id IS NULL OR u.status != 'active' OR (u.expires_at IS NOT NULL AND u.expires_at <= ?2))
  `).bind(ownerUserId, now).all();
  for (const row of result.results || []) {
    if (row.redeemed_by_user_id) {
      await releaseReferralForAccount(env, row.redeemed_by_user_id, "account_expired", now);
    }
  }
}

export async function buildReferralSummary(env, user, now) {
  await syncReferralSlots(env, user, now);
  await releaseEndedAccountsForOwner(env, user.id, now);
  const { cycle, allowanceSlots, networkSlots } = await syncReferralSlots(env, user, now);
  const availability = referralAvailability(allowanceSlots, networkSlots);
  const inviteResult = await env.DB.prepare(`
    SELECT i.id, i.invite_code, i.status, i.network_slot_number, i.created_at,
      i.expires_at, i.redeemed_at, i.ended_at, i.end_reason,
      CASE WHEN i.status = 'active' THEN u.expires_at ELSE NULL END AS account_expires_at
    FROM referral_invites i
    LEFT JOIN users u ON u.id = i.redeemed_by_user_id
    WHERE i.owner_user_id = ?1
    ORDER BY COALESCE(i.network_slot_number, 99), i.created_at DESC
    LIMIT 50
  `).bind(user.id).all();
  const invitations = inviteResult.results || [];
  return {
    ...availability,
    active_accounts: invitations.filter((item) => item.status === "active").length,
    cycle_started_at: cycle.startedAt,
    renews_at: cycle.endsAt,
    invitations,
  };
}

async function reserveSlot(env, tableName, userId, inviteId, slots) {
  for (const slot of slots) {
    if (slot.invite_id != null || (tableName === "referral_slots" && slot.consumed_at != null)) continue;
    const allowanceClause = tableName === "referral_slots" ? "AND consumed_at IS NULL" : "";
    const result = await env.DB.prepare(`
      UPDATE ${tableName} SET invite_id = ?3
      WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id IS NULL ${allowanceClause}
    `).bind(userId, slot.slot_number, inviteId).run();
    if (changed(result) === 1) return Number(slot.slot_number);
  }
  return null;
}

export async function createReferralInvitation(env, user, now) {
  const state = await syncReferralSlots(env, user, now);
  if (referralAvailability(state.allowanceSlots, state.networkSlots).available < 1) {
    const error = new Error("You have no invitations available right now.");
    error.status = 409;
    throw error;
  }
  const invitationId = crypto.randomUUID();
  const networkSlotNumber = await reserveSlot(env, "referral_network_slots", user.id, invitationId, state.networkSlots);
  if (networkSlotNumber == null) {
    const error = new Error("All six invited-account positions are currently in use.");
    error.status = 409;
    throw error;
  }
  const allowanceSlotNumber = await reserveSlot(env, "referral_slots", user.id, invitationId, state.allowanceSlots);
  if (allowanceSlotNumber == null) {
    await env.DB.prepare(`UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`)
      .bind(user.id, invitationId).run();
    const error = new Error("You have no invitations available right now.");
    error.status = 409;
    throw error;
  }

  const expiresAt = referralInviteExpiry(now);
  let invitation = null;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = makeInviteCode();
      try {
        await env.DB.prepare(`
          INSERT INTO referral_invites (
            id, invite_code, owner_user_id, status, network_slot_number,
            max_sessions, grant_expires_at, created_at, expires_at
          ) VALUES (?1, ?2, ?3, 'unused', ?4, ?5, ?6, ?7, ?8)
        `).bind(invitationId, inviteCode, user.id, networkSlotNumber,
          Math.max(1, Number(user.max_sessions || 1)),
          user.expires_at == null ? null : Number(user.expires_at), now, expiresAt).run();
        invitation = {
          id: invitationId, invite_code: inviteCode, status: "unused",
          network_slot_number: networkSlotNumber, created_at: now, expires_at: expiresAt,
          redeemed_at: null, ended_at: null, account_expires_at: null,
        };
        break;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
  } finally {
    if (!invitation) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE referral_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`).bind(user.id, invitationId),
        env.DB.prepare(`UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`).bind(user.id, invitationId),
      ]);
    }
  }
  return invitation;
}

export async function deleteReferralHistory(env, ownerUserId, invitationId) {
  const invitation = await env.DB.prepare(`
    SELECT id, status FROM referral_invites WHERE id = ?1 AND owner_user_id = ?2 LIMIT 1
  `).bind(invitationId, ownerUserId).first();
  if (!invitation) return { ok: false, status: 404, error: "Invitation not found." };
  if (!END_STATUSES.has(invitation.status)) {
    return { ok: false, status: 409, error: "Only expired, canceled, or disabled invitation history can be deleted." };
  }
  await env.DB.prepare(`DELETE FROM referral_invites WHERE id = ?1 AND owner_user_id = ?2`)
    .bind(invitationId, ownerUserId).run();
  return { ok: true };
}

export async function findReferralInvitation(env, inviteCode) {
  return env.DB.prepare(`SELECT * FROM referral_invites WHERE invite_code = ?1 LIMIT 1`)
    .bind(String(inviteCode || "").trim().toUpperCase()).first();
}

export async function consumeReferralInvitation(env, invitation, newUserId, now) {
  const owner = await env.DB.prepare(`
    SELECT id, created_at, expires_at, max_sessions FROM users
    WHERE id = ?1 AND status = 'active' LIMIT 1
  `).bind(invitation.owner_user_id).first();
  if (!owner || (owner.expires_at != null && Number(owner.expires_at) <= now)) return false;
  await syncReferralSlots(env, owner, now);
  const claimed = await env.DB.prepare(`
    UPDATE referral_invites SET status = 'active', redeemed_by_user_id = ?2, redeemed_at = ?3
    WHERE id = ?1 AND status = 'unused' AND expires_at > ?3
  `).bind(invitation.id, newUserId, now).run();
  if (changed(claimed) !== 1) return false;
  await env.DB.prepare(`
    UPDATE referral_slots SET invite_id = NULL, consumed_at = ?3
    WHERE owner_user_id = ?1 AND invite_id = ?2
  `).bind(invitation.owner_user_id, invitation.id, now).run();
  return true;
}

export async function handleReferralRoutes({ request, env, path, requireUser, json, audit }) {
  const historyMatch = path.match(/^\/referrals\/invites\/([^/]+)$/);
  if (path !== "/referrals" && path !== "/referrals/invites" && !historyMatch) return null;
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth.response;
  const now = Math.floor(Date.now() / 1000);
  if (path === "/referrals" && request.method === "GET") {
    return json({ success: true, referral: await buildReferralSummary(env, auth.user, now) });
  }
  if (path === "/referrals/invites" && request.method === "POST") {
    const invitation = await createReferralInvitation(env, auth.user, now);
    if (audit) await audit(env, auth.user.id, auth.user.id, "referral_invite_created", JSON.stringify({
      invitation_id: invitation.id, expires_at: invitation.expires_at,
    }));
    return json({ success: true, invitation, referral: await buildReferralSummary(env, auth.user, now) }, 201);
  }
  if (historyMatch && request.method === "DELETE") {
    const result = await deleteReferralHistory(env, auth.user.id, historyMatch[1]);
    if (!result.ok) return json({ success: false, error: result.error }, result.status);
    return json({ success: true, referral: await buildReferralSummary(env, auth.user, now) });
  }
  return json({ success: false, error: "Method not allowed." }, 405);
}

export function referralGrant(invitation) {
  return {
    maxSessions: Math.max(1, Number(invitation.max_sessions || 1)),
    expiresAt: invitation.grant_expires_at == null ? null : Number(invitation.grant_expires_at),
  };
}

export { REFERRAL_ACTIVE_LIMIT, REFERRAL_LIMIT };
