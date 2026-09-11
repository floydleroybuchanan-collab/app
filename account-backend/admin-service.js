import { ADMIN_FLAGS, ADMIN_LIMITS, DAY, demandPermission, integer, invitationTerms, listingOptions, normalizeAdminProfile, policyError } from "./admin-policy.js";

import { botAdmin } from './bot-admin.js';
import { appControlsAdmin } from './app-controls.js';
const PROFILE_KEYS = ["enabled", ...ADMIN_FLAGS, ...Object.keys(ADMIN_LIMITS)];
const USER_SORTS = { newest: "u.created_at DESC,u.id", oldest: "u.created_at,u.id", alphabetical: "u.username COLLATE NOCASE,u.id", alphabetical_desc: "u.username COLLATE NOCASE DESC,u.id", expires_soon: "u.expires_at IS NULL,u.expires_at,u.id", most_time: "u.expires_at IS NULL DESC,u.expires_at DESC,u.id", last_login: "u.last_login_at DESC,u.id" };
const INVITE_SORTS = { newest: "i.created_at DESC,i.id", oldest: "i.created_at,i.id", expires_soon: "i.expires_at IS NULL,i.expires_at,i.id", duration: "i.account_duration_days IS NULL,i.account_duration_days,i.id", creator: "creator.username COLLATE NOCASE,i.created_at DESC,i.id" };
const ADMIN_SORTS = { newest: "u.created_at DESC,u.id", oldest: "u.created_at,u.id", alphabetical: "u.username COLLATE NOCASE,u.id", accounts_created: "st.accounts_created DESC,u.id", last_login: "u.last_login_at DESC,u.id" };

const stmt = (env, sql, values = []) => values.length ? env.DB.prepare(sql).bind(...values) : env.DB.prepare(sql);
const rows = async (env, sql, values = []) => (await stmt(env, sql, values).all()).results || [];
const first = (env, sql, values = []) => stmt(env, sql, values).first();
const changes = result => Number(result?.meta?.changes || 0);
const allowedBody = (body, keys) => { for (const key of Object.keys(body)) if (!keys.includes(key)) throw policyError(`Unsupported field: ${key}`, 400); };
const permissionProfile = row => Object.fromEntries(PROFILE_KEYS.map(key => [key, Number(row[key])]));

export async function resolveAdminAccess(env, user) {
  if (user.role !== "admin") throw policyError("Administrator permission required.");
  const profile = await first(env, "SELECT p.*, CASE WHEN o.user_id=p.user_id THEN 1 ELSE 0 END AS is_owner FROM admin_profiles p LEFT JOIN admin_owner o ON o.user_id=p.user_id WHERE p.user_id=?1", [user.id]);
  if (!profile || profile.enabled !== 1) throw policyError("This administrator's panel access is disabled. Contact the owner.");
  return { user, profile, isOwner: profile.is_owner === 1 };
}

function scope(auth, alias, values) {
  if (auth.isOwner || auth.profile.can_manage_all) return "1=1";
  values.push(auth.user.id);
  return `${alias}=?${values.length}`;
}
async function paged(env, options, from, where, values, columns) {
  const count = Number((await first(env, `SELECT COUNT(*) AS count ${from} WHERE ${where.join(" AND ")}`, values))?.count || 0);
  const pages = Math.max(1, Math.ceil(count / options.pageSize));
  const page = Math.min(options.page, pages);
  const data = await rows(env, `SELECT ${columns} ${from} WHERE ${where.join(" AND ")} ORDER BY ${options.orderBy} LIMIT ?${values.length + 1} OFFSET ?${values.length + 2}`, [...values, options.pageSize, (page - 1) * options.pageSize]);
  return { data, pagination: { page, page_size: options.pageSize, total: count, pages } };
}
function searchWhere(options, where, values, columns) {
  if (!options.search) return;
  values.push(options.pattern);
  where.push(`(${columns.map(column => `${column} LIKE ?${values.length} ESCAPE '\\'`).join(" OR ")})`);
}
function creatorWhere(url, auth, where, values, column) {
  const creator = url.searchParams.get("creator");
  if (!creator) return;
  if (!auth.isOwner && !auth.profile.can_manage_all && creator !== auth.user.id) throw policyError("Other administrators' accounts are outside your scope.");
  if (creator === "unattributed") where.push(`${column} IS NULL`);
  else { values.push(creator); where.push(`${column}=?${values.length}`); }
}
async function targetUser(env, auth, id) {
  const row = await first(env, "SELECT u.*,a.admin_user_id AS creator_id,a.origin FROM users u LEFT JOIN admin_user_attribution a ON a.user_id=u.id WHERE u.id=?1 AND u.role='user'", [id]);
  if (!row || (!auth.isOwner && !auth.profile.can_manage_all && row.creator_id !== auth.user.id)) throw policyError("User not found in your permitted accounts.", 404);
  return row;
}
async function targetInvite(env, auth, id) {
  const row = await first(env, "SELECT * FROM invites WHERE id=?1", [id]);
  if (!row || (!auth.isOwner && !auth.profile.can_manage_all && row.created_by_user_id !== auth.user.id)) throw policyError("Invitation not found in your permitted accounts.", 404);
  return row;
}
async function ownerRecheck(auth, body, verifyPassword) {
  if (!auth.isOwner) throw policyError("Only the owner can manage administrators.");
  if (!body.owner_password || !(await verifyPassword(String(body.owner_password), auth.user.password_hash)))
    throw policyError("Confirm this action with your current owner password.");
}

export async function handleAdminRequest(request, env, helpers) {
  const { requireUser, json, safeJson, publicUser, hashPassword, verifyPassword, audit, deleteAccountData } = helpers;
  const session = await requireUser(request, env, { panel: true });
  if (!session.ok) return session.response;
  const auth = { ...session, ...await resolveAdminAccess(env, session.user) };
  const url = new URL(request.url), path = url.pathname, method = request.method;
  const now = Math.floor(Date.now() / 1000);
  if (path === '/admin/app-settings') return appControlsAdmin(request,env,auth,helpers);
  if (path.startsWith('/admin/bot/')) return botAdmin(request,env,auth,helpers);
  if (path === "/admin/me" && method === "GET") return json({ success: true, admin: { ...publicUser(auth.user), is_owner: auth.isOwner, permissions: permissionProfile(auth.profile) } });

  if (path === "/admin/creators" && method === "GET") {
    const list = await rows(env, `SELECT u.id,u.username FROM users u JOIN admin_profiles p ON p.user_id=u.id WHERE ${auth.isOwner || auth.profile.can_manage_all ? "1=1" : "u.id=?1"} ORDER BY u.username`, auth.isOwner || auth.profile.can_manage_all ? [] : [auth.user.id]);
    return json({ success: true, creators: list });
  }
  if (path === "/admin/users" && method === "GET") {
    const options = listingOptions(url, USER_SORTS), values = [now], where = ["?1>=0", "u.role='user'", scope(auth, "a.admin_user_id", values)];
    searchWhere(options, where, values, ["u.username", "u.email", "tm.username", "tm.telegram_id", "ti.invite_code"]);
    creatorWhere(url, auth, where, values, "a.admin_user_id");
    const status = url.searchParams.get("status") || "all";
    if (["active", "disabled", "expired"].includes(status)) { values.push(status); where.push(`u.status=?${values.length}`); }
    else if (status === "unlimited") where.push("u.expires_at IS NULL");
    else if (["expiring7", "expiring14", "expiring30"].includes(status)) { values.push(now + Number(status.slice(8)) * DAY); where.push(`u.expires_at>?1 AND u.expires_at<=?${values.length}`); }
    else if (status !== "all") throw policyError("Invalid account status filter.", 400);
    const result = await paged(env, options, "FROM users u LEFT JOIN admin_user_attribution a ON a.user_id=u.id LEFT JOIN users creator ON creator.id=a.admin_user_id LEFT JOIN bot_members tm ON tm.account_id=u.id LEFT JOIN invites ti ON ti.id=tm.invite_id", where, values,
      "tm.telegram_id,tm.username AS telegram_username,tm.name AS telegram_name,tm.status AS telegram_status,u.id,u.username,u.email,u.role,u.status,u.max_sessions,u.created_at,u.activated_at,u.expires_at,u.last_login_at,a.admin_user_id AS created_by_admin_id,a.origin,creator.username AS created_by_admin_name,(SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.revoked=0 AND s.expires_at>?1) AS active_sessions");
    return json({ success: true, users: result.data, pagination: result.pagination });
  }
  if (path === "/admin/invites" && method === "GET") {
    const options = listingOptions(url, INVITE_SORTS), values = [], where = [scope(auth, "i.created_by_user_id", values)];
    searchWhere(options, where, values, ["i.invite_code", "redeemer.username", "tm.username", "tm.telegram_id"]);
    creatorWhere(url, auth, where, values, "i.created_by_user_id");
    const status = url.searchParams.get("status") || "all";
    if (["unused", "used", "disabled", "expired"].includes(status)) {
      values.push(now); const timestamp = `?${values.length}`;
      if (status === "unused") where.push(`i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>${timestamp})`);
      else if (status === "expired") where.push(`(i.status='expired' OR (i.status='unused' AND i.expires_at<=${timestamp}))`);
      else { values.pop(); values.push(status); where.push(`i.status=?${values.length}`); }
    } else if (status !== "all") throw policyError("Invalid invitation status filter.", 400);
    const result = await paged(env, options, "FROM invites i LEFT JOIN users creator ON creator.id=i.created_by_user_id LEFT JOIN users redeemer ON redeemer.id=i.redeemed_by_user_id LEFT JOIN bot_members tm ON tm.invite_id=i.id", where, values,
      "tm.telegram_id,tm.username AS telegram_username,tm.name AS telegram_name,i.id,i.invite_code,i.status,i.account_duration_days,i.max_sessions,i.created_at,i.expires_at,i.redeemed_at,i.redeemed_by_user_id,i.created_by_user_id,creator.username AS created_by_admin_name,redeemer.username AS redeemed_by_username,redeemer.status AS redeemed_user_status,redeemer.role AS redeemed_user_role");
    return json({ success: true, invites: result.data.map(i => ({ ...i, status: i.status === "unused" && i.expires_at != null && i.expires_at <= now ? "expired" : i.status })), pagination: result.pagination });
  }
  if (path === "/admin/invites" && method === "POST") {
    const body = await safeJson(request);
    allowedBody(body, ["account_duration_days", "max_sessions", "invite_expires_days"]);
    const { duration, sessions, validDays } = invitationTerms(body, auth);
    const id = crypto.randomUUID(), code = `CHARM-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const expiry = validDays === null ? null : now + validDays * DAY;
    // Admission and all quota reads are one SQLite statement, not check-then-insert.
    const admission = auth.isOwner ? "1=1" : `EXISTS(SELECT 1 FROM admin_profiles p JOIN admin_account_stats st ON st.admin_user_id=p.user_id
      WHERE p.user_id=?6 AND p.enabled=1 AND p.revision=?9 AND p.can_create_invites=1
      AND (SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=p.user_id AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?7)) < p.max_pending_invites
      AND st.accounts_created+(SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=p.user_id AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?7)) < p.max_accounts_total
      AND (SELECT COUNT(*) FROM admin_user_attribution a JOIN users u ON u.id=a.user_id WHERE a.admin_user_id=p.user_id AND a.origin='admin_invite' AND (u.expires_at IS NULL OR u.expires_at>?7))
        +(SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=p.user_id AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?7)) < p.max_open_accounts)`;
    const values = [id, code, duration, sessions, expiry, auth.user.id, now, "unused", ...(auth.isOwner ? [] : [auth.profile.revision])];
    const inserted = await stmt(env, `INSERT INTO invites(id,invite_code,account_duration_days,max_sessions,expires_at,created_by_user_id,created_at,status)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE ${admission}`, values).run();
    if (!changes(inserted)) throw policyError("Your account/invitation budget is full, or your permissions changed. Contact the owner.", 409);
    await audit(env, null, auth.user.id, "invite_created", null);
    return json({ success: true, invite: { id, invite_code: code, account_duration_days: duration, max_sessions: sessions, created_at: now, expires_at: expiry, created_by_admin_name: auth.user.username } }, 201);
  }

  const userMatch = path.match(/^\/admin\/users\/([^/]+)(?:\/(logout|reset-password))?$/);
  if (userMatch) {
    const user = await targetUser(env, auth, userMatch[1]);
    if (!userMatch[2] && method === "GET") {
      const safe = Object.fromEntries(["id", "username", "email", "role", "status", "max_sessions", "created_at", "activated_at", "expires_at", "last_login_at"].map(key => [key, user[key]]));
      const tm=await first(env,"SELECT telegram_id,username AS telegram_username,name AS telegram_name,status AS telegram_status FROM bot_members WHERE account_id=?1",[user.id]);
      return json({ success: true, user: {...safe,...tm} });
    }
    if (userMatch[2] === "logout" && method === "POST") {
      demandPermission(auth, "can_force_logout");
      await stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [user.id]).run();
      await audit(env, user.id, auth.user.id, "force_logout", null);
      return json({ success: true, message: "All sessions revoked." });
    }
    if (userMatch[2] === "reset-password" && method === "POST") {
      demandPermission(auth, "can_reset_password");
      const body = await safeJson(request), password = String(body.new_password || "");
      allowedBody(body, ["new_password"]);
      if (password.length < 8 || password.length > 256) throw policyError("Use a password of 8–256 characters.", 400);
      await env.DB.batch([stmt(env, "UPDATE users SET password_hash=?1 WHERE id=?2 AND role='user'", [await hashPassword(password), user.id]), stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [user.id])]);
      await audit(env, user.id, auth.user.id, "password_reset_by_admin", null);
      return json({ success: true, message: "Password changed and sessions revoked." });
    }
    if (!userMatch[2] && method === "DELETE") {
      demandPermission(auth, "can_delete_users");
      if ((await safeJson(request)).confirmation !== user.username) throw policyError("Type the username to confirm permanent deletion.", 400);
      await deleteAccountData(env, user.id, "admin_deleted");
      return json({ success: true, message: "User and personal data permanently deleted." });
    }
    if (!userMatch[2] && method === "PATCH") {
      const body = await safeJson(request);
      allowedBody(body, ["status", "max_sessions", "expires_at", "extend_days"]);
      if (!Object.keys(body).length) throw policyError("No changes supplied.", 400);
      let status = user.status, sessions = Number(user.max_sessions), expiry = user.expires_at;
      if (body.status !== undefined) {
        if (!["active", "disabled", "expired"].includes(body.status)) throw policyError("Invalid status.", 400);
        demandPermission(auth, body.status === "expired" ? "can_delete_users" : "can_suspend");
        status = body.status;
      }
      if (body.max_sessions !== undefined) {
        demandPermission(auth, "can_change_sessions");
        sessions = integer(body.max_sessions, 1, auth.isOwner ? 20 : auth.profile.max_sessions, "Simultaneous sessions");
      }
      if (body.expires_at !== undefined && body.extend_days !== undefined) throw policyError("Choose an expiry date or an extension, not both.", 400);
      if (body.expires_at !== undefined || body.extend_days !== undefined) {
        demandPermission(auth, "can_change_time");
        if (!auth.isOwner && user.expires_at === null) throw policyError("Only the owner can change an unlimited account's time.");
        if (body.expires_at === null && !auth.isOwner) throw policyError("Only the owner can grant unlimited accounts.");
        expiry = body.extend_days !== undefined ? Math.max(Number(user.expires_at || now), now) + integer(body.extend_days, 1, 3650, "Extension days") * DAY
          : body.expires_at === null ? null : integer(body.expires_at, 1, now + 3650 * DAY, "Expiration timestamp");
        if (!auth.isOwner && (expiry === null || expiry > now + auth.profile.max_duration_days * DAY))
          throw policyError("The resulting time remaining exceeds your owner-assigned limit. Repeated extensions cannot bypass it.");
      }
      if (status === "expired" || (expiry !== null && expiry <= now)) {
        demandPermission(auth, "can_delete_users");
        if ((new URL(request.url)).searchParams.get("confirm_expire") !== "yes") throw policyError("This expires and permanently deletes the account. Confirm expiration first.", 400);
        await deleteAccountData(env, user.id, "account_expired");
        return json({ success: true, message: "Expired account and personal data permanently deleted." });
      }
      await env.DB.batch([
        stmt(env, "UPDATE users SET status=?1,max_sessions=?2,expires_at=?3 WHERE id=?4 AND role='user'", [status, sessions, expiry, user.id]),
        stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1 AND (?2!='active' OR id IN (SELECT id FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?3 ORDER BY created_at,id LIMIT MAX(0,(SELECT COUNT(*) FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?3)-?4)))", [user.id, status, now, sessions]),
      ]);
      await audit(env, user.id, auth.user.id, "user_updated", JSON.stringify({ status, max_sessions: sessions, expires_at: expiry }));
      return json({ success: true, message: "User updated." });
    }
  }
  const inviteMatch = path.match(/^\/admin\/invites\/([^/]+)(?:\/(revoke))?$/);
  if (inviteMatch) {
    const invitation = await targetInvite(env, auth, inviteMatch[1]);
    if (inviteMatch[2] === "revoke" && method === "POST") {
      demandPermission(auth, "can_revoke_invites");
      if (invitation.status === "used") throw policyError("A used invitation cannot be revoked.", 409);
      const result = await stmt(env, "UPDATE invites SET status='disabled' WHERE id=?1 AND status!='used'", [invitation.id]).run();
      if (!changes(result)) throw policyError("Invitation state changed. Refresh the list.", 409);
      await audit(env, null, auth.user.id, "invite_revoked", null);
      return json({ success: true, message: "Invitation revoked." });
    }
    if (!inviteMatch[2] && method === "DELETE") {
      demandPermission(auth, "can_delete_invites");
      await stmt(env, "DELETE FROM invites WHERE id=?1", [invitation.id]).run();
      await audit(env, null, auth.user.id, "invite_deleted", null);
      return json({ success: true, message: "Invitation history deleted. Existing accounts and creator attribution are unchanged." });
    }
  }

  if (path === "/admin/dashboard" && method === "GET") {
    const values = [now], where = ["u.role='user'", scope(auth, "a.admin_user_id", values)];
    const counts = await first(env, `SELECT COUNT(*) AS total_users,COALESCE(SUM(u.status='active'),0) AS active_users,COALESCE(SUM(u.status='disabled'),0) AS disabled_users,
      COALESCE(SUM(u.expires_at IS NOT NULL AND u.expires_at>?1 AND u.expires_at<=?1+14*86400),0) AS expiring_soon,
      COALESCE(SUM((SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.revoked=0 AND s.expires_at>?1)),0) AS active_sessions
      FROM users u LEFT JOIN admin_user_attribution a ON a.user_id=u.id WHERE ${where.join(" AND ")}`, values);
    const inviteValues = [now], inviteScope = scope(auth, "i.created_by_user_id", inviteValues);
    const pending = await first(env, `SELECT COUNT(*) AS count FROM invites i WHERE i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?1) AND ${inviteScope}`, inviteValues);
    const statsValues = [], statsScope = scope(auth, "admin_user_id", statsValues);
    const totals = await first(env, `SELECT COALESCE(SUM(accounts_expired),0) AS expired_users,COALESCE(SUM(accounts_canceled),0) AS canceled_users,COALESCE(SUM(accounts_deleted),0) AS deleted_users FROM admin_account_stats WHERE ${statsScope}`, statsValues);
    return json({ success: true, dashboard: { ...counts, ...totals, unused_invites: Number(pending.count) } });
  }
  if (path === "/admin/activity" && method === "GET") {
    demandPermission(auth, "can_view_audit");
    const options = listingOptions(url, { newest: "l.created_at DESC,l.id", oldest: "l.created_at,l.id" }), values = [], where = [];
    if (!auth.isOwner) { values.push(auth.user.id); where.push("l.admin_user_id=?1"); } else where.push("1=1");
    const result = await paged(env, options, "FROM audit_log l LEFT JOIN users actor ON actor.id=l.admin_user_id LEFT JOIN users target ON target.id=l.user_id", where, values, "l.id,l.action,l.created_at,actor.username AS admin_name,target.username AS account_name");
    return json({ success: true, activity: result.data, pagination: result.pagination });
  }

  if (path === "/admin/admins" && method === "GET") {
    if (!auth.isOwner) throw policyError("Only the owner can view and manage the administrator directory.");
    const options = listingOptions(url, ADMIN_SORTS), values = [now], where = ["?1>=0", "u.role='admin'"];
    searchWhere(options, where, values, ["u.username", "u.email"]);
    const status = url.searchParams.get("status") || "all";
    if (["enabled", "disabled"].includes(status)) { values.push(status === "enabled" ? 1 : 0); where.push(`p.enabled=?${values.length}`); }
    else if (status !== "all") throw policyError("Invalid administrator filter.", 400);
    const result = await paged(env, options, "FROM users u JOIN admin_profiles p ON p.user_id=u.id JOIN admin_account_stats st ON st.admin_user_id=u.id LEFT JOIN admin_owner o ON o.user_id=u.id", where, values,
      `u.id,u.username,u.email,u.status,u.created_at,u.last_login_at,u.expires_at,u.max_sessions AS viewer_max_sessions,p.*,st.accounts_created,st.accounts_expired,st.accounts_canceled,st.accounts_deleted,st.invites_created,st.tracking_started_at,CASE WHEN o.user_id=u.id THEN 1 ELSE 0 END AS is_owner,
      (SELECT COUNT(*) FROM admin_user_attribution a JOIN users v ON v.id=a.user_id WHERE a.admin_user_id=u.id AND a.origin='admin_invite' AND v.status='active' AND (v.expires_at IS NULL OR v.expires_at>?1)) AS active_accounts,
      (SELECT COUNT(*) FROM admin_user_attribution a JOIN users v ON v.id=a.user_id WHERE a.admin_user_id=u.id AND a.origin='admin_invite' AND v.status='disabled') AS disabled_accounts,
      (SELECT COUNT(*) FROM admin_user_attribution a WHERE a.admin_user_id=u.id AND a.origin='referral') AS referred_accounts,
      (SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=u.id AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?1)) AS pending_invites`);
    return json({ success: true, admins: result.data.map(row => ({ ...row, permissions: permissionProfile(row) })), pagination: result.pagination });
  }
  if (path === "/admin/admins" && method === "POST") {
    const body = await safeJson(request);
    await ownerRecheck(auth, body, verifyPassword);
    allowedBody(body, ["username", "email", "password", "owner_password", "permissions", "existing_username", "viewing_days"]);
    if (body.existing_username !== undefined) {
      if (["username","email","password","viewing_days"].some(key => Object.hasOwn(body,key)))
        throw policyError("Choose an existing account or a new account, not both.",400);
      const existing=await first(env,"SELECT * FROM users WHERE username=?1 COLLATE NOCASE",[String(body.existing_username).trim()]);
      if (!existing) throw policyError("Existing user not found. Enter their current CharmIPTV username.",404);
      if (existing.role !== "user") throw policyError("This account already has an administrator identity. Use its Permissions or Viewing access button.",409);
      const profile=normalizeAdminProfile(body.permissions || {});
      await env.DB.batch([
        stmt(env,"UPDATE users SET role='admin' WHERE id=?1 AND role='user'",[existing.id]),
        stmt(env,"INSERT INTO admin_profiles(user_id,viewer_access,"+PROFILE_KEYS.join(",")+") VALUES(?1,1,"+PROFILE_KEYS.map((_,i)=>"?"+(i+2)).join(",")+")",[existing.id,...PROFILE_KEYS.map(key=>profile[key])]),
        stmt(env,"INSERT INTO admin_account_stats(admin_user_id) VALUES(?1)",[existing.id]),
        stmt(env,"UPDATE sessions SET revoked=1 WHERE user_id=?1",[existing.id]),
      ]);
      await audit(env,null,auth.user.id,"existing_user_granted_admin",JSON.stringify({admin_id:existing.id}));
      return json({success:true,message:"Admin access added. Use the same username and password in the app and panel. Viewing time is unchanged; please sign in again.",admin:{id:existing.id,username:existing.username}},201);
    }
    const username = String(body.username || "").trim().toLowerCase(), email = String(body.email || "").trim().toLowerCase(), password = String(body.password || "");
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256)
      throw policyError("Enter a valid username/email and an administrator password of 12–256 characters.", 400);
    const profile = normalizeAdminProfile(body.permissions || {}), id = crypto.randomUUID();
    if (await first(env,"SELECT id FROM users WHERE username=?1 OR email=?2",[username,email]))
      throw policyError("That username or email already belongs to an account. Choose Use existing user to add admin access to it.",409);
    const viewingDays=body.viewing_days === undefined ? undefined : body.viewing_days === null ? null : integer(body.viewing_days,1,3650,"Viewing days");
    await env.DB.batch([
      stmt(env, "INSERT INTO users(id,username,email,password_hash,role,status,max_sessions,created_at,activated_at) VALUES(?1,?2,?3,?4,'admin',?5,2,?6,?6)", [id, username, email, await hashPassword(password), "active", now]),
      stmt(env, `INSERT INTO admin_profiles(user_id,${PROFILE_KEYS.join(",")}) VALUES(?1,${PROFILE_KEYS.map((_, i) => `?${i + 2}`).join(",")})`, [id, ...PROFILE_KEYS.map(key => profile[key])]),
      stmt(env, "INSERT INTO admin_account_stats(admin_user_id) VALUES(?1)", [id]),
      ...(viewingDays === undefined ? [] : [
        stmt(env,"UPDATE admin_profiles SET viewer_access=1 WHERE user_id=?1",[id]),
        stmt(env,"UPDATE users SET expires_at=?2 WHERE id=?1",[id,viewingDays===null?null:now+viewingDays*DAY]),
      ]),
    ]);
    await audit(env, null, auth.user.id, "admin_created", JSON.stringify({ admin_id: id }));
    return json({ success: true, message: "Administrator created with only the selected permissions.", admin: { id, username } }, 201);
  }
  const adminMatch = path.match(/^\/admin\/admins\/([^/]+)(?:\/(password|viewing))?$/);
  if (adminMatch && (method === "PATCH" || method === "POST")) {
    const body = await safeJson(request);
    await ownerRecheck(auth, body, verifyPassword);
    if (adminMatch[1] === auth.user.id) throw policyError("The owner account cannot be disabled or changed through delegated-admin controls.");
    const existing = await first(env, "SELECT p.* FROM admin_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=?1 AND u.role='admin'", [adminMatch[1]]);
    if (!existing) throw policyError("Administrator not found.", 404);
    if (adminMatch[2] === "viewing" && method === "PATCH") {
      allowedBody(body,["owner_password","viewer_access","expires_at","max_sessions"]);
      const enabled=integer(body.viewer_access,0,1,"Viewing access");
      const expiry=body.expires_at===null?null:integer(body.expires_at,1,now+3650*DAY,"Viewing expiration");
      const sessions=integer(body.max_sessions,1,20,"Viewing sessions");
      await env.DB.batch([
        stmt(env,"UPDATE admin_profiles SET viewer_access=?2,revision=revision+1,updated_at=?3 WHERE user_id=?1",[existing.user_id,enabled,now]),
        stmt(env,"UPDATE users SET expires_at=?2,max_sessions=?3,status='active' WHERE id=?1",[existing.user_id,expiry,sessions]),
        stmt(env,"UPDATE sessions SET revoked=1 WHERE user_id=?1",[existing.user_id]),
      ]);
      await audit(env,null,auth.user.id,"admin_viewing_updated",JSON.stringify({admin_id:existing.user_id}));
      return json({success:true,message:"Viewing access updated. Panel permissions are unchanged. Sign in again using the same login."});
    } else if (adminMatch[2] === "password" && method === "POST") {
      allowedBody(body, ["owner_password", "new_password"]);
      const password = String(body.new_password || "");
      if (password.length < 12 || password.length > 256) throw policyError("Administrator passwords require 12–256 characters.", 400);
      await env.DB.batch([stmt(env, "UPDATE users SET password_hash=?1 WHERE id=?2", [await hashPassword(password), existing.user_id]), stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [existing.user_id])]);
      await audit(env, null, auth.user.id, "admin_password_reset", JSON.stringify({ admin_id: existing.user_id }));
    } else if (!adminMatch[2] && method === "PATCH") {
      allowedBody(body, ["owner_password", "permissions"]);
      const profile = normalizeAdminProfile(body.permissions || {}, existing);
      await env.DB.batch([
        stmt(env, `UPDATE admin_profiles SET ${PROFILE_KEYS.map((key, i) => `${key}=?${i + 1}`).join(",")},revision=revision+1,updated_at=?${PROFILE_KEYS.length + 1} WHERE user_id=?${PROFILE_KEYS.length + 2}`, [...PROFILE_KEYS.map(key => profile[key]), now, existing.user_id]),
        stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [existing.user_id]),
      ]);
      await audit(env, null, auth.user.id, "admin_permissions_updated", JSON.stringify({ admin_id: existing.user_id, permissions: profile }));
    } else throw policyError("Method not allowed.", 405);
    return json({ success: true, message: "Administrator updated. Existing admin sessions were revoked; viewer accounts were not changed." });
  }
  return json({ success: false, error: "Admin route not found." }, 404);
}
