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
    "./multiEpgSources": { getMultiEpgSources: async () => sources, saveMultiEpgSource() {} },
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
  const context = vm.createContext({ URL, Request, Response, Headers });
  const worker = readFileSync(new URL("../../account-backend/worker.js", import.meta.url), "utf8");
  vm.runInContext(worker.replace("export default {", "globalThis.worker = {"), context);
  const env = { M3U_URL: "http://one.invalid/list", EPG_URL: "http://one.invalid/guide",
    M3U_URL_2: "https://two.invalid/list", EPG_URL_2: "http://two.invalid/guide" };
  assert.equal(context.managedSourceConfiguration(env).ready, true);
  assert.equal(context.managedSourceConfiguration({ ...env, M3U_URL_2: "" }).ready, false);
  context.requireUser = async () => ({ ok: false, response: new Response("Unauthorized", { status: 401 }) });
  const request = new Request("https://account.invalid/content/access");
  assert.equal((await context.createContentAccess(request, env)).status, 401);
  context.requireUser = async () => ({ ok: true, session: { expires_at: 2_000_000_000 } });
  const response = await context.createContentAccess(request, env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.content.sources.length, 2);
  assert.equal(payload.content.secondary.playlist_url, env.M3U_URL_2);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  context.purgeExpiredAccounts = async () => {};
  const health = await context.worker.fetch(new Request("https://account.invalid/health"), { ...env, DB: {} });
  const body = await health.text();
  assert.equal(JSON.parse(body).content_sources.secondary, true);
  assert.doesNotMatch(body, /one.invalid|two.invalid/);
});
