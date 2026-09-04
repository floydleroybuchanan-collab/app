import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACCOUNT_API_BASE_URL,
  getCurrentAccount,
  loginToAccount,
} from "../src/auth/accountApi.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("account API login and restore use the deployed Cloudflare contract without device data", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      success: true,
      token: "session-token",
      user: { id: "u1", username: "viewer" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await loginToAccount("viewer", "secret");
    await getCurrentAccount("session-token");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(ACCOUNT_API_BASE_URL, "https://charmiptv-account-api.agentleakage.workers.dev");
  assert.equal(calls[0].url, `${ACCOUNT_API_BASE_URL}/auth/login`);
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), { login: "viewer", password: "secret" });
  assert.deepEqual(Object.keys(JSON.parse(String(calls[0].options.body))).sort(), ["login", "password"]);
  assert.equal(calls[1].url, `${ACCOUNT_API_BASE_URL}/me`);
  assert.equal(new Headers(calls[1].options.headers).get("Authorization"), "Bearer session-token");
});

test("secure session restore gates all playlist, guide, and player providers", async () => {
  const [auth, layout, gate, settings] = await Promise.all([
    source("src/auth/AuthContext.tsx"),
    source("app/_layout.tsx"),
    source("src/components/AccountGate.tsx"),
    source("app/(tabs)/settings.tsx"),
  ]);
  assert.match(auth, /secureGet<string \| null>\(ACCOUNT_SESSION_TOKEN_KEY, null\)/);
  assert.match(auth, /secureSet\(ACCOUNT_SESSION_TOKEN_KEY, result\.data\.token\)/);
  assert.match(auth, /secureRemove\(ACCOUNT_SESSION_TOKEN_KEY\)/);
  assert.match(auth, /result\.response\?\.status === 401/);
  assert.match(auth, /AppState\.addEventListener/);
  assert.match(auth, /SESSION_RECHECK_MS/);
  assert.ok(layout.indexOf("<AccountGate>") < layout.indexOf("<GuideProvider>"));
  assert.doesNotMatch(auth + gate, /\/auth\/register|Create Account|Register/);
  assert.match(gate, /testID="account-username"/);
  assert.match(gate, /testID="account-password"/);
  assert.match(settings, /label="Sign Out"/);
});

test("RC.6 drawer layout pushes content beside a main icon rail and playlist list", async () => {
  const [shell, drawer, guide, home, activity] = await Promise.all([
    source("src/components/PurpleTvShell.tsx"),
    source("src/components/PurpleGuideGroupDrawer.tsx"),
    source("app/(tabs)/guide.tsx"),
    source("app/(tabs)/index.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);
  assert.match(shell, /PURPLE_SIDEBAR_WIDTH = 192/);
  assert.match(shell, /PURPLE_ICON_RAIL_WIDTH = 52/);
  assert.match(shell, /!drawerOpen && secondaryDrawer \? secondaryDrawer : null/);
  assert.match(guide, /secondaryDrawer=\{groupDrawerOpen \?/);
  assert.match(drawer, /GUIDE_GROUP_DRAWER_WIDTH = 232/);
  assert.doesNotMatch(drawer, /Playlists & Groups|Left: main menu/);
  assert.match(drawer, /item\.expanded \? "chevron-up" : "chevron-down"/);
  assert.match(drawer, /groupRow: \{ paddingLeft: 28 \}/);
  assert.match(home, /setRemoteContext\("drawer_edge"\)/);
  assert.match(home, /key === "LEFT" && leftEdgeFocusRef\.current/);
  assert.match(activity, /context == "drawer_edge" && boundaryKey == "LEFT"/);
  assert.match(activity, /enterImmersiveMode\(\)/);
});
