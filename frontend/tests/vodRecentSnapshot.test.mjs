import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { normalizeVodSnapshot, vodSnapshotStorageKey } from "../src/core/vodRecentSnapshotCore.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("VOD shelf snapshots are isolated per account and type", () => {
  assert.notEqual(vodSnapshotStorageKey("account-one", "continue"), vodSnapshotStorageKey("account-two", "continue"));
  assert.notEqual(vodSnapshotStorageKey("account-one", "continue"), vodSnapshotStorageKey("account-one", "favorites"));
  assert.equal(vodSnapshotStorageKey(null, "continue"), null);
});

test("VOD shelf snapshots are bounded, deduplicated and omit credentials", () => {
  const input = Array.from({ length: 65 }, (_, n) => ({
    id: String(n), title: "Title " + n, section: "movie:" + n,
    poster: n === 0 ? "https://img.example/poster.jpg?access_token=secret" : "https://img.example/poster.jpg"
  }));
  input.push({ id: "duplicate", title: "duplicate", section: "movie:0" });
  const rows = normalizeVodSnapshot(input);
  assert.equal(rows.length, 30);
  assert.equal(rows[0].poster, undefined);
  assert.equal(rows[1].poster, "https://img.example/poster.jpg");
  assert.ok(rows.every(row => !JSON.stringify(row).includes("access_token")));
  assert.deepEqual(normalizeVodSnapshot([{ id: "", section: "show:no", title: "x" }]), []);
});

test("Live TV shelf has no background native VOD IPC", () => {
  const file = readFileSync(resolve(root, "src/components/MediaLibraryShelf.tsx"), "utf8");
  assert.doesNotMatch(file, /CharmVod\?\.libraryItems\(/);
  assert.match(file, /readVodSnapshot/);
});

test("Native VOD refresh originates from VOD route and player lifecycle only", () => {
  const file = readFileSync(resolve(root, "src/components/MediaLabVodContent.tsx"), "utf8");
  assert.match(file, /captureNativeVodSnapshot/);
  assert.match(file, /nativeEvent\.kind === "player"/);
});
