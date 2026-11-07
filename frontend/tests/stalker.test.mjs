import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createStalkerClient, encodeStalker, decodeStalker, normalizeStalkerGuide, stalkerEndpoint } from "../src/core/stalker.ts";
import { scopePlaylistChannels } from "../src/core/playlistCatalog.ts";

const login = { server: "https://portal.invalid/c/", mac: "00:1a:79:00:11:22", serial: "provided-serial", deviceId: "provided-device", timezone: "UTC" };

test("concurrent calls wait for the profile to complete before using a handshake token", async () => {
  const actions = [];
  let finishProfile;
  const client = createStalkerClient(login, async uri => {
    const action = new URL(uri).searchParams.get("action");
    actions.push(action);
    if (action === "get_profile") await new Promise(resolve => { finishProfile = resolve; });
    return new Response(JSON.stringify({ js: action === "handshake" ? { token: "new" } : { status: 2 } }));
  });
  const first = client.call("itv", "first");
  while (!finishProfile) await new Promise(resolve => setImmediate(resolve));
  const second = client.call("itv", "second");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actions, ["handshake", "get_profile"]);
  finishProfile();
  await Promise.all([first, second]);
  assert.deepEqual(actions.slice(2).sort(), ["first", "second"]);
});
function portal(handler) {
  const calls = [];
  const fetcher = async (raw, options) => {
    const url = new URL(raw), action = url.searchParams.get("action");
    calls.push({ action, url, options });
    const payload = action === "handshake" ? { token: "ephemeral-token", hash: "ephemeral-hash", random: "challenge" }
      : action === "get_profile" ? { status: 2 } : await handler(action, url, options, calls);
    return payload instanceof Response ? payload : new Response(JSON.stringify({ js: payload }));
  };
  return { calls, client: createStalkerClient(login, fetcher) };
}
test("clone portal routing and secure credential encoding retain explicit load.php endpoints", () => {
  const decoded = decodeStalker(encodeStalker(login));
  assert.equal(decoded.mac, "00:1A:79:00:11:22");
  assert.equal(stalkerEndpoint(decoded), "https://portal.invalid/server/load.php");
  assert.equal(stalkerEndpoint({ ...decoded, server: "https://portal.invalid/custom/server/load.php" }), "https://portal.invalid/custom/server/load.php");
  assert.throws(() => encodeStalker({ ...login, mac: "anything" }));
  assert.throws(() => encodeStalker({ ...login, server: "https://user:secret@portal.invalid" }));
});
test("clone handshake/profile precede catalog and session token never enters channel records", async () => {
  const p = portal(action => action === "get_genres" ? [{ id: "7", title: "News" }] : { data: [{ id: 42, name: "Station", cmd: "ffmpeg http://localhost/ch/42", tv_genre_id: 7 }] });
  const channels = await p.client.channels();
  assert.deepEqual(p.calls.map(row => row.action), ["handshake", "get_profile", "get_genres", "get_all_channels"]);
  assert.equal(p.calls[1].url.searchParams.get("stb_type"), "MAG270");
  assert.equal(p.calls[1].url.searchParams.get("device_id"), login.deviceId);
  assert.equal(p.calls[2].options.headers.Authorization, "Bearer ephemeral-token");
  assert.equal(p.calls[2].options.headers["X-Auth-Hash"], "ephemeral-hash");
  assert.equal(channels[0].url, "stalker://channel/42");
  assert.equal(channels[0].group, "News");
  assert.doesNotMatch(JSON.stringify(channels), /ephemeral/);
});
test("clone channel paging completes before publication and rejects looping pages", async () => {
  const p = portal((action, url) => action === "get_genres" ? [] : action === "get_all_channels" ? { data: [] }
    : { total_items: 2, data: [{ id: Number(url.searchParams.get("p")), cmd: "ffmpeg http://stream.invalid/live" }] });
  assert.equal((await p.client.channels()).length, 2);
  const bad = portal(action => action === "get_genres" ? [] : action === "get_all_channels" ? { data: [] } : { total_items: 2, data: [{ id: 1, cmd: "ffmpeg http://stream.invalid/live" }] });
  await assert.rejects(bad.client.channels(), /paging did not complete/);
});
test("create_link reauthenticates once on rejected token and strips clone ffmpeg command prefix", async () => {
  let attempts = 0;
  const p = portal(() => ++attempts === 1 ? new Response("", { status: 401 }) : { cmd: "ffmpeg https://stream.invalid/live?token=fresh" });
  const result = await p.client.resolve("ffmpeg http://localhost/ch/1");
  assert.equal(result.uri, "https://stream.invalid/live?token=fresh");
  assert.equal(p.calls.filter(row => row.action === "handshake").length, 2);
  assert.equal(p.calls.at(-1).url.searchParams.get("force_ch_link_check"), "0");
  assert.ok(result.headers["User-Agent"]);
});
test("portal failures redact provider bodies and unsupported command schemes are rejected", async () => {
  const p = portal(() => new Response("secret provider url and password", { status: 500 }));
  await assert.rejects(p.client.resolve("private command"), error => !/private command|secret provider/.test(error.message));
  const bad = portal(() => ({ cmd: "ffmpeg file:///etc/passwd" }));
  await assert.rejects(bad.client.resolve("command"), /supported playback/);
});
test("clone guide normalizes epoch seconds with no local timezone shift and reduces requested horizon", async () => {
  const row = { name: "News", descr: "Description", start_timestamp: 1900000000, stop_timestamp: 1900003600 };
  const normalized = normalizeStalkerGuide({ data: [{ "42": [row, { ...row, stop_timestamp: 0 }] }] });
  assert.equal(normalized[42].length, 1);
  assert.equal(normalized[42][0].start, new Date(row.start_timestamp * 1000).toISOString());
  const p = portal((action, url) => url.searchParams.get("period") !== "8" ? new Response("bad", { status: 500 }) : { data: [{ "42": [row] }] });
  assert.equal((await p.client.guide())[42].length, 1);
  assert.deepEqual(p.calls.filter(row => row.action === "get_epg_info").map(row => row.url.searchParams.get("period")), ["72", "24", "8"]);
});
test("cancelled portal operation never continues to channel/download work", async () => {
  const p = portal(() => { throw Error("must not fetch catalog"); }); const controller = new AbortController(); controller.abort();
  await assert.rejects(p.client.channels(controller.signal), /cancelled/);
  assert.equal(p.calls.filter(row => row.action === "get_genres").length, 0);
});
test("playback rejects a disabled or edited source while create_link is pending", async () => {
  let enabled = true, secret = encodeStalker(login), release;
  const module = { exports: {} };
  const channel = { id: "pl:user-one:local", playlist_id: "user-one", url: "stalker://channel/42", stalker_id: "42", stalker_cmd: "private command" };
  const source = { id: "user-one", kind: "stalker", revision: "one" };
  const mocks = {
    "./playlistCatalog": { playlistOwner: () => "user-one" },
    "./playlistRegistry": { listPlaylists: async () => [{ ...source, enabled }], getPlaylistUrl: async () => secret, readCombinedPlaylists: async () => [channel] },
    "./stalker": { decodeStalker, createStalkerClient: () => ({ resolve: () => new Promise(resolve => { release = () => resolve({ uri: "https://stream.invalid/fresh", headers: {} }); }) }) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/core/stalkerPlayback.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports: module.exports, require: name => mocks[name] });
  const pending = module.exports.resolveStalkerPlaybackUri(channel.url, channel.id);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  enabled = false; release(); await assert.rejects(pending, /changed/);
  assert.equal(await module.exports.resolveStalkerPlaybackUri("https://ordinary.invalid", channel.id), null);
  await assert.rejects(module.exports.resolveStalkerPlaybackUri(channel.url, channel.id), /disabled/);
});

test("native refresh rejects a stale portal link and retains ordinary playlist fallback", async () => {
  const source = readFileSync(new URL("../src/components/StreamPlayer.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  useEffect(() => addNativePlaybackSourceRefreshListener(");
  const end = source.indexOf("\n  useEffect(", start + 10);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const check = async (uri, channel, resolver, expectedUri, expectedReason) => {
    let listener;
    const oldUri = "https://old.invalid/live";
    const response = new Promise(resolve => {
      vm.runInNewContext(code, {
        useEffect: register => register(), addNativePlaybackSourceRefreshListener: next => { listener = next; },
        generationRef: { current: 1 }, currentChannelKey: "channel", owner: "owner", role: "fullscreen", engine: "media3",
        playbackKey: "key", uri, isSessionCurrent: () => true,
        currentSourceRef: { current: { uri: oldUri, headers: {}, contentType: null } },
        refreshPlaybackChannel: async () => channel, resolveStalkerPlaybackUri: resolver,
        resolveNativePlaybackFreshSource: (...args) => resolve(args),
      });
      listener({ owner: "owner", generation: 1, channelKey: "channel", requestId: 42 });
    });
    const [id, result, , , reason] = await response;
    assert.deepEqual([id, result, reason], [42, expectedUri, expectedReason]);
  };
  const portal = "stalker://channel/1";
  const rejected = async () => { throw new Error("Portal changed"); };
  await check(portal, null, rejected, null, "portal-channel-unavailable");
  await check(portal, { url: portal }, rejected, null, "portal-source-refresh-failed");
  await check("https://old.invalid/live", null, rejected, "https://old.invalid/live", "fresh-channel-unavailable-reused-current");
});

test("portal guide ownership comes from saved sources and staged XML is consumed once", async () => {
  const fileSystem = {
    documentDirectory: "file:///private/",
    makeDirectoryAsync: async () => {},
    writeAsStringAsync: async (path, contents) => files.set(path, contents),
    deleteAsync: async path => files.delete(path),
  };
  const files = new Map();
  const source = { id: "user-one", name: "Home portal", kind: "stalker", enabled: true, revision: "one" };
  let rows = [source];
  const registry = { listPlaylists: async () => rows, getPlaylistUrl: async () => encodeStalker(login) };
  const load = (relative, mocks) => {
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(code, { exports, require: name => mocks[name] ?? {}, Date, Math });
    return exports;
  };
  const guide = load("../src/core/stalkerGuide.ts", {
    "expo-file-system/legacy": fileSystem, "./playlistRegistry": registry,
    "./stalker": { decodeStalker, createStalkerClient: () => ({ guide: async () => ({
      42: [{ title: "News <Today>", desc: "A & B", start: "2030-03-17T17:46:40Z", stop: "2030-03-17T18:46:40Z" }],
    }) }) },
  });
  const configured = [];
  const bridge = load("../src/nativeEpg.ts", {
    "react-native": { NativeModules: { CharmEpg: { configureUserGuideSources: async (_primary, sources) => configured.push(sources) } }, Platform: { OS: "android" } },
    "./core/playlistRegistry": registry, "./core/stalkerGuide": guide,
  });
  const external = { id: "external", enabled: true, url: "https://guide.invalid" };
  const stale = { id: "portal-user-deleted", enabled: true, url: "file:///stale.xml" };
  await bridge.configureNativeUserGuideSources(false, [external, stale]);
  assert.equal(configured[0].map(row => row.id).join(","), "external,portal-user-one");
  rows = [{ ...source, autoEpg: false }];
  await bridge.configureNativeUserGuideSources(false, [external]);
  assert.equal(configured[1][1].enabled, false);
  rows = [source];
  await guide.withStalkerGuideFile(source, [{ stalker_id: "42", name: "A & B" }], async file => {
    assert.match(file, /stalker-user-one\.[a-z0-9-]+\.xml$/);
    assert.match(files.get(file), /News &lt;Today&gt;/);
    assert.match(files.get(file), /20300317174640 \+0000/);
  });
  assert.equal(files.size, 0);
  rows = [];
  await assert.rejects(guide.withStalkerGuideFile(source, [], async () => assert.fail("removed source imported")), /changed/);
});

test("portal backups require a saved portal source and a scoped catalog channel", () => {
  const exports = {};
  const source = readFileSync(new URL("../src/utils/fullBackup.ts", import.meta.url), "utf8") + "\nexport { validatePortalGuideBindings };";
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name === "@/src/core/playlistCatalog" ? { scopePlaylistChannels } : {} });
  const row = { id: "user-one", name: "Portal", revision: "current", kind: "stalker", managed: false };
  const raw = [{ id: "st-42", source_channel_id: "st-42", name: "News" }];
  const [channel] = scopePlaylistChannels(row, raw);
  const settings = { charm_playlist_registry_v1: JSON.stringify([row]) };
  const files = { "user-one-current.json": JSON.stringify(raw) };
  const binding = { sourceId: "portal-user-one", channelId: channel.id, xmltvId: "42" };
  assert.equal(JSON.stringify(exports.validatePortalGuideBindings([binding], settings, files)), JSON.stringify([binding]));
  assert.throws(() => exports.validatePortalGuideBindings([{ ...binding, sourceId: "portal-user-deleted" }], settings, files), /missing source or channel/);
  assert.throws(() => exports.validatePortalGuideBindings([{ ...binding, channelId: "pl:user-two:42" }], settings, files), /missing source or channel/);
  assert.throws(() => exports.validatePortalGuideBindings([binding, binding], settings, files), /missing source or channel/);
});

test("clone movie, series and archive calls resolve playback through the portal", async () => {
  const calls = [];
  const start = Math.floor(Date.now() / 1000) - 7200;
  const p = portal((action, url) => {
    const type = url.searchParams.get("type");
    calls.push([type, action, Object.fromEntries(url.searchParams)]);
    if (action === "get_categories") return [{ id: "1", title: "New" }];
    if (action === "create_link") return { cmd: "ffmpeg https://media.invalid/video" };
    if (action === "get_simple_data_table") return { data: [{ id: "archive_42", start_timestamp: start }] };
    if (action !== "get_ordered_list") throw new Error("Unexpected portal action");
    if (type === "vod" && url.searchParams.get("movie_id")) return { data: [{ id: "moviefile" }] };
    if (type === "series" && url.searchParams.get("movie_id")) return { total_items: 1, data: [{ id: "1", season_number: 1, season_series: [1, 2], cmd: "/media/shared.mpg" }] };
    return { total_items: 1, data: [{ id: type === "vod" ? "10" : "20", name: type === "vod" ? "Movie" : "Show", category_id: 1, has_files: 1 }] };
  });
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../src/core/stalkerMedia.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ createStalkerClient: () => p.client, normalizeStalker: value => value, STALKER_USER_AGENT: "Portal" }), Date, Intl, URL });
  assert.equal((await exports.listStalkerCatalog(login, "movie"))[0].id, "10");
  assert.equal((await exports.resolveStalkerMedia(login, "movie", "10")).uri, "https://media.invalid/video");
  assert.equal(calls.at(-1)[2].cmd, "/media/file_moviefile.mpg");
  const details = await exports.loadStalkerDetails(login, "series", "20");
  assert.notEqual(details.episodes[0].id, details.episodes[1].id);
  await exports.resolveStalkerMedia(login, "series", details.episodes[1].id);
  assert.equal(calls.at(-1)[2].series, "2");
  assert.equal(calls.at(-1)[2].cmd, "/media/shared.mpg");
  const program = { start: new Date(start * 1000).toISOString(), stop: new Date((start + 3600) * 1000).toISOString() };
  await exports.resolveStalkerCatchup(login, { stalker_id: "42", archive_days: 1 }, program);
  assert.deepEqual(calls.at(-1).slice(0, 2), ["tv_archive", "create_link"]);
  assert.equal(calls.at(-1)[2].cmd, "auto /media/archive_42.mpg");
});

test("cancelling a portal catalogue stops paging and skips the series fallback", async () => {
  const controller = new AbortController();
  const p = portal(action => {
    if (action === "get_categories") return [];
    controller.abort();
    return { total_items: 200, data: [{ id: "one", name: "Title" }] };
  });
  const exports = {};
  const source = readFileSync(new URL("../src/core/stalkerMedia.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ createStalkerClient: () => p.client }) });
  await assert.rejects(exports.listStalkerCatalog(login, "series", controller.signal), /cancelled/);
  assert.equal(p.calls.filter(row => row.action === "get_ordered_list").length, 1);
  assert.equal(p.calls.filter(row => row.action === "get_categories").length, 1);
});

test("a stale provider-library initial read cannot overwrite a newer saved result", async () => {
  let initial, reads = 0;
  const shown = [];
  const exports = {};
  const source = readFileSync(new URL("../src/core/providerLibrary.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mocks = {
    react: { useState: () => [[], value => shown.push(value)], useEffect: effect => effect() },
    "@/src/utils/storage": { storage: {
      getItem: () => ++reads === 1 ? new Promise(resolve => { initial = resolve; }) : Promise.resolve([]),
      setItem: async () => true,
    } },
    "./providerLibraryCore": { normalizeProviderLibrary: rows => rows, mergeProviderLibrary: (_rows, patch) => [patch] },
  };
  vm.runInNewContext(code, { exports, require: name => mocks[name] });
  exports.useProviderLibrary();
  const fresh = { owner: "one", kind: "movie", catalogId: "7", favorite: true };
  await exports.updateProviderLibrary(fresh);
  initial([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shown.length, 1);
  assert.equal(shown[0][0], fresh);
});
