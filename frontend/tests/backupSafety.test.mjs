import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";

function inspect(file, names, mocks) {
  const source = readFileSync(new URL(`../src/utils/${file}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source + `\nexport { ${names} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => mocks[name] || {} });
  return exports;
}

const ROOT = "file:///app/playlists/";
test("missing playlist directory is empty but failed catalog reads reject the shared capture and rollback reader", async () => {
  let exists = false;
  let size = 1024;
  let reads = 0;
  const fs = {
    documentDirectory: "file:///app/",
    getInfoAsync: async path => path === ROOT ? { exists, isDirectory: true } : { exists: true, isDirectory: false, size },
    readDirectoryAsync: async () => ["user-one-live.json"],
    readAsStringAsync: async () => { reads++; throw new Error("Catalog unreadable"); },
  };
  const { readPlaylistFiles } = inspect("fullBackup", "readPlaylistFiles", { "expo-file-system/legacy": fs });
  assert.equal(JSON.stringify(await readPlaylistFiles()), "{}");
  exists = true;
  await assert.rejects(readPlaylistFiles(), /Catalog unreadable/);
  assert.equal(reads, 1);
  size = 13 * 1024 * 1024;
  await assert.rejects(readPlaylistFiles(), /too large/);
  assert.equal(reads, 1);
});

test("backup shape validation rejects unsafe paths, incomplete catalogs and invalid customization", () => {
  const { validateBackupData } = inspect("fullBackup", "validateBackupData", {});
  const row = { id: "user-one", name: "List", managed: false, enabled: true, revision: "live", epgSourceIds: [] };
  const good = {
    createdAt: "2026-11-06T08:00:00Z",
    settings: { charm_playlist_registry_v1: JSON.stringify([row]) },
    personalPlaylistUrls: {},
    playlistFiles: { "user-one-live.json": JSON.stringify([{ id: "channel", name: "One", url: "https://example.invalid/live" }]) },
    customization: { hiddenIds: [], customOrder: [], customNumbers: {}, groups: [] },
    manualEpgBindings: {},
  };
  assert.doesNotThrow(() => validateBackupData(good));
  assert.throws(() => validateBackupData({ ...good, playlistFiles: {} }), /missing an active/);
  assert.throws(() => validateBackupData({ ...good, playlistFiles: { "../outside.json": "[]" } }), /catalog path/);
  assert.throws(() => validateBackupData({ ...good, playlistFiles: { "user-one-live.json": "[null]" } }), /catalog rows/);
  assert.throws(() => validateBackupData({ ...good, customization: { ...good.customization, customOrder: [null] } }), /customizations/);
});

test("favorites import skips an oversized document before reading its body", async () => {
  let reads = 0;
  const { readValidBackupCandidate } = inspect("favoritesBackup", "readValidBackupCandidate", {
    "expo-file-system/legacy": {
      getInfoAsync: async () => ({ exists: true, isDirectory: false, size: 5 * 1024 * 1024 }),
      readAsStringAsync: async () => { reads++; return "{}"; },
    },
  });
  assert.equal(await readValidBackupCandidate("content://test/large", "large.json"), null);
  assert.equal(reads, 0);
});
