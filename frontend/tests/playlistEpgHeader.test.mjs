import test from "node:test";
import assert from "node:assert/strict";
import { playlistEpgUrls } from "../src/core/playlistEpgHeader.ts";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("M3U header discovery supports both common tags, multiple URLs, BOM and relative HTTP addresses", () => {
  const header = `\uFEFF#EXTM3U url-tvg="https://epg.invalid/a.xml,https://epg.invalid/b.xml" x-tvg-url='../guide.xml' tvg-url="https://epg.invalid/a.xml"\n#EXTINF:-1 tvg-id="station",Channel\nhttps://stream.invalid/live`;
  assert.deepEqual(playlistEpgUrls(header, "https://provider.invalid/lists/list.m3u"), ["https://epg.invalid/a.xml", "https://epg.invalid/b.xml", "https://provider.invalid/guide.xml"]);
  assert.deepEqual(playlistEpgUrls('#EXTM3U x-tvg-url="https://epg.invalid/xml?u=a&amp;p=b"', ""), ["https://epg.invalid/xml?u=a&p=b"]);
});

test("discovery ignores non-header attributes and unsafe protocols and bounds feed count", () => {
  assert.deepEqual(playlistEpgUrls('#EXTM3U\n#EXTINF:-1 url-tvg="https://bad.invalid/xml",Channel', ""), []);
  assert.deepEqual(playlistEpgUrls('#EXTM3U url-tvg="file:///secret content://local javascript:alert(1)"', ""), []);
  assert.deepEqual(playlistEpgUrls('#EXTM3U url-tvg="../guide.xml"', "content://documents/list"), []);
  const urls = Array.from({ length: 20 }, (_, n) => `https://epg.invalid/${n}.xml`).join(",");
  assert.equal(playlistEpgUrls(`#EXTM3U url-tvg="${urls}"`, "").length, 8);
});

function discoveryHarness(rows, env = {}) {
  const calls = [], updates = [];
  const exports = {};
  const mocks = {
    "./playlistRegistry": { listPlaylists: async () => rows, applyDiscoveredPlaylistEpg: async (...args) => updates.push(args) },
    "./multiEpgSources": { ensureDiscoveredEpgSource: async url => { calls.push(url); return url.includes("full") ? null : "detected"; } },
    "./epgSourcePreferences": { getEpgSourcePreferences: async () => ({ userUrl: "https://legacy.invalid/xml" }) },
    "./playlistCatalog": { PRIMARY_PLAYLIST: "charm-primary", SECOND_PLAYLIST: "charm-secondary" },
    "@/src/auth/managedContentAccess": { managedEpgUrl: id => id === "primary" ? env.EXPO_PUBLIC_EPG_URL || "" : env.EXPO_PUBLIC_EPG_URL_2 || "" },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/core/playlistEpgDiscovery.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], process: { env } });
  return { run: exports.discoverPlaylistEpg, calls, updates };
}

test("detection keeps supplied guides and also associates a different M3U-header guide", async () => {
  const base = { name: "List", enabled: true, epgSourceIds: [], discoveredEpgUrls: ["https://epg.invalid/xml"] };
  const h = discoveryHarness([
    { ...base, id: "charm-primary", managed: true, epgSourceIds: ["primary"] },
    { ...base, id: "manual", autoEpg: false },
    { ...base, id: "old-manual", epgSourceIds: ["existing"] },
    { ...base, id: "disabled", enabled: false },
  ], { EXPO_PUBLIC_EPG_URL: "https://owner.invalid/xml" });
  await h.run(); assert.equal(h.calls.length, 1); assert.equal(h.updates.length, 1);
  assert.deepEqual(Array.from(h.updates[0][1]), ["primary", "detected"]);
});

test("a playlist header matching the supplied secondary guide reuses its owner slot", async () => {
  const h = discoveryHarness([{ id: "charm-secondary", name: "List 2", enabled: true, managed: true, autoEpg: true, epgSourceIds: ["owner-secondary"], discoveredEpgUrls: ["https://owner.invalid/guide.xml"] }], { EXPO_PUBLIC_EPG_URL_2: "https://owner.invalid/guide.xml" });
  await h.run(); assert.equal(h.calls.length, 0); assert.deepEqual(Array.from(h.updates[0][1]), ["owner-secondary"]);
});

test("removing a supplied guide also removes its stale reserved owner association", async () => {
  const h = discoveryHarness([{ id: "charm-secondary", name: "List 2", enabled: true, managed: true, autoEpg: true, epgSourceIds: ["owner-secondary", "chosen"], autoEpgSourceIds: [], discoveredEpgUrls: ["https://epg.invalid/new.xml"] }]);
  await h.run();
  assert.deepEqual(Array.from(h.updates[0][1]), ["chosen", "detected"]);
});

test("detected EPG reuses legacy feeds and preserves last-good associations when slots are full", async () => {
  const h = discoveryHarness([{ id: "personal", name: "List", enabled: true, autoEpg: true, epgSourceIds: ["previous"], autoEpgSourceIds: ["previous"], discoveredEpgUrls: ["https://legacy.invalid/xml", "https://full.invalid/xml"] }]);
  await h.run(); assert.equal(h.calls.length, 1);
  assert.deepEqual(Array.from(h.updates[0][1]), ["previous", "user"]);
  assert.match(h.updates[0][3], /source limit reached/);
});


test("shared EPG registry reuses a detected URL without enabling it and refuses excess sources", async () => {
  const exports = {};
  const initial = Array.from({ length: 7 }, (_, i) => ({ id: `feed${i}`, name: `Feed ${i}`, url: `https://epg.invalid/${i}`, enabled: false, overrides: {} }));
  const mocks = {
    react: { useCallback() {}, useEffect() {}, useState() {} },
    "@/src/utils/storage": { storage: { getItem: async () => initial, setItem: async () => true } },
    "@/src/core/additionalEpgOwnership": { replaceAdditionalEpgOwners() {} },
    "@/src/source": { invalidateGuideOwnershipCaches() {} },
    "@/src/auth/managedContentAccess": { managedEpgUrl: () => "" },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/core/multiEpgSources.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(mocks[name], name); return mocks[name]; }, process: { env: {} } });
  assert.equal(await exports.ensureDiscoveredEpgSource("https://epg.invalid/0", "Detected"), "feed0");
  assert.equal((await exports.getMultiEpgSources())[0].enabled, false);
  assert.equal(await exports.ensureDiscoveredEpgSource("https://epg.invalid/extra", "Detected"), null);
  assert.equal((await exports.getMultiEpgSources()).length, 7);
});
