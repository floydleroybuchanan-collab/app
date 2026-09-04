import {
  REFERRAL_LIMIT,
  referralAvailability,
  referralCycleFor,
  referralInviteExpiry,
} from "./referral-policy.js";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const characters = Array.from(bytes, (value) => INVITE_ALPHABET[value % INVITE_ALPHABET.length]);
  return `CHARM-${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

function changed(result) {
  return Number(result?.meta?.changes || 0);
}

async function expireUnusedInvites(env, ownerUserId, now) {
  await env.DB.prepare(`
    UPDATE referral_invites
    SET status = 'expired'
    WHERE owner_user_id = ?1
      AND status = 'unused'
      AND (
        expires_at <= ?2
        OR (grant_expires_at IS NOT NULL AND grant_expires_at <= ?2)
      )
  `).bind(ownerUserId, now).run();
}

async function readSlots(env, ownerUserId) {
  const result = await env.DB.prepare(`
    SELECT
      s.owner_user_id,
      s.slot_number,
      s.invite_id,
      s.consumed_at,
      s.cycle_started_at,
      s.cycle_ends_at,
      i.status AS invite_status,
      i.expires_at AS invite_expires_at,
      i.grant_expires_at AS invite_grant_expires_at
    FROM referral_slots s
    LEFT JOIN referral_invites i ON i.id = s.invite_id
    WHERE s.owner_user_id = ?1
    ORDER BY s.slot_number
  `).bind(ownerUserId).all();
  return result.results || [];
}

export async function syncReferralSlots(env, user, now) {
  const cycle = referralCycleFor(Number(user.created_at), now);
  await expireUnusedInvites(env, user.id, now);

  await env.DB.batch([1, 2].map((slotNumber) => env.DB.prepare(`
    INSERT OR IGNORE INTO referral_slots (
      owner_user_id,
      slot_number,
      invite_id,
      consumed_at,
      cycle_started_at,
      cycle_ends_at
    ) VALUES (?1, ?2, NULL, NULL, ?3, ?4)
  `).bind(user.id, slotNumber, cycle.startedAt, cycle.endsAt)));

  let slots = await readSlots(env, user.id);
  const repairs = [];
  for (const slot of slots) {
    const cycleChanged = Number(slot.cycle_started_at) !== cycle.startedAt;
    const activeInvite =
      slot.invite_id != null
      && slot.invite_status === "unused"
      && Number(slot.invite_expires_at) > now
      && (slot.invite_grant_expires_at == null || Number(slot.invite_grant_expires_at) > now);
    if (cycleChanged) {
      // A non-stacking renewal clears consumed allowance. An unexpired code is
      // retained and still occupies one of the new period's two slots.
      repairs.push(env.DB.prepare(`
        UPDATE referral_slots
        SET invite_id = ?3,
            consumed_at = NULL,
            cycle_started_at = ?4,
            cycle_ends_at = ?5
        WHERE owner_user_id = ?1 AND slot_number = ?2
      `).bind(user.id, slot.slot_number, activeInvite ? slot.invite_id : null, cycle.startedAt, cycle.endsAt));
    } else if (slot.invite_id != null && !activeInvite) {
      repairs.push(env.DB.prepare(`
        UPDATE referral_slots
        SET invite_id = NULL
        WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id = ?3
      `).bind(user.id, slot.slot_number, slot.invite_id));
    }
  }
  if (repairs.length) {
    await env.DB.batch(repairs);
    slots = await readSlots(env, user.id);
  }
  return { cycle, slots };
}

export async function buildReferralSummary(env, user, now) {
  const { cycle, slots } = await syncReferralSlots(env, user, now);
  const availability = referralAvailability(slots);
  const inviteResult = await env.DB.prepare(`
    SELECT id, invite_code, status, created_at, expires_at, redeemed_at
    FROM referral_invites
    WHERE owner_user_id = ?1
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(user.id).all();
  return {
    ...availability,
    cycle_started_at: cycle.startedAt,
    renews_at: cycle.endsAt,
    invitations: inviteResult.results || [],
  };
}

async function reserveFreeSlot(env, userId, inviteId, slots) {
  for (const slot of slots) {
    if (slot.invite_id != null || slot.consumed_at != null) continue;
    const result = await env.DB.prepare(`
      UPDATE referral_slots
      SET invite_id = ?3
      WHERE owner_user_id = ?1
        AND slot_number = ?2
        AND invite_id IS NULL
        AND consumed_at IS NULL
    `).bind(userId, slot.slot_number, inviteId).run();
    if (changed(result) === 1) return Number(slot.slot_number);
  }
  return null;
}

export async function createReferralInvitation(env, user, now) {
  const state = await syncReferralSlots(env, user, now);
  const availability = referralAvailability(state.slots);
  if (availability.available < 1) {
    const error = new Error("You have no invitations available right now.");
    error.status = 409;
    throw error;
  }

  const invitationId = crypto.randomUUID();
  const slotNumber = await reserveFreeSlot(env, user.id, invitationId, state.slots);
  if (slotNumber == null) {
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
            id,
            invite_code,
            owner_user_id,
            status,
            max_sessions,
            grant_expires_at,
            created_at,
            expires_at
          ) VALUES (?1, ?2, ?3, 'unused', ?4, ?5, ?6, ?7)
        `).bind(
          invitationId,
          inviteCode,
          user.id,
          Math.max(1, Number(user.max_sessions || 1)),
          user.expires_at == null ? null : Number(user.expires_at),
          now,
          expiresAt,
        ).run();
        invitation = {
          id: invitationId,
          invite_code: inviteCode,
          status: "unused",
          created_at: now,
          expires_at: expiresAt,
          redeemed_at: null,
        };
        break;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
  } finally {
    if (!invitation) {
      await env.DB.prepare(`
        UPDATE referral_slots
        SET invite_id = NULL
        WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id = ?3
      `).bind(user.id, slotNumber, invitationId).run();
    }
  }
  return invitation;
}

export async function findReferralInvitation(env, inviteCode) {
  return env.DB.prepare(`
    SELECT *
    FROM referral_invites
    WHERE invite_code = ?1
    LIMIT 1
  `).bind(String(inviteCode || "").trim().toUpperCase()).first();
}

export async function consumeReferralInvitation(env, invitation, newUserId, now) {
  const owner = await env.DB.prepare(`
    SELECT id, created_at, expires_at, max_sessions
    FROM users
    WHERE id = ?1 AND status = 'active'
    LIMIT 1
  `).bind(invitation.owner_user_id).first();
  if (!owner || (owner.expires_at != null && Number(owner.expires_at) <= now)) return false;

  // If redemption happens across the six-month boundary, advance the owner's
  // slots first so this use is consumed from the new period rather than being
  // immediately refunded by the next summary request.
  await syncReferralSlots(env, owner, now);
  const claimed = await env.DB.prepare(`
    UPDATE referral_invites
    SET status = 'used', redeemed_by_user_id = ?2, redeemed_at = ?3
    WHERE id = ?1 AND status = 'unused' AND expires_at > ?3
  `).bind(invitation.id, newUserId, now).run();
  if (changed(claimed) !== 1) return false;

  await env.DB.prepare(`
    UPDATE referral_slots
    SET invite_id = NULL, consumed_at = ?3
    WHERE owner_user_id = ?1 AND invite_id = ?2
  `).bind(invitation.owner_user_id, invitation.id, now).run();
  return true;
}

export async function handleReferralRoutes({ request, env, path, requireUser, json, audit }) {
  if (path !== "/referrals" && path !== "/referrals/invites") return null;
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ success: false, error: "Method not allowed." }, 405);
  }

  const auth = await requireUser(request, env);
  if (!auth.ok) return auth.response;
  const now = Math.floor(Date.now() / 1000);

  if (path === "/referrals" && request.method === "GET") {
    return json({ success: true, referral: await buildReferralSummary(env, auth.user, now) });
  }
  if (path === "/referrals/invites" && request.method === "POST") {
    const invitation = await createReferralInvitation(env, auth.user, now);
    if (audit) {
      await audit(env, auth.user.id, auth.user.id, "referral_invite_created", JSON.stringify({
        invitation_id: invitation.id,
        expires_at: invitation.expires_at,
      }));
    }
    return json({
      success: true,
      invitation,
      referral: await buildReferralSummary(env, auth.user, now),
    }, 201);
  }
  return json({ success: false, error: "Method not allowed." }, 405);
}

export function referralGrant(invitation) {
  return {
    maxSessions: Math.max(1, Number(invitation.max_sessions || 1)),
    expiresAt: invitation.grant_expires_at == null ? null : Number(invitation.grant_expires_at),
  };
}

export { REFERRAL_LIMIT };
