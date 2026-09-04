const DAY = 86400;
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 60000;
const REFERRAL_LIMIT = 2;
const REFERRAL_ACTIVE_LIMIT = 6;
const REFERRAL_INVITE_SECONDS = 3 * DAY;
const MANAGED_SOURCE_SLOTS = [
  { id: "primary", playlist: "M3U_URL", epg: "EPG_URL", required: true },
  { id: "secondary", playlist: "M3U_URL_2", epg: "EPG_URL_2", required: true },
  { id: "tertiary", playlist: "M3U_URL_3", epg: "EPG_URL_3", required: false },
  { id: "quaternary", playlist: "M3U_URL_4", epg: "EPG_URL_4", required: false },
];

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return corsResponse(null, 204);
      const url = new URL(request.url);
      const path = url.pathname;
      await purgeExpiredAccounts(env, 50);

      if (path === "/" && request.method === "GET") {
        return json({ success: true, service: "CharmIPTV Account API", status: "online", referral_active_limit: 6 });
      }
      if (path === "/health" && request.method === "GET") {
        const sources = managedSourceConfiguration(env);
        // Report presence only. Provider addresses and credentials must never
        // appear in a public diagnostic response or deployment log.
        return json({
          success: true,
          database: !!env.DB,
          content_sources_ready: sources.ready,
          configured_source_count: sources.configured.length,
          content_sources: Object.fromEntries(sources.slots.map((source) => [source.id, source.state === "configured"])),
        });
      }
      if (path === "/setup-admin" && request.method === "POST") return setupAdmin(request, env);
      if (path === "/auth/register" && request.method === "POST") return registerWithInvite(request, env);
      if (path === "/auth/login" && request.method === "POST") return login(request, env);
      if (path === "/auth/logout" && request.method === "POST") {
        const auth = await requireUser(request, env);
        if (!auth.ok) return auth.response;
        await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?1").bind(auth.session.id).run();
        return json({ success: true, message: "Logged out." });
      }
      if (path === "/me" && request.method === "GET") {
        const auth = await requireUser(request, env);
        if (!auth.ok) return auth.response;
        return json({ success: true, user: publicUser(auth.user) });
      }
      if (path === "/content/access" && request.method === "GET") return createContentAccess(request, env);
      if (path === "/me" && request.method === "DELETE") {
        const auth = await requireUser(request, env);
        if (!auth.ok) return auth.response;
        if (auth.user.role === "admin") return json({ success: false, error: "Administrator accounts cannot be canceled in the app." }, 400);
        const body = await safeJson(request);
        if (String(body.confirmation || "").trim().toLowerCase() !== "please cancel me") {
          return json({ success: false, error: 'Type "please cancel me" to confirm permanent deletion.' }, 400);
        }
        if (!body.password || !(await verifyPassword(String(body.password), auth.user.password_hash))) {
          return json({ success: false, error: "Your current password is incorrect." }, 403);
        }
        await deleteAccountData(env, auth.user.id, "user_canceled");
        return json({ success: true, message: "Account and personal data permanently deleted." });
      }

      if (path === "/referrals" && request.method === "GET") {
        const auth = await requireUser(request, env);
        if (!auth.ok) return auth.response;
        return json({ success: true, referral: await buildReferralSummary(env, auth.user, unixNow()) });
      }
      if (path === "/referrals/invites" && request.method === "POST") {
        const auth = await requireUser(request, env);
        if (!auth.ok) return auth.response;
        const invitation = await createReferralInvitation(env, auth.user, unixNow());
        await audit(env, auth.user.id, auth.user.id, "referral_invite_created", null);
        return json({ success: true, invitation, referral: await buildReferralSummary(env, auth.user, unixNow()) }, 201);
      }
      const referralDeleteMatch = path.match(/^\/referrals\/invites\/([^/]+)$/);
      if (referralDeleteMatch && request.method === "DELETE") {
        const auth = await requireUser(request, env);
        if (!auth.ok) return auth.response;
        const deleted = await deleteReferralHistory(env, auth.user.id, referralDeleteMatch[1]);
        if (!deleted.ok) return json({ success: false, error: deleted.error }, deleted.status);
        return json({ success: true, referral: await buildReferralSummary(env, auth.user, unixNow()) });
      }

      if (path === "/admin/dashboard" && request.method === "GET") return adminDashboard(request, env);
      if (path === "/admin/invites" && request.method === "GET") return adminListInvites(request, env);
      if (path === "/admin/invites" && request.method === "POST") return adminCreateInvite(request, env);
      if (path === "/admin/users" && request.method === "GET") return adminListUsers(request, env);

      const userMatch = path.match(/^\/admin\/users\/([^/]+)$/);
      if (userMatch && request.method === "PATCH") return adminUpdateUser(request, env, userMatch[1]);
      if (userMatch && request.method === "DELETE") return adminDeleteUser(request, env, userMatch[1]);
      const logoutMatch = path.match(/^\/admin\/users\/([^/]+)\/logout$/);
      if (logoutMatch && request.method === "POST") return adminLogoutUser(request, env, logoutMatch[1]);
      const resetMatch = path.match(/^\/admin\/users\/([^/]+)\/reset-password$/);
      if (resetMatch && request.method === "POST") return adminResetPassword(request, env, resetMatch[1]);
      const revokeMatch = path.match(/^\/admin\/invites\/([^/]+)\/revoke$/);
      if (revokeMatch && request.method === "POST") return adminRevokeInvite(request, env, revokeMatch[1]);
      const deleteInviteMatch = path.match(/^\/admin\/invites\/([^/]+)$/);
      if (deleteInviteMatch && request.method === "DELETE") return adminDeleteInvite(request, env, deleteInviteMatch[1]);

      return json({ success: false, error: "Route not found." }, 404);
    } catch (error) {
      console.error(error);
      return json({ success: false, error: error?.message || "Internal server error." }, Number(error?.status || 500));
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(purgeExpiredAccounts(env, 1000));
  },
};

async function setupAdmin(request, env) {
  if (!env.ADMIN_SETUP_KEY) return json({ success: false, error: "ADMIN_SETUP_KEY has not been configured." }, 500);
  const supplied = request.headers.get("X-Setup-Key");
  if (!supplied || !constantTimeEqual(supplied, env.ADMIN_SETUP_KEY)) return json({ success: false, error: "Invalid setup key." }, 403);
  if (await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first()) {
    return json({ success: false, error: "An administrator already exists. Initial setup is disabled." }, 409);
  }
  const body = await safeJson(request);
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!validUsername(username) || !validEmail(email) || password.length < 8) {
    return json({ success: false, error: "Enter a valid username, email, and password of at least 8 characters." }, 400);
  }
  const id = crypto.randomUUID();
  const now = unixNow();
  await env.DB.prepare(`INSERT INTO users
    (id, username, email, password_hash, role, status, max_sessions, created_at, activated_at)
    VALUES (?1, ?2, ?3, ?4, 'admin', 'active', 5, ?5, ?5)`)
    .bind(id, username, email, await hashPassword(password), now).run();
  await audit(env, id, id, "initial_admin_created", null);
  return json({ success: true, message: "CharmIPTV administrator created successfully.", admin: { id, username, email } }, 201);
}

async function registerWithInvite(request, env) {
  const body = await safeJson(request);
  const inviteCode = String(body.invite_code || "").trim().toUpperCase();
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!inviteCode) return json({ success: false, error: "Invitation code is required." }, 400);
  if (!validUsername(username)) return json({ success: false, error: "Invalid username." }, 400);
  if (!validEmail(email)) return json({ success: false, error: "Invalid email address." }, 400);
  if (password.length < 8) return json({ success: false, error: "Password must contain at least 8 characters." }, 400);
  const now = unixNow();
  const adminInvite = await env.DB.prepare("SELECT * FROM invites WHERE invite_code = ?1 LIMIT 1").bind(inviteCode).first();
  const referralInvite = adminInvite ? null : await findReferralInvitation(env, inviteCode);
  if (!adminInvite && !referralInvite) return json({ success: false, error: "Invalid invitation code." }, 404);
  if (adminInvite) {
    if (adminInvite.status !== "unused") return json({ success: false, error: "This invitation is no longer available." }, 409);
    if (adminInvite.expires_at !== null && Number(adminInvite.expires_at) <= now) {
      await env.DB.prepare("UPDATE invites SET status = 'expired' WHERE id = ?1").bind(adminInvite.id).run();
      return json({ success: false, error: "This invitation has expired." }, 410);
    }
  } else {
    if (referralInvite.status !== "unused") return json({ success: false, error: "This invitation is no longer available." }, 409);
    if (Number(referralInvite.expires_at) <= now || (referralInvite.grant_expires_at !== null && Number(referralInvite.grant_expires_at) <= now)) {
      await expireUnusedInvites(env, referralInvite.owner_user_id, now);
      return json({ success: false, error: "This invitation has expired." }, 410);
    }
  }
  const duplicate = await env.DB.prepare("SELECT id FROM users WHERE username = ?1 OR email = ?2 LIMIT 1").bind(username, email).first();
  if (duplicate) return json({ success: false, error: "That username or email is already registered." }, 409);
  const userId = crypto.randomUUID();
  const maxSessions = Number(adminInvite ? adminInvite.max_sessions : referralInvite.max_sessions);
  const expiresAt = adminInvite
    ? (adminInvite.account_duration_days === null ? null : now + Number(adminInvite.account_duration_days) * DAY)
    : (referralInvite.grant_expires_at === null ? null : Number(referralInvite.grant_expires_at));
  await env.DB.prepare(`INSERT INTO users
    (id, username, email, password_hash, role, status, max_sessions, created_at, activated_at, expires_at)
    VALUES (?1, ?2, ?3, ?4, 'user', 'active', ?5, ?6, ?6, ?7)`)
    .bind(userId, username, email, await hashPassword(password), maxSessions, now, expiresAt).run();
  let claimed;
  if (adminInvite) {
    const result = await env.DB.prepare(`UPDATE invites SET status = 'used', redeemed_by_user_id = ?1, redeemed_at = ?2
      WHERE id = ?3 AND status = 'unused'`).bind(userId, now, adminInvite.id).run();
    claimed = changed(result) === 1;
  } else {
    claimed = await consumeReferralInvitation(env, referralInvite, userId, now);
  }
  if (!claimed) {
    await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId).run();
    return json({ success: false, error: "This invitation was already used. Please request another." }, 409);
  }
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?1 LIMIT 1").bind(userId).first();
  const issued = await issueSession(env, user, now);
  await audit(env, userId, null, "account_registered", null);
  return json({ success: true, token: issued.token, session_expires_at: issued.expiresAt, user: publicUser(user) }, 201);
}

async function login(request, env) {
  const body = await safeJson(request);
  const loginValue = String(body.login ?? body.username ?? body.email ?? "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!loginValue || !password) return json({ success: false, error: "Username/email and password are required." }, 400);
  const user = await env.DB.prepare("SELECT * FROM users WHERE lower(username) = ?1 OR lower(email) = ?1 LIMIT 1").bind(loginValue).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) return json({ success: false, error: "Invalid username/email or password." }, 401);
  const now = unixNow();
  if (user.status === "disabled") return json({ success: false, error: "This CharmIPTV account has been disabled." }, 403);
  if (user.status === "expired" || (user.expires_at !== null && Number(user.expires_at) <= now)) {
    await deleteAccountData(env, user.id, "account_expired");
    return json({ success: false, error: "This CharmIPTV account expired and was permanently removed." }, 403);
  }
  await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1 AND revoked = 0 AND expires_at <= ?2").bind(user.id, now).run();
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked = 0 AND expires_at > ?2").bind(user.id, now).first();
  const activeCount = Number(countRow?.count || 0);
  const maxSessions = Math.max(1, Number(user.max_sessions || 1));
  if (activeCount >= maxSessions) {
    const oldest = await env.DB.prepare(`SELECT id FROM sessions WHERE user_id = ?1 AND revoked = 0 AND expires_at > ?2
      ORDER BY last_activity_at ASC LIMIT ?3`).bind(user.id, now, activeCount - maxSessions + 1).all();
    for (const session of oldest.results || []) {
      await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?1").bind(session.id).run();
    }
  }
  const issued = await issueSession(env, user, now);
  await env.DB.prepare("UPDATE users SET last_login_at = ?1 WHERE id = ?2").bind(now, user.id).run();
  await audit(env, user.id, null, "login", null);
  return json({ success: true, token: issued.token, session_expires_at: issued.expiresAt, user: publicUser(user) });
}

async function issueSession(env, user, now) {
  const token = secureToken(48);
  const expiresAt = now + SESSION_DAYS * DAY;
  await env.DB.prepare(`INSERT INTO sessions
    (id, user_id, token_hash, created_at, last_activity_at, expires_at, revoked)
    VALUES (?1, ?2, ?3, ?4, ?4, ?5, 0)`)
    .bind(crypto.randomUUID(), user.id, await sha256(token), now, expiresAt).run();
  return { token, expiresAt };
}

async function adminDashboard(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const now = unixNow();
  const total = await count(env, "SELECT COUNT(*) AS count FROM users WHERE role = 'user'");
  const active = await count(env, "SELECT COUNT(*) AS count FROM users WHERE role = 'user' AND status = 'active' AND (expires_at IS NULL OR expires_at > ?1)", now);
  const disabled = await count(env, "SELECT COUNT(*) AS count FROM users WHERE role = 'user' AND status = 'disabled'");
  const sessions = await count(env, "SELECT COUNT(*) AS count FROM sessions WHERE revoked = 0 AND expires_at > ?1", now);
  const invites = await count(env, "SELECT COUNT(*) AS count FROM invites WHERE status = 'unused' AND (expires_at IS NULL OR expires_at > ?1)", now);
  return json({ success: true, dashboard: { total_users: total, active_users: active, disabled_users: disabled, expired_users: 0, active_sessions: sessions, unused_invites: invites } });
}

async function adminListInvites(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const result = await env.DB.prepare(`SELECT id, invite_code, status, account_duration_days, max_sessions, created_at,
    expires_at, redeemed_at, redeemed_by_user_id FROM invites ORDER BY created_at DESC LIMIT 500`).all();
  return json({ success: true, invites: result.results || [] });
}

async function adminCreateInvite(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const body = await safeJson(request);
  const durationDays = body.account_duration_days === null ? null : clampInt(body.account_duration_days ?? 30, 1, 3650);
  const maxSessions = clampInt(body.max_sessions ?? 1, 1, 20);
  const inviteDays = body.invite_expires_days === null ? null : clampInt(body.invite_expires_days ?? 7, 1, 365);
  const now = unixNow();
  const invite = { id: crypto.randomUUID(), code: `CHARM-${randomCode(4)}-${randomCode(4)}`, expiresAt: inviteDays === null ? null : now + inviteDays * DAY };
  await env.DB.prepare(`INSERT INTO invites
    (id, invite_code, status, account_duration_days, max_sessions, created_by_user_id, created_at, expires_at)
    VALUES (?1, ?2, 'unused', ?3, ?4, ?5, ?6, ?7)`)
    .bind(invite.id, invite.code, durationDays, maxSessions, auth.user.id, now, invite.expiresAt).run();
  await audit(env, null, auth.user.id, "invite_created", null);
  return json({ success: true, invite: { invite_code: invite.code, account_duration_days: durationDays, max_sessions: maxSessions, expires_at: invite.expiresAt } }, 201);
}

async function adminListUsers(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const now = unixNow();
  const result = await env.DB.prepare(`SELECT u.*,
    (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked = 0 AND s.expires_at > ?1) AS active_sessions
    FROM users u ORDER BY u.created_at DESC LIMIT 1000`).bind(now).all();
  return json({ success: true, users: (result.results || []).map((user) => ({ ...publicUser(user), active_sessions: Number(user.active_sessions || 0) })) });
}

async function adminUpdateUser(request, env, userId) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const existing = await env.DB.prepare("SELECT * FROM users WHERE id = ?1 LIMIT 1").bind(userId).first();
  if (!existing) return json({ success: false, error: "User not found." }, 404);
  const body = await safeJson(request);
  let status = existing.status;
  let maxSessions = Number(existing.max_sessions);
  let expiresAt = existing.expires_at;
  if (body.status !== undefined) {
    if (!["active", "disabled", "expired"].includes(body.status)) return json({ success: false, error: "Invalid account status." }, 400);
    status = body.status;
  }
  if (body.max_sessions !== undefined) maxSessions = clampInt(body.max_sessions, 1, 20);
  if (body.expires_at !== undefined) expiresAt = body.expires_at === null ? null : Number(body.expires_at);
  if (body.extend_days !== undefined) {
    const base = existing.expires_at && Number(existing.expires_at) > unixNow() ? Number(existing.expires_at) : unixNow();
    expiresAt = base + clampInt(body.extend_days, 1, 3650) * DAY;
    status = "active";
  }
  if (status === "expired" || (expiresAt !== null && Number(expiresAt) <= unixNow())) {
    await deleteAccountData(env, userId, "account_expired");
    return json({ success: true, message: "Expired user and personal data permanently deleted." });
  }
  await env.DB.prepare("UPDATE users SET status = ?1, max_sessions = ?2, expires_at = ?3 WHERE id = ?4").bind(status, maxSessions, expiresAt, userId).run();
  if (status !== "active") await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1").bind(userId).run();
  await audit(env, userId, auth.user.id, "user_updated", JSON.stringify({ status, max_sessions: maxSessions, expires_at: expiresAt }));
  return json({ success: true, message: "User updated." });
}

async function adminDeleteUser(request, env, userId) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?1 LIMIT 1").bind(userId).first();
  if (!user) return json({ success: false, error: "User not found." }, 404);
  if (user.id === auth.user.id) return json({ success: false, error: "You cannot delete your own admin account." }, 400);
  await deleteAccountData(env, userId, "admin_deleted");
  return json({ success: true, message: "User and personal data permanently deleted." });
}

async function adminLogoutUser(request, env, userId) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1").bind(userId).run();
  await audit(env, userId, auth.user.id, "force_logout", null);
  return json({ success: true, message: "All sessions revoked." });
}

async function adminResetPassword(request, env, userId) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const body = await safeJson(request);
  const password = String(body.new_password || "");
  if (password.length < 8) return json({ success: false, error: "Password must contain at least 8 characters." }, 400);
  await env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(await hashPassword(password), userId).run();
  await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1").bind(userId).run();
  await audit(env, userId, auth.user.id, "password_reset_by_admin", null);
  return json({ success: true, message: "Password changed and existing sessions logged out." });
}

async function adminRevokeInvite(request, env, inviteId) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const invite = await env.DB.prepare("SELECT * FROM invites WHERE id = ?1 LIMIT 1").bind(inviteId).first();
  if (!invite) return json({ success: false, error: "Invitation not found." }, 404);
  if (invite.status === "used") return json({ success: false, error: "A used invitation cannot be revoked." }, 400);
  await env.DB.prepare("UPDATE invites SET status = 'disabled' WHERE id = ?1").bind(inviteId).run();
  await audit(env, null, auth.user.id, "invite_revoked", null);
  return json({ success: true, message: "Invitation revoked." });
}

async function adminDeleteInvite(request, env, inviteId) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!(await env.DB.prepare("SELECT id FROM invites WHERE id = ?1 LIMIT 1").bind(inviteId).first())) return json({ success: false, error: "Invitation not found." }, 404);
  await env.DB.prepare("DELETE FROM invites WHERE id = ?1").bind(inviteId).run();
  return json({ success: true, message: "Invitation deleted." });
}

function addUtcMonths(timestampSeconds, months) {
  const source = new Date(timestampSeconds * 1000);
  const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + months) / 12);
  const targetMonth = ((source.getUTCMonth() + months) % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(targetYear, targetMonth, Math.min(source.getUTCDate(), lastDay), source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds()) / 1000);
}

function referralCycleFor(createdAt, now) {
  const start = Number(createdAt);
  const source = new Date(start * 1000);
  const current = new Date(now * 1000);
  const monthDistance = (current.getUTCFullYear() - source.getUTCFullYear()) * 12 + current.getUTCMonth() - source.getUTCMonth();
  let cycles = Math.max(0, Math.floor(monthDistance / 6));
  let candidate = addUtcMonths(start, cycles * 6);
  while (candidate > now && cycles > 0) candidate = addUtcMonths(start, --cycles * 6);
  let end = addUtcMonths(start, (cycles + 1) * 6);
  while (end <= now) { candidate = end; end = addUtcMonths(start, (++cycles + 1) * 6); }
  return { startedAt: candidate, endsAt: end };
}

async function ensureReferralSlots(env, user, cycle) {
  const statements = [];
  for (let slot = 1; slot <= REFERRAL_LIMIT; slot++) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO referral_slots
    (owner_user_id, slot_number, invite_id, consumed_at, cycle_started_at, cycle_ends_at)
    VALUES (?1, ?2, NULL, NULL, ?3, ?4)`).bind(user.id, slot, cycle.startedAt, cycle.endsAt));
  for (let slot = 1; slot <= REFERRAL_ACTIVE_LIMIT; slot++) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO referral_network_slots
    (owner_user_id, slot_number, invite_id) VALUES (?1, ?2, NULL)`).bind(user.id, slot));
  await env.DB.batch(statements);
}

async function expireUnusedInvites(env, ownerId, now) {
  const result = await env.DB.prepare(`SELECT id FROM referral_invites WHERE owner_user_id = ?1 AND status = 'unused'
    AND (expires_at <= ?2 OR (grant_expires_at IS NOT NULL AND grant_expires_at <= ?2))`).bind(ownerId, now).all();
  for (const invite of result.results || []) {
    await env.DB.batch([
      env.DB.prepare("UPDATE referral_invites SET status = 'code_expired', ended_at = ?2, end_reason = 'unused_code_expired' WHERE id = ?1 AND status = 'unused'").bind(invite.id, now),
      env.DB.prepare("UPDATE referral_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2").bind(ownerId, invite.id),
      env.DB.prepare("UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2").bind(ownerId, invite.id),
    ]);
  }
}

async function readReferralSlots(env, ownerId) {
  const allowance = await env.DB.prepare(`SELECT s.*, i.status invite_status, i.expires_at invite_expires_at, i.grant_expires_at invite_grant_expires_at
    FROM referral_slots s LEFT JOIN referral_invites i ON i.id = s.invite_id WHERE s.owner_user_id = ?1 ORDER BY s.slot_number`).bind(ownerId).all();
  const network = await env.DB.prepare(`SELECT n.*, i.status invite_status FROM referral_network_slots n
    LEFT JOIN referral_invites i ON i.id = n.invite_id WHERE n.owner_user_id = ?1 ORDER BY n.slot_number`).bind(ownerId).all();
  return { allowance: allowance.results || [], network: network.results || [] };
}

async function syncReferralSlots(env, user, now) {
  const cycle = referralCycleFor(Number(user.created_at), now);
  await ensureReferralSlots(env, user, cycle);
  await expireUnusedInvites(env, user.id, now);
  let slots = await readReferralSlots(env, user.id);
  for (const slot of slots.allowance) {
    const live = slot.invite_id && slot.invite_status === "unused" && Number(slot.invite_expires_at) > now && (slot.invite_grant_expires_at === null || Number(slot.invite_grant_expires_at) > now);
    if (Number(slot.cycle_started_at) !== cycle.startedAt) {
      await env.DB.prepare(`UPDATE referral_slots SET invite_id = ?3, consumed_at = NULL, cycle_started_at = ?4, cycle_ends_at = ?5
        WHERE owner_user_id = ?1 AND slot_number = ?2`).bind(user.id, slot.slot_number, live ? slot.invite_id : null, cycle.startedAt, cycle.endsAt).run();
    } else if (slot.invite_id && !live) {
      await env.DB.prepare("UPDATE referral_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND slot_number = ?2").bind(user.id, slot.slot_number).run();
    }
  }
  for (const slot of slots.network) {
    if (slot.invite_id && !["unused", "active"].includes(slot.invite_status)) {
      await env.DB.prepare("UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND slot_number = ?2").bind(user.id, slot.slot_number).run();
    }
  }
  slots = await readReferralSlots(env, user.id);
  return { cycle, ...slots };
}

function referralAvailability(allowance, network) {
  const used = allowance.filter((slot) => slot.consumed_at !== null).length;
  const active = allowance.filter((slot) => slot.invite_id !== null).length;
  const occupied = network.filter((slot) => slot.invite_id !== null).length;
  const networkAvailable = Math.max(0, REFERRAL_ACTIVE_LIMIT - occupied);
  return { limit: 2, active_limit: 6, used, active, occupied, network_available: networkAvailable, available: Math.min(Math.max(0, 2 - used - active), networkAvailable) };
}

async function buildReferralSummary(env, user, now) {
  await syncReferralSlots(env, user, now);
  const ended = await env.DB.prepare(`SELECT i.redeemed_by_user_id FROM referral_invites i LEFT JOIN users u ON u.id = i.redeemed_by_user_id
    WHERE i.owner_user_id = ?1 AND i.status = 'active' AND (u.id IS NULL OR u.status != 'active' OR (u.expires_at IS NOT NULL AND u.expires_at <= ?2))`).bind(user.id, now).all();
  for (const row of ended.results || []) if (row.redeemed_by_user_id) await releaseReferralForAccount(env, row.redeemed_by_user_id, "account_expired", now);
  const slots = await syncReferralSlots(env, user, now);
  const result = await env.DB.prepare(`SELECT i.id, i.invite_code, i.status, i.network_slot_number, i.created_at, i.expires_at,
    i.redeemed_at, i.ended_at, i.end_reason, CASE WHEN i.status = 'active' THEN u.expires_at ELSE NULL END account_expires_at
    FROM referral_invites i LEFT JOIN users u ON u.id = i.redeemed_by_user_id WHERE i.owner_user_id = ?1
    ORDER BY COALESCE(i.network_slot_number, 99), i.created_at DESC LIMIT 50`).bind(user.id).all();
  const invitations = result.results || [];
  return { ...referralAvailability(slots.allowance, slots.network), active_accounts: invitations.filter((item) => item.status === "active").length, cycle_started_at: slots.cycle.startedAt, renews_at: slots.cycle.endsAt, invitations };
}

async function reserveReferralSlot(env, table, userId, inviteId, slots) {
  for (const slot of slots) {
    if (slot.invite_id !== null || (table === "referral_slots" && slot.consumed_at !== null)) continue;
    const extra = table === "referral_slots" ? "AND consumed_at IS NULL" : "";
    const result = await env.DB.prepare(`UPDATE ${table} SET invite_id = ?3 WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id IS NULL ${extra}`).bind(userId, slot.slot_number, inviteId).run();
    if (changed(result) === 1) return Number(slot.slot_number);
  }
  return null;
}

async function createReferralInvitation(env, user, now) {
  const slots = await syncReferralSlots(env, user, now);
  if (referralAvailability(slots.allowance, slots.network).available < 1) throw statusError("You have no invitations available right now.", 409);
  const id = crypto.randomUUID();
  const networkSlot = await reserveReferralSlot(env, "referral_network_slots", user.id, id, slots.network);
  if (networkSlot === null) throw statusError("All six invited-account positions are currently in use.", 409);
  const allowanceSlot = await reserveReferralSlot(env, "referral_slots", user.id, id, slots.allowance);
  if (allowanceSlot === null) {
    await env.DB.prepare("UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2").bind(user.id, id).run();
    throw statusError("You have no invitations available right now.", 409);
  }
  const expiresAt = now + REFERRAL_INVITE_SECONDS;
  let code;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      code = `CHARM-${randomCode(4)}-${randomCode(4)}`;
      try {
        await env.DB.prepare(`INSERT INTO referral_invites
          (id, invite_code, owner_user_id, status, network_slot_number, max_sessions, grant_expires_at, created_at, expires_at)
          VALUES (?1, ?2, ?3, 'unused', ?4, ?5, ?6, ?7, ?8)`)
          .bind(id, code, user.id, networkSlot, Math.max(1, Number(user.max_sessions || 1)), user.expires_at === null ? null : Number(user.expires_at), now, expiresAt).run();
        break;
      } catch (error) { if (attempt === 4) throw error; code = null; }
    }
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare("UPDATE referral_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2").bind(user.id, id),
      env.DB.prepare("UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2").bind(user.id, id),
    ]);
    throw error;
  }
  return { id, invite_code: code, status: "unused", network_slot_number: networkSlot, created_at: now, expires_at: expiresAt, redeemed_at: null };
}

async function findReferralInvitation(env, code) {
  return env.DB.prepare("SELECT * FROM referral_invites WHERE invite_code = ?1 LIMIT 1").bind(String(code || "").trim().toUpperCase()).first();
}

async function consumeReferralInvitation(env, invitation, newUserId, now) {
  const owner = await env.DB.prepare("SELECT id, created_at, expires_at, max_sessions FROM users WHERE id = ?1 AND status = 'active' LIMIT 1").bind(invitation.owner_user_id).first();
  if (!owner || (owner.expires_at !== null && Number(owner.expires_at) <= now)) return false;
  await syncReferralSlots(env, owner, now);
  const result = await env.DB.prepare(`UPDATE referral_invites SET status = 'active', redeemed_by_user_id = ?2, redeemed_at = ?3
    WHERE id = ?1 AND status = 'unused' AND expires_at > ?3`).bind(invitation.id, newUserId, now).run();
  if (changed(result) !== 1) return false;
  await env.DB.prepare("UPDATE referral_slots SET invite_id = NULL, consumed_at = ?3 WHERE owner_user_id = ?1 AND invite_id = ?2").bind(invitation.owner_user_id, invitation.id, now).run();
  return true;
}

async function releaseReferralForAccount(env, userId, reason, now) {
  const invite = await env.DB.prepare("SELECT id, owner_user_id FROM referral_invites WHERE redeemed_by_user_id = ?1 AND status = 'active' LIMIT 1").bind(userId).first();
  if (!invite) return false;
  const status = reason === "account_expired" ? "account_expired" : "canceled";
  const result = await env.DB.prepare(`UPDATE referral_invites SET status = ?2, redeemed_by_user_id = NULL, ended_at = ?3, end_reason = ?4
    WHERE id = ?1 AND status = 'active'`).bind(invite.id, status, now, reason).run();
  if (changed(result) !== 1) return false;
  await env.DB.batch([
    env.DB.prepare("UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2").bind(invite.owner_user_id, invite.id),
    env.DB.prepare(`UPDATE referral_slots SET consumed_at = NULL WHERE owner_user_id = ?1 AND slot_number =
      (SELECT slot_number FROM referral_slots WHERE owner_user_id = ?1 AND consumed_at IS NOT NULL AND invite_id IS NULL ORDER BY consumed_at DESC LIMIT 1)`).bind(invite.owner_user_id),
  ]);
  return true;
}

async function deleteReferralHistory(env, ownerId, inviteId) {
  const invite = await env.DB.prepare("SELECT status FROM referral_invites WHERE id = ?1 AND owner_user_id = ?2 LIMIT 1").bind(inviteId, ownerId).first();
  if (!invite) return { ok: false, status: 404, error: "Invitation not found." };
  if (!["disabled", "code_expired", "account_expired", "canceled"].includes(invite.status)) return { ok: false, status: 409, error: "Only inactive invitation history can be deleted." };
  await env.DB.prepare("DELETE FROM referral_invites WHERE id = ?1 AND owner_user_id = ?2").bind(inviteId, ownerId).run();
  return { ok: true };
}

async function deleteAccountData(env, userId, reason) {
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?1 LIMIT 1").bind(userId).first();
  if (!user) return false;
  const now = unixNow();
  await releaseReferralForAccount(env, userId, reason, now);
  await env.DB.prepare("UPDATE invites SET redeemed_by_user_id = NULL WHERE redeemed_by_user_id = ?1").bind(userId).run();
  await env.DB.prepare("UPDATE invites SET created_by_user_id = NULL WHERE created_by_user_id = ?1").bind(userId).run();
  await env.DB.prepare("DELETE FROM audit_log WHERE user_id = ?1 OR admin_user_id = ?1").bind(userId).run();
  await env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?1").bind(userId).run();
  await env.DB.prepare("DELETE FROM user_preferences WHERE user_id = ?1").bind(userId).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId).run();
  return true;
}

async function purgeExpiredAccounts(env, limit) {
  const result = await env.DB.prepare(`SELECT id FROM users WHERE role = 'user' AND expires_at IS NOT NULL AND expires_at <= ?1 LIMIT ?2`).bind(unixNow(), limit).all();
  for (const user of result.results || []) await deleteAccountData(env, user.id, "account_expired");
  return (result.results || []).length;
}

async function requireUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return { ok: false, response: json({ success: false, error: "Authentication required." }, 401) };
  const hash = await sha256(header.slice(7).trim());
  const now = unixNow();
  const session = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?1 LIMIT 1").bind(hash).first();
  if (!session || session.revoked || Number(session.expires_at) <= now) return { ok: false, response: json({ success: false, error: "Your session has expired or was logged out." }, 401) };
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?1 LIMIT 1").bind(session.user_id).first();
  if (!user) return { ok: false, response: json({ success: false, error: "Account not found." }, 401) };
  if (user.expires_at !== null && Number(user.expires_at) <= now) {
    await deleteAccountData(env, user.id, "account_expired");
    return { ok: false, response: json({ success: false, error: "This account expired and was permanently removed." }, 401) };
  }
  if (user.status !== "active") return { ok: false, response: json({ success: false, error: "This account is not active." }, 403) };
  if (now - Number(session.last_activity_at || 0) >= 300) await env.DB.prepare("UPDATE sessions SET last_activity_at = ?1 WHERE id = ?2").bind(now, session.id).run();
  return { ok: true, user, session };
}

async function requireAdmin(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth;
  if (auth.user.role !== "admin") return { ok: false, response: json({ success: false, error: "Administrator permission required." }, 403) };
  return auth;
}

async function createContentAccess(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth.response;
  const sources = managedSourceConfiguration(env);
  // Never authenticate into a silently partial catalog: a missing second URL
  // previously looked like a successful login, then every secondary refresh
  // failed with zero health. Slots three/four can be enabled later, but each
  // configured slot must always contain both its playlist and Guide address.
  if (!sources.ready) {
    return json({ success: false, error: "The supplied CharmIPTV playlist and Guide sources are not fully configured." }, 503);
  }
  const expiresAt = Number(auth.session.expires_at);
  // The APK never contains provider URLs. Release them only after a valid
  // account/session check, over this HTTPS response, so Android can contact
  // providers directly with the same M3U/XMLTV transport used by build #150.
  // This avoids changing the request origin to a Cloudflare data-center IP.
  const contentSources = sources.configured.map((configured) => ({
    id: configured.id,
    playlist_url: configured.playlistUrl,
    epg_url: configured.epgUrl,
  }));
  const named = Object.fromEntries(contentSources.map(({ id, playlist_url, epg_url }) => [id, { playlist_url, epg_url }]));
  return json({
    success: true,
    content: {
      expires_at: expiresAt,
      sources: contentSources,
      // Named pairs keep already-issued two-source APKs compatible while the
      // scalable array lets this and future APKs consume up to four slots.
      ...named,
    },
  });
}

function managedSourceConfiguration(env) {
  const slots = MANAGED_SOURCE_SLOTS.map((slot) => {
    const playlistValue = String(env[slot.playlist] || "").trim();
    const epgValue = String(env[slot.epg] || "").trim();
    const absent = !playlistValue && !epgValue;
    const configured = validManagedSource(playlistValue) && validManagedSource(epgValue);
    return {
      ...slot,
      state: absent ? "missing" : configured ? "configured" : "incomplete",
      playlistUrl: configured ? playlistValue : "",
      epgUrl: configured ? epgValue : "",
    };
  });
  const configured = slots.filter((slot) => slot.state === "configured");
  const requiredReady = slots.filter((slot) => slot.required).every((slot) => slot.state === "configured");
  const noPartialPairs = slots.every((slot) => slot.state !== "incomplete");
  const noSlotGap = slots[3].state !== "configured" || slots[2].state === "configured";
  return { slots, configured, ready: requiredReady && noPartialPairs && noSlotGap };
}

function validManagedSource(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, 256);
  return ["pbkdf2-sha256", PBKDF2_ITERATIONS, bytesToBase64(salt), bytesToBase64(new Uint8Array(bits))].join("$");
}

async function verifyPassword(password, stored) {
  try {
    const [algorithm, iterationsText, salt64, expected64] = String(stored).split("$");
    if (algorithm !== "pbkdf2-sha256") return false;
    const salt = base64ToBytes(salt64);
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iterationsText), hash: "SHA-256" }, material, 256));
    const expected = base64ToBytes(expected64);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch { return false; }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicUser(user) {
  return {
    id: user.id, username: user.username, email: user.email, role: user.role, status: user.status,
    max_sessions: Number(user.max_sessions), created_at: Number(user.created_at),
    activated_at: user.activated_at === null ? null : Number(user.activated_at),
    expires_at: user.expires_at === null ? null : Number(user.expires_at),
    last_login_at: user.last_login_at === null ? null : Number(user.last_login_at),
  };
}

async function audit(env, userId, adminId, action, details) {
  await env.DB.prepare(`INSERT INTO audit_log (user_id, admin_user_id, action, details, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5)`).bind(userId, adminId, action, details, unixNow()).run();
}

async function count(env, sql, value) {
  const statement = env.DB.prepare(sql);
  const row = value === undefined ? await statement.first() : await statement.bind(value).first();
  return Number(row?.count || 0);
}

function changed(result) { return Number(result?.meta?.changes || 0); }
function unixNow() { return Math.floor(Date.now() / 1000); }
async function safeJson(request) { try { return await request.json(); } catch { return {}; } }
function normalizeUsername(value) { return String(value || "").trim().toLowerCase(); }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function validUsername(value) { return /^[a-z0-9._-]{3,32}$/.test(value); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function clampInt(value, min, max) { const number = Math.floor(Number(value)); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min; }
function statusError(message, status) { const error = new Error(message); error.status = status; return error; }

function randomCode(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function secureToken(length = 48) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(length))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Setup-Key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  } });
}

function corsResponse(body, status = 204) {
  return new Response(body, { status, headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Setup-Key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Max-Age": "86400",
  } });
}
