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

type AccountEnvelope = {
  success?: boolean;
  error?: string;
  token?: string;
  user?: AccountUser;
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

export function getCurrentAccount(token: string): Promise<AccountApiResult> {
  return accountRequest("/me", { method: "GET" }, token);
}

export function logoutAccount(token: string): Promise<AccountApiResult> {
  return accountRequest("/auth/logout", { method: "POST" }, token);
}
