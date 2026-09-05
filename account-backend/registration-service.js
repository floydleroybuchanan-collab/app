import { DAY, policyError, referralAccess } from "./admin-policy.js";
import { syncReferralSlots } from "./referral-service.js";

// Registration, the one-use claim, attribution and slot consumption commit
// together. Every permission/expiry predicate is checked inside the transaction.
export async function registerInvitedAccount(request, env, helpers) {
  const { safeJson, json, hashPassword, issueSession, publicUser, audit } = helpers;
  const body = await safeJson(request);
  const code = String(body.invite_code || "").trim().toUpperCase();
  const username = String(body.username || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!code) throw policyError("Invitation code is required.", 400);
  if (!/^[a-z0-9._-]{3,32}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw policyError("Enter a valid username and email.", 400);
  if (password.length < 8 || password.length > 256) throw policyError("Use a password of 8–256 characters.", 400);
  const adminInvite = await env.DB.prepare("SELECT * FROM invites WHERE invite_code=?1").bind(code).first();
  const referral = adminInvite ? null : await env.DB.prepare("SELECT * FROM referral_invites WHERE invite_code=?1").bind(code).first();
  const invitation = adminInvite || referral;
  if (!invitation) throw policyError("Invalid invitation code.", 404);
  let now = Math.floor(Date.now() / 1000);
  if (invitation.status !== "unused") throw policyError("This invitation is no longer available.", 409);
  if (invitation.expires_at !== null && invitation.expires_at <= now) throw policyError("This invitation has expired.", 410);
  if (referral) {
    const inviter = await env.DB.prepare("SELECT * FROM users WHERE id=?1").bind(referral.owner_user_id).first();
    referralAccess(referral, inviter, now);
    await syncReferralSlots(env, inviter, now);
  }
  const id = crypto.randomUUID(), hash = await hashPassword(password);
  now = Math.floor(Date.now() / 1000);
  const parameters = [id, username, email, hash, now, invitation.id];
  let statements;
  if (adminInvite) {
    // A suspended creator cannot redeem outstanding codes. Lowered owner limits
    // apply to outstanding codes too; a deleted history row never resets budgets.
    statements = [
      env.DB.prepare(`INSERT INTO users(id,username,email,password_hash,role,status,max_sessions,created_at,activated_at,expires_at)
        SELECT ?1,?2,?3,?4,'user','active',i.max_sessions,?5,?5,
          CASE WHEN i.account_duration_days IS NULL THEN NULL ELSE ?5+i.account_duration_days*${DAY} END
        FROM invites i JOIN users creator ON creator.id=i.created_by_user_id
        JOIN admin_profiles p ON p.user_id=creator.id JOIN admin_account_stats st ON st.admin_user_id=creator.id
        LEFT JOIN admin_owner o ON o.user_id=creator.id
        WHERE i.id=?6 AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?5)
          AND creator.role='admin' AND creator.status='active' AND p.enabled=1
          AND (o.user_id IS NOT NULL OR (p.can_create_invites=1
            AND i.account_duration_days IS NOT NULL AND i.account_duration_days BETWEEN 1 AND p.max_duration_days
            AND i.max_sessions BETWEEN 1 AND p.max_sessions
            AND i.expires_at IS NOT NULL AND i.expires_at-i.created_at<=p.max_invite_valid_days*${DAY}
            AND st.accounts_created<p.max_accounts_total
            AND (SELECT COUNT(*) FROM admin_user_attribution a JOIN users u ON u.id=a.user_id
              WHERE a.admin_user_id=p.user_id AND a.origin='admin_invite' AND (u.expires_at IS NULL OR u.expires_at>?5))<p.max_open_accounts))`).bind(...parameters),
      env.DB.prepare("UPDATE invites SET status='used',redeemed_by_user_id=?1,redeemed_at=?2 WHERE id=?3 AND status='unused' AND EXISTS(SELECT 1 FROM users WHERE id=?1)").bind(id, now, invitation.id),
      env.DB.prepare(`INSERT INTO admin_user_attribution(user_id,admin_user_id,origin,created_at)
        SELECT ?1,created_by_user_id,'admin_invite',?2 FROM invites WHERE id=?3 AND redeemed_by_user_id=?1`).bind(id, now, invitation.id),
    ];
  } else {
    statements = [
      env.DB.prepare(`INSERT INTO users(id,username,email,password_hash,role,status,max_sessions,created_at,activated_at,expires_at)
        SELECT ?1,?2,?3,?4,'user','active',MIN(i.max_sessions,u.max_sessions),?5,?5,MIN(i.grant_expires_at,u.expires_at)
        FROM referral_invites i JOIN users u ON u.id=i.owner_user_id
        WHERE i.id=?6 AND i.status='unused' AND i.expires_at>?5
          AND u.role='user' AND u.status='active' AND u.expires_at IS NOT NULL AND u.expires_at>?5
          AND i.grant_expires_at IS NOT NULL AND i.grant_expires_at>?5
          AND EXISTS(SELECT 1 FROM referral_slots s WHERE s.owner_user_id=u.id AND s.invite_id=i.id AND s.consumed_at IS NULL)
          AND EXISTS(SELECT 1 FROM referral_network_slots n WHERE n.owner_user_id=u.id AND n.invite_id=i.id)`).bind(...parameters),
      env.DB.prepare("UPDATE referral_invites SET status='active',redeemed_by_user_id=?1,redeemed_at=?2 WHERE id=?3 AND status='unused' AND EXISTS(SELECT 1 FROM users WHERE id=?1)").bind(id, now, invitation.id),
      env.DB.prepare(`UPDATE referral_slots SET invite_id=NULL,consumed_at=?2 WHERE invite_id=?3
        AND EXISTS(SELECT 1 FROM referral_invites WHERE id=?3 AND redeemed_by_user_id=?1)`).bind(id, now, invitation.id),
      env.DB.prepare(`INSERT INTO admin_user_attribution(user_id,admin_user_id,origin,created_at)
        SELECT ?1,a.admin_user_id,'referral',?2 FROM referral_invites i JOIN admin_user_attribution a ON a.user_id=i.owner_user_id
        WHERE i.id=?3 AND i.redeemed_by_user_id=?1`).bind(id, now, invitation.id),
    ];
  }
  let results;
  try { results = await env.DB.batch(statements); }
  catch (error) {
    if (/UNIQUE constraint failed: users\.(username|email)/i.test(String(error.message)))
      throw policyError("That username or email is already registered.", 409);
    throw error;
  }
  if (Number(results[0]?.meta?.changes || 0) !== 1)
    throw policyError("This code is no longer available, or its issuer's access or limits changed. Request another invitation.", 409);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id=?1").bind(id).first();
  const issued = await issueSession(env, user, now);
  await audit(env, id, null, "account_registered", null);
  return json({ success: true, token: issued.token, session_expires_at: issued.expiresAt, user: publicUser(user) }, 201);
}
