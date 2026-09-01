import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = async (name) => (await readFile(path.join(root, name), "utf8")).replace(/\r\n/g, "\n");

test("durable Guide updates keep manual sources visible and unscheduled", async () => {
  const [scheduler, native, control, background] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgUpdateScheduler.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt"),
    source("android/app/src/main/java/com/charmiptv/app/BackgroundEpgUpdater.kt"),
  ]);
  assert.match(scheduler, /PeriodicWorkRequestBuilder<EpgUpdateWorker>/);
  assert.match(scheduler, /ExistingPeriodicWorkPolicy\.UPDATE/);
  assert.match(scheduler, /BackoffPolicy\.EXPONENTIAL/);
  assert.match(scheduler, /setRequiresCharging/);
  assert.match(scheduler, /setRequiresDeviceIdle/);
  assert.match(scheduler, /if \(source\.refreshHours <= 0\) continue/);
  assert.match(native, /enabled = controlDao\.source\(id\)\?\.enabled \?: url\.isNotBlank\(\)/);
  assert.match(control, /epg_update_history/);
  assert.match(control, /nextRetrySeconds/);
  assert.match(background, /replaceBatches\(batches\)/);
  assert.match(background, /GZIPInputStream/);
  assert.match(background, /scheme == "http" \|\| scheme == "https"/);
});

test("matching priority and diagnostics expose why every playlist channel won", async () => {
  const [custom, playlists, health] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt"),
    source("app/playlists.tsx"),
    source("app/(tabs)/epg-sources.tsx"),
  ]);
  for (const reason of ["exact_tvg_id", "unique_display_name", "guarded_callsign", "unique_logo", "guarded_fuzzy_name", "manual_override"]) {
    assert.match(custom, new RegExp(reason));
  }
  assert.match(custom, /putArray\("matchExplanations", explanations\)/);
  assert.match(custom, /putArray\("unmatchedChannelIds", unmatchedIds\)/);
  assert.match(custom, /putInt\("indexedChannels", indexedChannels\)/);
  assert.match(playlists, /Higher/);
  assert.match(playlists, /Lower/);
  assert.match(playlists, /fallback priority/);
  assert.match(health, /How channels matched/);
});

test("all four timing layers feed both foreground and background imports", async () => {
  const [primary, custom, background, timing] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/BackgroundEpgUpdater.kt"),
    source("src/core/guideTimingPreferences.ts"),
  ]);
  for (const value of [primary, custom, background]) {
    assert.match(value, /serverOffsetMinutes/);
    assert.match(value, /playlistOffsetMinutes/);
    assert.match(value, /GuideTimingPolicy\.globalOffsetMinutes/);
    assert.match(value, /channelOffset/);
  }
  assert.match(timing, /configureNativeSourceTiming/);
});

test("playlist preservation, cross-list groups, complete backup, and local logo priority are wired", async () => {
  const [registry, groups, backup, logos] = await Promise.all([
    source("src/core/playlistRegistry.ts"),
    source("src/core/customGuideGroups.ts"),
    source("src/utils/fullBackup.ts"),
    source("src/components/ChannelLogo.tsx"),
  ]);
  assert.match(registry, /tombstones\.json/);
  assert.match(registry, /deletedAt: Date\.now\(\)/);
  assert.match(groups, /copyGroupMembers/);
  assert.match(groups, /moveGroupMembers/);
  assert.match(backup, /charmiptv-full-backup/);
  assert.match(backup, /Backup integrity check failed/);
  assert.match(backup, /applyCustomization\(currentCustomization\)/);
  assert.match(backup, /AsyncStorage\.multiRemove\(obsoleteKeys\)/);
  assert.match(logos, /logoPriority === "local"/);
});
