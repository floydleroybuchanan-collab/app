import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACCOUNT_API_BASE_URL,
  generateReferralInvite,
  getCurrentAccount,
  getManagedContentAccess,
  getReferralSummary,
  loginToAccount,
  registerAccountWithInvite,
} from "../src/auth/accountApi.ts";
import {
  clearManagedContentAccess,
  configureManagedContentAccess,
  managedEpgUrl,
  managedPlaylistUrl,
} from "../src/auth/managedContentAccess.ts";

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
    await getManagedContentAccess("session-token");
    await registerAccountWithInvite("charm-abcd-1234", "friend", "FRIEND@example.com", "password8");
    await getReferralSummary("session-token");
    await generateReferralInvite("session-token");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(ACCOUNT_API_BASE_URL, "https://charmiptv-account-api.agentleakage.workers.dev");
  assert.equal(calls[0].url, `${ACCOUNT_API_BASE_URL}/auth/login`);
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), { login: "viewer", password: "secret" });
  assert.deepEqual(Object.keys(JSON.parse(String(calls[0].options.body))).sort(), ["login", "password"]);
  assert.equal(calls[1].url, `${ACCOUNT_API_BASE_URL}/me`);
  assert.equal(new Headers(calls[1].options.headers).get("Authorization"), "Bearer session-token");
  assert.equal(calls[2].url, `${ACCOUNT_API_BASE_URL}/content/access`);
  assert.equal(new Headers(calls[2].options.headers).get("Authorization"), "Bearer session-token");
  assert.equal(calls[3].url, `${ACCOUNT_API_BASE_URL}/auth/register`);
  assert.deepEqual(JSON.parse(String(calls[3].options.body)), {
    invite_code: "CHARM-ABCD-1234",
    username: "friend",
    email: "friend@example.com",
    password: "password8",
  });
  assert.equal(calls[4].url, `${ACCOUNT_API_BASE_URL}/referrals`);
  assert.equal(calls[5].url, `${ACCOUNT_API_BASE_URL}/referrals/invites`);
  assert.equal(new Headers(calls[5].options.headers).get("Authorization"), "Bearer session-token");
});

test("managed content handoff requires both complete playlist/EPG pairs and applies them atomically", () => {
  clearManagedContentAccess();
  const complete = {
    expires_at: 2_000_000_000,
    primary: {
      playlist_url: "http://primary.invalid/get.php?username=viewer&password=secret",
      epg_url: "http://primary.invalid/xmltv.php?username=viewer&password=secret",
    },
    secondary: {
      playlist_url: "https://secondary.invalid/list.m3u?token=two",
      epg_url: "http://secondary.invalid/guide.xml.gz?token=two",
    },
  };

  assert.equal(configureManagedContentAccess(complete), true);
  assert.equal(managedPlaylistUrl("primary"), complete.primary.playlist_url);
  assert.equal(managedEpgUrl("primary"), complete.primary.epg_url);
  assert.equal(managedPlaylistUrl("secondary"), complete.secondary.playlist_url);
  assert.equal(managedEpgUrl("secondary"), complete.secondary.epg_url);

  assert.equal(configureManagedContentAccess({
    ...complete,
    secondary: { ...complete.secondary, playlist_url: "" },
  }), false);
  assert.equal(managedPlaylistUrl("secondary"), complete.secondary.playlist_url);
  assert.equal(managedEpgUrl("secondary"), complete.secondary.epg_url);

  assert.equal(configureManagedContentAccess({
    ...complete,
    secondary: { ...complete.secondary, epg_url: "file:///private/guide.xml" },
  }), false);
  assert.equal(managedEpgUrl("secondary"), complete.secondary.epg_url);
  clearManagedContentAccess();
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
  assert.match(auth + gate, /registerAccountWithInvite|Register With Invitation/);
  assert.match(gate, /There is no open public registration/);
  assert.match(gate, /testID="account-invite-code"/);
  assert.match(gate, /testID="account-username"/);
  assert.match(gate, /testID="account-password"/);
  assert.match(gate, /if \(mode === "login"\) void submit\(\)/);
  assert.match(settings, /label="Sign Out"/);
  assert.match(settings, /Family & Friend Invites/);
  assert.match(settings, /expires after three days if unused/);
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
  assert.match(shell, /showIconRail \? \(/);
  assert.match(shell, /!drawerOpen && \(active !== "\/guide" \|\| Boolean\(secondaryDrawer\)\)/);
  assert.match(guide, /secondaryDrawer=\{groupDrawerOpen \?/);
  assert.doesNotMatch(guide, /Open playlists & groups/);
  assert.match(drawer, /GUIDE_GROUP_DRAWER_WIDTH = 232/);
  assert.doesNotMatch(drawer, /Playlists & Groups|Left: main menu/);
  assert.match(drawer, /item\.expanded \? "chevron-up" : "chevron-down"/);
  assert.match(drawer, /groupRow: \{ paddingLeft: 28 \}/);
  assert.match(home, /setRemoteContext\("drawer_edge"\)/);
  assert.match(home, /focusIconRail\(\)/);
  assert.match(activity, /context == "drawer_edge" && boundaryKey == "LEFT"/);
  assert.match(activity, /context == "icon_rail" && \(boundaryKey == "LEFT" \|\| boundaryKey == "BACK"\)/);
  assert.match(activity, /enterImmersiveMode\(\)/);
});

test("rail focus returns to content and no-information Guide cells remain playable", async () => {
  const [shell, live, canvas, guide, activity] = await Promise.all([
    source("src/components/PurpleTvShell.tsx"),
    source("app/(tabs)/index.tsx"),
    source("src/components/NativeGuideCanvas.tsx"),
    source("app/(tabs)/guide.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);
  assert.match(shell, /nextFocusRight=\{contentReturnTag\}/);
  assert.doesNotMatch(shell, /getIconRailReturnTarget/);
  assert.match(live, /focusIconRail\(\)/);
  assert.match(activity, /onRail && key == android.view.KeyEvent.KEYCODE_DPAD_RIGHT/);
  assert.match(activity, /visible\(next\).*within\(next, page\).*requestFocus\(\)/);
  assert.match(activity, /emitRemoteEvent\("CharmIconRailOpenMain", root.id.toString\(\)\)/);
  assert.match(shell, /Number\(tag\) !== findNodeHandle\(shellRef.current\)/);
  assert.match(canvas, /else if \(value\.surface !== "channel"\) onChannelPress\(channel\)/);
  assert.match(guide, /onChannelPress=\{play\}/);
});
