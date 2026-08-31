import test from "node:test";
import assert from "node:assert/strict";
import * as catalog from "../src/core/playlistCatalog.ts";
import { createPlaylistPlaybackRefresher } from "../src/core/playlistPlaybackRefresh.ts";
import { remapStoredChannelIds } from "../src/utils/channelIdentityMigrate.ts";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const channel = (id = "station", url = "https://stream.invalid/live?token=old") => ({ id, tvg_id: id, raw_tvg_id: id, name: "Same station", group: "Sports", logo: "", url, stream_type: "ts" });
const primary = { id: catalog.PRIMARY_PLAYLIST, name: "CharmIPTV", managed: true, enabled: true };
const personal = { ...primary, id: "user-one", name: "My list", groupLabel: "My list", managed: false };

test("duplicate TVG IDs and group names from two sources never collide; primary IDs survive", () => {
  const a = catalog.scopePlaylistChannels(primary, [channel()]);
  const b = catalog.scopePlaylistChannels(personal, [channel()]);
  assert.equal(a[0].id, "station"); assert.notEqual(a[0].id, b[0].id);
  assert.notEqual(a[0].group, b[0].group); assert.equal(b[0].tvg_id, "");
  assert.equal(catalog.combinePlaylistCatalogs([primary, personal], new Map([[primary.id, a], [personal.id, b]])).length, 2);
  const renamed = catalog.scopePlaylistChannels({ ...personal, name: "Renamed" }, [channel("station", "https://stream.invalid/live?token=new")]);
  assert.equal(b[0].id, renamed[0].id); assert.equal(b[0].group, renamed[0].group);
});

test("an unavailable source favorite cannot migrate to another provider by matching name", () => {
  const scoped = catalog.scopePlaylistChannels(personal, [channel()])[0];
  const result = remapStoredChannelIds([scoped.id, "same-station"], [channel()]);
  assert.equal(result.ids[0], scoped.id);
  const noCross = remapStoredChannelIds(["station"], [scoped]);
  assert.equal(noCross.ids[0], "station");
});

test("empty, partially invalid and truncated imports are rejected before activation", () => {
  for (const parsed of [{ channels: [], rejected: 0, truncated: false }, { channels: [channel()], rejected: 1, truncated: false }, { channels: [channel()], rejected: 0, truncated: true }]) {
    assert.throws(() => catalog.validatePlaylistImport(parsed));
  }
});

test("recovery shares one request per provider without waiting for an unrelated provider", async () => {
  let finish; const blocked = new Promise(resolve => { finish = resolve; }); const calls = [];
  const other = catalog.scopePlaylistChannels(personal, [channel()])[0];
  const refresh = createPlaylistPlaybackRefresher(async owner => { calls.push(owner); return owner === primary.id ? blocked : [other]; });
  const first = refresh("station"), duplicate = refresh("station");
  assert.equal((await refresh(other.id)).id, other.id);
  finish([channel()]); await Promise.all([first, duplicate]);
  assert.equal(calls.filter(id => id === primary.id).length, 1);
  assert.equal(calls.filter(id => id === personal.id).length, 1);
});

function registryHarness() {
  const files = new Map(), prefs = new Map(), secrets = new Map(); let failCommit = false, fetcher = async () => ({ channels: [channel()], rejected: 0, truncated: false });
  const filesystem = {
    documentDirectory: "private/", makeDirectoryAsync: async () => {},
    readAsStringAsync: async path => { if (!files.has(path)) throw Error("missing"); return files.get(path); },
    writeAsStringAsync: async (path, value) => { files.set(path, value); },
    getInfoAsync: async path => ({ exists: files.has(path), size: files.get(path)?.length || 0 }),
    readDirectoryAsync: async root => [...files.keys()].filter(key => key.startsWith(root)).map(key => key.slice(root.length)),
    deleteAsync: async path => { files.delete(path); },
  };
  const mocks = {
    "expo-file-system/legacy": filesystem,
    "expo-secure-store": { getItemAsync: async key => secrets.get(key) || null, setItemAsync: async (key, value) => { secrets.set(key, value); }, deleteItemAsync: async key => { secrets.delete(key); } },
    react: { useState: () => {}, useEffect: () => {} },
    "@/src/utils/storage": { storage: { getItem: async (key, fallback) => prefs.has(key) ? JSON.parse(prefs.get(key)) : fallback, setItem: async (key, value) => { if (failCommit) return false; prefs.set(key, JSON.stringify(value)); return true; } } },
    "@react-native-async-storage/async-storage": { default: { getItem: async key => prefs.get(key) || null, setItem: async (key, value) => { if (failCommit) throw Error("Disk write failed"); prefs.set(key, value); } } },
    "@/src/nativeEpg": { fetchNativePlaylist: (...args) => fetcher(...args) },
    "./playlistCatalog": catalog,
  };
  const exports = {};
  const source = readFileSync(new URL("../src/core/playlistRegistry.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(mocks[name], name); return mocks[name]; }, process: { env: { EXPO_PUBLIC_M3U_URL: "https://primary.invalid/list", EXPO_PUBLIC_M3U_URL_2: "https://second.invalid/list" } }, URL, console });
  return { api: exports, files, prefs, secrets, fetch: fn => { fetcher = fn; }, failCommit: value => { failCommit = value; } };
}

test("migration seeds existing channels; refreshing source 2 cannot replace source 1", async () => {
  const h = registryHarness(); await h.api.seedLegacyPlaylist([channel("existing")]);
  h.fetch(async () => ({ channels: [channel("second")], rejected: 0, truncated: false }));
  const combined = await h.api.refreshPlaylists(catalog.SECOND_PLAYLIST);
  assert.ok(combined.some(row => row.id === "existing"));
  assert.equal(combined.filter(row => row.playlist_id === catalog.SECOND_PLAYLIST).length, 1);
  await h.api.seedLegacyPlaylist([channel("bad-duplicate-migration")]);
  assert.ok((await h.api.readCombinedPlaylists()).some(row => row.id === "existing"));
});

test("failed/empty refresh retains each source's last good catalog and redacts transport errors", async () => {
  const h = registryHarness(); await h.api.seedLegacyPlaylist([channel("existing")]);
  await h.api.refreshPlaylists(catalog.SECOND_PLAYLIST);
  const before = JSON.stringify(await h.api.readCombinedPlaylists());
  h.fetch(async () => { throw Error("https://secret.invalid/?password=do-not-log"); });
  assert.equal(JSON.stringify(await h.api.refreshPlaylists()), before);
  assert.doesNotMatch(JSON.stringify(await h.api.listPlaylists()), /do-not-log/);
  h.fetch(async () => ({ channels: [], rejected: 0, truncated: false }));
  assert.equal(JSON.stringify(await h.api.refreshPlaylists()), before);
});

test("a failed registry commit cannot activate new channels or replace source credentials", async () => {
  const h = registryHarness(); await h.api.seedLegacyPlaylist([channel("existing")]);
  const id = await h.api.savePersonalPlaylist("My list", "https://mine.invalid/old", [channel("mine")]);
  h.failCommit(true);
  await assert.rejects(h.api.savePersonalPlaylist("New name", "https://mine.invalid/new", [channel("replacement")], id));
  assert.equal(h.secrets.get(`playlist-${id}`), "https://mine.invalid/old");
  assert.ok((await h.api.readCombinedPlaylists()).some(row => row.source_channel_id === "mine"));
  assert.ok(!(await h.api.readCombinedPlaylists()).some(row => row.source_channel_id === "replacement"));
});

test("disable retains a catalog; removal waits for an in-flight import and cannot resurrect it", async () => {
  const h = registryHarness(); await h.api.seedLegacyPlaylist([channel("existing")]);
  const id = await h.api.savePersonalPlaylist("My list", "https://mine.invalid/list", [channel("mine")]);
  await h.api.updatePlaylist(id, { enabled: false });
  assert.equal((await h.api.readCombinedPlaylists()).length, 1);
  await h.api.updatePlaylist(id, { enabled: true });
  assert.equal((await h.api.readCombinedPlaylists()).length, 2);
  let finish, started; const entered = new Promise(resolve => { started = resolve; });
  h.fetch(async () => { started(); return new Promise(resolve => { finish = resolve; }); });
  const refresh = h.api.refreshPlaylists(id); await entered;
  const remove = h.api.removePlaylist(id);
  finish({ channels: [channel("fresh")], rejected: 0, truncated: false });
  await Promise.all([refresh, remove]);
  assert.ok(!(await h.api.listPlaylists()).some(row => row.id === id));
  assert.equal((await h.api.readCombinedPlaylists()).length, 1);
  assert.ok(!h.secrets.has(`playlist-${id}`));
});

test("managed slots cannot be deleted and personal source limit fails explicitly", async () => {
  const h = registryHarness(); await h.api.seedLegacyPlaylist([channel()]);
  await assert.rejects(h.api.removePlaylist(primary.id), /cannot be removed/);
  for (let at = 0; at < 5; at++) await h.api.savePersonalPlaylist(`List ${at}`, `https://mine.invalid/${at}`, [channel()]);
  await assert.rejects(h.api.savePersonalPlaylist("Overflow", "https://mine.invalid/extra", [channel()]), /five personal/);
});
