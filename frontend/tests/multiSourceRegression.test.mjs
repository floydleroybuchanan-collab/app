import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as access from "../src/auth/managedContentAccess.ts";
import * as catalog from "../src/core/playlistCatalog.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(mocks[name], name); return mocks[name]; }, ...globals });
  return exports;
}

test("managed configuration can arrive after personal-only startup and never leaks a previous session on clear", () => {
  access.clearManagedContentAccess();
  assert.equal(access.configureManagedContentAccess({ expires_at: 100, sources: [] }), true);
  assert.equal(access.managedContentSources().length, 0);
  const sources = ["primary", "secondary"].map(id => ({ id, playlist_url: `http://${id}.invalid/list`, epg_url: `https://${id}.invalid/guide` }));
  assert.equal(access.configureManagedContentAccess({ expires_at: 100, sources }), true);
  assert.equal(access.managedContentSources().length, 2);
  assert.equal(access.configureManagedContentAccess({ expires_at: 100, sources: [{ ...sources[1], epg_url: "" }] }), false);
  assert.equal(access.managedContentSources().length, 2);
  access.clearManagedContentAccess();
  assert.equal(access.managedPlaylistUrl("secondary"), "");
});

test("combined catalogs do not silently drop the second playlist after a global 25k threshold", () => {
  const sources = [{ id: "one", enabled: true }, { id: "two", enabled: true }];
  const rows = new Map(sources.map(source => [source.id, Array.from({ length: 13_000 }, (_, n) => ({ id: `${source.id}-${n}` }))]));
  assert.equal(catalog.combinePlaylistCatalogs(sources, rows).length, 26_000);
});

test("refreshing a shared EPG from one playlist keeps candidate IDs for all associated playlists", async () => {
  const fetched = [], configurations = [], replacements = [];
  const sources = [{ id: "shared", url: "http://feed.invalid/guide", enabled: true, refreshHours: 12 }];
  const playlists = [{ id: "one", enabled: true, epgSourceIds: ["shared"] }, { id: "two", enabled: true, epgSourceIds: ["shared"] }];
  const api = load("src/core/playlistEpg.ts", {
    "./playlistEpgDiscovery": { discoverPlaylistEpg: async () => {} },
    "./additionalEpgOwnership": { replaceAutomaticEpgOwners() {} },
    "./playlistRegistry": { listPlaylists: async () => playlists },
    "./playlistCatalog": catalog,
    "./multiEpgSources": { getMultiEpgSources: async () => sources, updateMultiEpgRefreshStatus() {} },
    "./epgSourcePreferences": { getEpgSourcePreferences: async () => ({ primaryEnabled: true, userEnabled: false, userUrl: "" }) },
    "@/src/auth/managedContentAccess": { managedEpgUrl: () => "" },
    "@/src/nativeEpg": {
      configureNativeUserGuideSources: async enabled => configurations.push(enabled),
      replaceAutomaticPlaylistBindings: async rows => replacements.push(rows),
      refreshAssociatedPlaylistGuide: async (id, url, ids) => { fetched.push({ id, url, ids }); return { count: 2 }; },
    },
  });
  await api.syncPlaylistEpg([
    { id: "one-channel", playlist_id: "one", raw_tvg_id: "station", name: "Station" },
    { id: "two-channel", playlist_id: "two", raw_tvg_id: "", name: "Name-only station" },
  ], true, "one");
  assert.deepEqual(configurations, [false]);
  assert.equal(fetched.length, 1);
  assert.deepEqual(Array.from(fetched[0].ids), ["station", "Name-only station"]);
  assert.equal(replacements.length, 2);
});

test("TV Pressables use the installed TV ViewManager command, not TextInputState.focus", () => {
  const commands = [];
  const api = load("src/utils/tvFocus.ts", {
    "react-native": { Platform: { isTV: true }, findNodeHandle: node => node.tag,
      UIManager: { dispatchViewManagerCommand: (...args) => commands.push(args) } },
  });
  assert.equal(api.requestNativeFocus({ tag: 42, focus: () => assert.fail("generic focus must not be called on TV") }), true);
  assert.equal(commands[0][0], 42);
  assert.equal(commands[0][1], "requestTVFocus");
  assert.equal(api.requestNativeFocus(null), false);
});

test("a completed additional guide is published before a later slow source finishes", async () => {
  const events = [];
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const sources = ["first", "slow"].map(id => ({ id, url: `http://${id}.invalid/guide`, enabled: true, refreshHours: 12 }));
  const api = load("src/core/playlistEpg.ts", {
    "./playlistEpgDiscovery": { discoverPlaylistEpg: async () => {} },
    "./additionalEpgOwnership": { replaceAutomaticEpgOwners() {} },
    "./playlistRegistry": { listPlaylists: async () => [{ id: "one", enabled: true, epgSourceIds: ["first", "slow"] }] },
    "./playlistCatalog": catalog,
    "./multiEpgSources": { getMultiEpgSources: async () => sources, updateMultiEpgRefreshStatus() {} },
    "./epgSourcePreferences": { getEpgSourcePreferences: async () => ({ primaryEnabled: false, userEnabled: false, userUrl: "" }) },
    "@/src/auth/managedContentAccess": { managedEpgUrl: () => "" },
    "@/src/nativeEpg": {
      configureNativeUserGuideSources: async () => {},
      replaceAutomaticPlaylistBindings: async () => events.push("bindings"),
      refreshAssociatedPlaylistGuide: async id => { events.push(id); if (id === "slow") await waiting; return { count: 2 }; },
    },
  });
  const pending = api.syncPlaylistEpg([{ id: "station", playlist_id: "one", raw_tvg_id: "station", name: "Station" }], true, undefined, () => events.push("published"));
  for (let i = 0; i < 50; i++) await Promise.resolve();
  assert.deepEqual(events, ["bindings", "first", "bindings", "published", "slow"]);
  release(); await pending;
  assert.deepEqual(events.slice(-2), ["bindings", "published"]);
});

test("late EPG completion preserves new settings and cannot recreate a removed source", async () => {
  const initial = { id: "personal-guide", name: "Original", url: "https://guide.invalid/one", enabled: true,
    refreshHours: 12, lastRefreshAt: 1, lastStatus: "Old", overrides: {} };
  const api = load("src/core/multiEpgSources.ts", {
    react: { useEffect() {}, useState() {}, useCallback() {} },
    "@/src/utils/storage": { storage: { getItem: async () => [initial], setItem: async () => true } },
    "@/src/core/additionalEpgOwnership": { replaceAdditionalEpgOwners() {} },
    "@/src/auth/managedContentAccess": { managedContentSources: () => [], managedEpgUrl: () => "" },
    "@/src/core/playlistCatalog": catalog,
    "@/src/source": { invalidateGuideOwnershipCaches() {} },
  });
  await api.getMultiEpgSources();
  api.saveMultiEpgSource({ ...initial, name: "Edited", enabled: false, refreshHours: 0, overrides: { station: "manual" } });
  api.updateMultiEpgRefreshStatus(initial.id, initial.url, { lastRefreshAt: 2, lastStatus: "Complete" });
  const updated = (await api.getMultiEpgSources())[0];
  assert.equal(updated.enabled, false);
  assert.equal(updated.name, "Edited");
  assert.equal(updated.refreshHours, 0);
  assert.equal(updated.overrides.station, "manual");
  assert.equal(updated.lastRefreshAt, 2);
  api.saveMultiEpgSource({ ...updated, url: "https://guide.invalid/replacement" });
  api.updateMultiEpgRefreshStatus(initial.id, initial.url, { lastRefreshAt: 3, lastStatus: "Stale" });
  assert.equal((await api.getMultiEpgSources())[0].lastRefreshAt, 2);
  api.removeMultiEpgSource(initial.id);
  api.updateMultiEpgRefreshStatus(initial.id, initial.url, { lastRefreshAt: 4, lastStatus: "Stale" });
  assert.equal((await api.getMultiEpgSources()).length, 0);
});

test("route-entry retry waits for confirmed native focus and stops after confirmation", () => {
  const tasks = new Map(); let nextId = 0, confirmed = false, requests = 0;
  const api = load("src/utils/tvFocus.ts", {
    "react-native": { Platform: { isTV: true }, findNodeHandle: () => 42,
      UIManager: { dispatchViewManagerCommand: () => { requests++; } } },
  }, { setTimeout: fn => { tasks.set(++nextId, fn); return nextId; }, clearTimeout: id => tasks.delete(id) });
  api.requestNativeFocusWithRetry({}, [0, 50, 100], () => confirmed);
  tasks.get(1)(); tasks.get(2)();
  assert.equal(requests, 2);
  confirmed = true; tasks.get(3)();
  assert.equal(requests, 2); assert.equal(tasks.size, 0);
});

test("explicit all-disabled projection is supported while failed provider imports remain protected", () => {
  const bridge = read("src/nativeEpg.ts"), native = read("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt");
  const sync = read("android/app/src/main/java/com/charmiptv/app/PlaylistSyncCoordinator.kt");
  const source = read("src/source.native.ts");
  assert.match(native, /allowEmptyProjection = true/);
  assert.match(sync, /allowEmptyProjection: Boolean = false/);
  assert.match(sync, /rows.isEmpty\(\) && !allowEmptyProjection/);
  assert.doesNotMatch(bridge.match(/export async function upsertNativePlaylistChannels[^\n]+/)?.[0] || "", /!channels.length/);
  assert.doesNotMatch(source.match(/async function syncPlaylistToNative[\s\S]*?\n}/)?.[0] || "", /!channels.length/);
  assert.match(source, /if \(MEM\) return MEM/);
});

test("Worker rejects incomplete supplied pairs and releases both only after session authorization", async () => {
  const { fixture } = await import("../../account-backend/test/fixture.mjs");
  const f = fixture();
  f.user("sourceviewer");
  const token = f.token("sourceviewer");
  assert.equal((await f.request("/content/access")).status, 401);
  const response = await f.request("/content/access", { token });
  assert.equal(response.status, 200);
  const payload = response.body;
  assert.equal(payload.content.sources.length, 2);
  assert.equal(payload.content.secondary.playlist_url, f.env.M3U_URL_2);
  const health = await f.request("/health");
  assert.equal(health.body.content_sources.secondary, true);
  assert.doesNotMatch(JSON.stringify(health.body), /provider\.example/);
  f.env.M3U_URL_2 = "";
  assert.equal((await f.request("/health")).body.content_sources_ready, false);
  assert.equal((await f.request("/content/access", { token })).status, 503);
});
