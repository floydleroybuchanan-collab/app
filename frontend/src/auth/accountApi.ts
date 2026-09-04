export const ACCOUNT_API_BASE_URL = "https://charmiptv-account-api.agentleakage.workers.dev";

const ACCOUNT_REQUEST_TIMEOUT_MS = 15_000;

export type AccountUser = {
  id: string;
  username: string;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  expires_at?: number | string | null;
  max_sessions?: number | null;
  active_sessions?: number | null;
};

export type ReferralInvitation = {
  id: string;
  invite_code: string;
  status: "unused" | "used" | "expired" | "disabled";
  created_at: number;
  expires_at: number;
  redeemed_at?: number | null;
};

export type ReferralSummary = {
  limit: number;
  available: number;
  used: number;
  active: number;
  cycle_started_at: number;
  renews_at: number;
  invitations: ReferralInvitation[];
};

type AccountEnvelope = {
  success?: boolean;
  error?: string;
  token?: string;
  user?: AccountUser;
  referral?: ReferralSummary;
  invitation?: ReferralInvitation;
};

export type AccountApiResult = {
  response: Response | null;
  data: AccountEnvelope;
};

async function accountRequest(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<AccountApiResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ACCOUNT_REQUEST_TIMEOUT_MS);
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body != null) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    const response = await fetch(`${ACCOUNT_API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    let data: AccountEnvelope;
    try {
      data = await response.json() as AccountEnvelope;
    } catch {
      data = { success: false, error: "The account service returned an invalid response." };
    }
    return { response, data };
  } catch {
    const timedOut = controller.signal.aborted;
    return {
      response: null,
      data: {
        success: false,
        error: timedOut
          ? "The account service took too long to respond."
          : "Unable to reach the CharmIPTV account service.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function loginToAccount(login: string, password: string): Promise<AccountApiResult> {
  // Session limits and oldest-session revocation are enforced by the backend.
  // The app intentionally sends no device name, identifier, or location data.
  return accountRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ login, password }),
  });
}

export function registerAccountWithInvite(
  inviteCode: string,
  username: string,
  email: string,
  password: string,
): Promise<AccountApiResult> {
  return accountRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      invite_code: inviteCode.trim().toUpperCase(),
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password,
    }),
  });
}

export function getCurrentAccount(token: string): Promise<AccountApiResult> {
  return accountRequest("/me", { method: "GET" }, token);
}

export function logoutAccount(token: string): Promise<AccountApiResult> {
  return accountRequest("/auth/logout", { method: "POST" }, token);
}

export function getReferralSummary(token: string): Promise<AccountApiResult> {
  return accountRequest("/referrals", { method: "GET" }, token);
}

export function generateReferralInvite(token: string): Promise<AccountApiResult> {
  return accountRequest("/referrals/invites", { method: "POST" }, token);
}
