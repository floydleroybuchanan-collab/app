import { handleAdminRequest, resolveAdminAccess } from "./admin-service.js";
import { registerInvitedAccount } from "./registration-service.js";
import { buildReferralSummary, createReferralInvitation, deleteReferralHistory, releaseReferralForAccount } from "./referral-service.js";
const DAY = 86400;
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 60000;
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
          admin_controls_version: 1,
          content_sources_ready: sources.ready,
          configured_source_count: sources.configured.length,
          content_sources: Object.fromEntries(sources.slots.map((source) => [source.id, source.state === "configured"])),
        });
      }
      if (path === "/setup-admin" && request.method === "POST") return await setupAdmin(request, env);
      if (path === "/auth/register" && request.method === "POST") return await registerWithInvite(request, env);
      if (path === "/auth/login" && request.method === "POST") return await login(request, env);
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
      if (path === "/content/access" && request.method === "GET") return await createContentAccess(request, env);
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

      if (path.startsWith("/admin/")) return await handleAdminRequest(request, env, {
        requireUser, json, safeJson, publicUser, hashPassword, verifyPassword, audit, deleteAccountData,
      });

      return json({ success: false, error: "Route not found." }, 404);
    } catch (error) {
      const status = Number(error?.status || 500);
      if (status >= 500) console.error("Account request failed", error?.name || "Error");
      return json({ success: false, error: status >= 500 ? "The account service could not complete this request." : error.message }, status);
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
  return registerInvitedAccount(request, env, { json, safeJson, hashPassword, issueSession, publicUser, audit });
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

async function deleteAccountData(env, userId, reason) {
  const user = await env.DB.prepare("SELECT id,role FROM users WHERE id = ?1 LIMIT 1").bind(userId).first();
  if (!user) return false;
  if (user.role !== "user") throw statusError("Administrator accounts cannot be deleted through viewer-account controls.", 403);
  const now = unixNow();
  await releaseReferralForAccount(env, userId, reason, now);
  await env.DB.batch([
    env.DB.prepare("UPDATE admin_user_attribution SET end_reason=?2 WHERE user_id=?1").bind(userId, reason),
    env.DB.prepare("UPDATE invites SET redeemed_by_user_id=NULL WHERE redeemed_by_user_id=?1").bind(userId),
    env.DB.prepare("UPDATE invites SET created_by_user_id=NULL WHERE created_by_user_id=?1").bind(userId),
    env.DB.prepare("DELETE FROM audit_log WHERE user_id=?1 OR admin_user_id=?1").bind(userId),
    env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id=?1").bind(userId),
    env.DB.prepare("DELETE FROM user_preferences WHERE user_id=?1").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id=?1").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id=?1 AND role='user'").bind(userId),
  ]);
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

async function createContentAccess(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth.response;
  if (auth.user.role === "admin" && !(await resolveAdminAccess(env, auth.user)).isOwner)
    return json({ success: false, error: "Administrator logins are for the panel. Use a separate timed viewer account in the app." }, 403);
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
async function safeJson(request) {
  let body;
  try { body = await request.json(); } catch { throw statusError("A valid JSON object is required.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw statusError("A JSON object is required.", 400);
  return body;
}
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
