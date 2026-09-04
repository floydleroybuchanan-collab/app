import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness(options = {}) {
  const events = [];
  const exports = {};
  const channels = [{ id: "one", playlist_id: "charm-primary" }, { id: "pl:charm-secondary:two", playlist_id: "charm-secondary" }];
  const mocks = {
    "react-native": { NativeModules: options.nativeModules || {} },
    "@/src/source": { refreshEpgOnly: async (includeAdditional = true) => { events.push(includeAdditional ? "all-epgs" : "primary-epg"); return { channel_count: 2 }; }, sourceStatus: () => ({ channel_count: 2 }) },
    "@/src/source.native": { reloadPlaylistCatalog: async () => events.push("publish") },
    "./playlistRegistry": {
      listPlaylists: async () => options.playlists || [], readCombinedPlaylists: async () => channels,
      refreshPlaylists: async id => { events.push(`playlist:${id || "all"}`); return channels; },
    },
    "./playlistCatalog": { PRIMARY_PLAYLIST: "charm-primary", playlistOwner: channel => channel.playlist_id || "charm-primary" },
    "./playlistEpg": { syncPlaylistEpg: async (_rows, refresh, id) => events.push(`epg:${refresh}:${id || "all"}`) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/core/playlistGuideOperations.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name] });
  return { ...exports, events };
}

test("per-playlist refresh controls keep playlist-only, EPG-only and combined work separate", async () => {
  const playlist = harness();
  await playlist.refreshOnePlaylistOnly("charm-secondary");
  assert.deepEqual(playlist.events, ["playlist:charm-secondary", "publish"]);

  const epg = harness();
  await epg.refreshOnePlaylistGuide("charm-secondary");
  assert.deepEqual(epg.events, ["epg:true:charm-secondary", "publish"]);

  const both = harness();
  await both.refreshOnePlaylistAndGuide("charm-secondary");
  assert.deepEqual(both.events, ["playlist:charm-secondary", "publish", "epg:true:charm-secondary", "publish"]);
});

test("global EPG refresh includes primary and every independent playlist guide", async () => {
  const h = harness();
  await h.refreshEveryGuide();
  assert.deepEqual(h.events, ["all-epgs", "publish"]);
});

test("playlist health is scoped by stable playlist ownership and keeps the native module receiver", async () => {
  let received = null;
  const native = { async getPlaylistGuideHealth(groups) { assert.equal(this, native); received = groups; return [{ playlistId: "charm-secondary", matched: 1 }]; } };
  const h = harness({
    nativeModules: { CharmCustomEpg: native },
    playlists: [{ id: "charm-primary", name: "One", enabled: true }, { id: "charm-secondary", name: "Two", enabled: true }],
  });
  const rows = await h.readPlaylistGuideHealth([{ id: "one", playlist_id: "charm-primary" }, { id: "pl:charm-secondary:two", playlist_id: "charm-secondary" }]);
  assert.deepEqual(received.map(row => [row.playlistId, Array.from(row.channelIds)]), [["charm-primary", ["one"]], ["charm-secondary", ["pl:charm-secondary:two"]]]);
  assert.deepEqual(rows, [{ playlistId: "charm-secondary", matched: 1 }]);
});
