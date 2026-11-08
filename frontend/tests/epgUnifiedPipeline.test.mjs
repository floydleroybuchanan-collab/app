import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = file => readFileSync(resolve(root, file), "utf8");
const java = name => source("android/app/src/main/java/com/charmiptv/app/" + name + ".kt");

test("main, custom and background EPG imports use one future window", () => {
  for (const name of ["EpgNativeModule", "CustomEpgNativeModule", "BackgroundEpgUpdater"]) {
    assert.match(java(name), /GUIDE_WINDOW_MS\s*=\s*EpgWindowPolicy\.FUTURE_MS/);
    assert.match(java(name), /EpgCompressedStreams\.decode/);
  }
  assert.match(java("EpgWindowPolicy"), /FUTURE_MS = 24L \* 60L \* 60L \* 1000L/);
});

test("expired programs and FTS search rows are deleted in the same transaction", () => {
  const db = java("EpgDatabase");
  assert.match(db, /fun deleteExpired\(beforeMs: Long\): Int = acquireImport\(\)\.use/);
  assert.match(db, /DELETE FROM \$FTS_TABLE WHERE programme_id IN \(SELECT id FROM \$LIVE_TABLE WHERE end_time < \?\)/);
  assert.match(db, /db\.beginTransactionNonExclusive\(\)/);
});

test("unchanged guide avoids live-table replacement and FTS rebuild", () => {
  const db = java("EpgDatabase");
  assert.match(db, /GUIDE_CONTENT_FINGERPRINT_KEY/);
  assert.match(db, /contentDigest\.digest\(\)/);
  assert.match(db, /getMeta\(GUIDE_CONTENT_FINGERPRINT_KEY\) == contentSignature/);
});

test("one periodic maintenance worker is scheduled and avoids foreground playback", () => {
  assert.match(java("EpgUpdateScheduler"), /PeriodicWorkRequestBuilder<EpgMaintenanceWorker>\(12, TimeUnit\.HOURS\)/);
  assert.match(java("EpgMaintenanceWorker"), /EpgImportCoordinator\.canStartBackground/);
  assert.match(java("EpgMaintenanceWorker"), /database\.acquireImport\(\)\.use/);
});

test("both M3U parsers recognize EXTGRP metadata", () => {
  assert.match(java("NativePlaylistParser"), /#EXTGRP:/);
  assert.match(source("src/core/sourceParsing.ts"), /#EXTGRP:/);
});
