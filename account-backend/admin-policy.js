export const DAY = 86400;
export const ADMIN_FLAGS = [
  "can_create_invites", "can_manage_all", "can_change_time", "can_change_sessions",
  "can_suspend", "can_delete_users", "can_reset_password", "can_force_logout",
  "can_revoke_invites", "can_delete_invites", "can_view_audit",
];
export const ADMIN_LIMITS = {
  max_duration_days: [1, 3650, 90], max_sessions: [1, 20, 2],
  max_accounts_total: [0, 1000000, 0], max_open_accounts: [0, 1000000, 0],
  max_pending_invites: [0, 1000, 0], max_invite_valid_days: [1, 365, 7],
};

export function policyError(message, status = 403) {
  return Object.assign(new Error(message), { status });
}
export function integer(value, min, max, label) {
  if (value === null || typeof value === "boolean" || value === "" ||
      !["number", "string"].includes(typeof value)) throw policyError(`${label} must be a whole number.`, 400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw policyError(`${label} must be between ${min} and ${max}.`, 400);
  return parsed;
}
export function normalizeAdminProfile(input, previous = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw policyError("Permissions must be an object.", 400);
  const allowed = new Set([...ADMIN_FLAGS, ...Object.keys(ADMIN_LIMITS), "enabled"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw policyError(`Unknown permission: ${key}`, 400);
  const result = {};
  for (const key of [...ADMIN_FLAGS, "enabled"]) {
    const value = Object.hasOwn(input, key) ? input[key] : previous[key] ?? (key === "enabled" ? 1 : 0);
    if (![true, false, 0, 1].includes(value)) throw policyError(`${key} must be on or off.`, 400);
    result[key] = value ? 1 : 0;
  }
  for (const [key, [min, max, fallback]] of Object.entries(ADMIN_LIMITS))
    result[key] = integer(Object.hasOwn(input, key) ? input[key] : previous[key] ?? fallback, min, max, key);
  return result;
}
export function demandPermission(auth, permission) {
  if (!auth.isOwner && auth.profile?.[permission] !== 1) throw policyError("Your owner has not granted this permission.");
}
export function invitationTerms(body, auth) {
  demandPermission(auth, "can_create_invites");
  const duration = body.account_duration_days === null ? null : integer(body.account_duration_days ?? 30, 1, 3650, "Account days");
  const sessions = integer(body.max_sessions ?? 1, 1, 20, "Simultaneous sessions");
  const validDays = body.invite_expires_days === null ? null : integer(body.invite_expires_days ?? 7, 1, 365, "Code validity days");
  if (!auth.isOwner) {
    if (duration === null) throw policyError("Only the owner can grant unlimited accounts.");
    if (duration > auth.profile.max_duration_days) throw policyError("Account duration exceeds your owner-assigned limit.");
    if (sessions > auth.profile.max_sessions) throw policyError("Session allowance exceeds your owner-assigned limit.");
    if (validDays === null || validDays > auth.profile.max_invite_valid_days)
      throw policyError("Code validity exceeds your owner-assigned limit.");
  }
  return { duration, sessions, validDays };
}
export function referralAccess(invitation, inviter, now) {
  // Never turn a user referral into fresh plan days or propagate unlimited access.
  if (!inviter || (inviter.role === "admin" && !inviter.viewer_access) || inviter.status !== "active") throw policyError("The inviting account is not available.", 410);
  const current = inviter.expires_at == null ? null : Number(inviter.expires_at);
  const grant = invitation.grant_expires_at == null ? null : Number(invitation.grant_expires_at);
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(grant) || current <= now || grant <= now)
    throw policyError("This invitation requires valid, timed access from the inviting account.", 410);
  return { expiresAt: Math.min(current, grant), maxSessions: Math.max(1, Math.min(Number(inviter.max_sessions), Number(invitation.max_sessions))) };
}
export function listingOptions(url, sorts) {
  const page = integer(url.searchParams.get("page") ?? 1, 1, 1000000, "Page");
  const pageSize = integer(url.searchParams.get("page_size") ?? 25, 1, 100, "Page size");
  const sort = url.searchParams.get("sort") || "newest";
  if (!Object.hasOwn(sorts, sort)) throw policyError("Invalid sort order.", 400);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
  return { page, pageSize, offset: (page - 1) * pageSize, orderBy: sorts[sort], search, pattern: `%${search.replace(/[\\%_]/g, "\\$&")}%` };
}
