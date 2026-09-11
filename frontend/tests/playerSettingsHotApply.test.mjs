import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("resize choices survive a late surface mount and preview always uses Fit", async () => {
  const native = await readFile(join(root, "android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), "utf8");
  assert.match(native, /private var fullscreenResizeMode/);
  assert.match(native, /resizeMode = if \(surfaceOwner == Owner.FULLSCREEN\) fullscreenResizeMode else AspectRatioFrameLayout.RESIZE_MODE_FIT/);
  assert.match(native, /setPrioritizeTimeOverSizeThresholds\(false\)/);
});

test("native Media3 hot-applies audio subtitles mute pause and aspect without decoder rebuild", async () => {
  const [adapter, native] = await Promise.all([readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8"), readFile(join(root, "android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), "utf8")]);
  assert.match(adapter, /selectNativeAudio/); assert.match(adapter, /selectNativeSubtitle/); assert.match(adapter, /setNativePlaybackMuted/); assert.match(adapter, /pauseNativePlayback/); assert.match(adapter, /resumeNativePlayback/); assert.match(adapter, /setNativePlaybackResizeMode/);
  assert.match(native, /trackSelectionParameters\.buildUpon\(\)/); assert.match(native, /TrackSelectionOverride/); assert.match(native, /setResizeMode/); assert.doesNotMatch(adapter, /alternateEngine|fallbackUsed|setEngine\(/);
});

test("track commands use the ownership queue and lifecycle resume leaves fullscreen pause alone", async () => {
  const adapter = await readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8");
  const audioEffect = adapter.slice(adapter.indexOf("if (!playbackFocused || !generation || audioTrack == null)"));
  assert.match(audioEffect, /runNativePlaybackCommand\(role, engine, \(\) => isSessionCurrent\(role, generation\)/);
  for (const name of ["NativePlayback"]) {
    const bridge = await readFile(join(root, `android/app/src/main/java/com/charmiptv/app/${name}Module.kt`), "utf8");
    const resume = bridge.slice(bridge.indexOf("override fun onHostResume()"), bridge.indexOf("override fun onHostPause()"));
    assert.match(resume, /currentOwner\(\) == .*Owner.PREVIEW/);
    assert.doesNotMatch(resume, /!= .*Owner.NONE/);
  }
});

test("live-TV defaults retain Media3 while settings explain optional Nova for VOD", async () => {
  const [store, layout, settings, quickActions, packageJson, appJson, player, preference, coordinator] = await Promise.all([readFile(join(root, "src/store.tsx"), "utf8"), readFile(join(root, "src/core/guideLayoutDefault.ts"), "utf8"), readFile(join(root, "app/(tabs)/settings.tsx"), "utf8"), readFile(join(root, "src/components/TvQuickActionsOverlay.tsx"), "utf8"), readFile(join(root, "package.json"), "utf8"), readFile(join(root, "app.json"), "utf8"), readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8"), readFile(join(root, "src/playerEnginePreference.ts"), "utf8"), readFile(join(root, "src/core/serializedPlaybackCoordinator.ts"), "utf8")]);
  assert.match(store, /useState<SafePreviewMode>\("delayed"\)/); assert.match(store, /SAFE_PREVIEW_MODE_KEY, "delayed"/); assert.match(store, /useState<DeviceLayoutMode>\("tv"\)/); assert.match(layout, /return "cinematic"/);
  assert.match(settings, /Live TV and multiview use Media3\/ExoPlayer/); assert.match(settings, /VOD also offers optional Nova playback/); assert.doesNotMatch(settings, /Player engine|VLC|useVlcPlaybackPreferences/);
  assert.match(preference, /return "media3"/); assert.match(preference, /migrateMedia3OnlyPreferences/);
  assert.doesNotMatch(player, /tryAutomaticVlcFallback|NativeVlc/); assert.match(player, /activateNativePlaybackEngine/); assert.match(coordinator, /await native\.stop\(active\.engine, active\.role, active\.engine !== engine\)/); assert.match(coordinator, /await native\.stop\(active\.engine, active\.role, true\)/); assert.doesNotMatch(coordinator, /Promise\.all|Promise\.allSettled/);
  assert.doesNotMatch(quickActions, /Player engine|ENGINE_ORDER|usePlayerEnginePreference/); assert.doesNotMatch(packageJson, /react-native-vlc-media-player|expo-video|patch-package/); assert.doesNotMatch(appJson, /react-native-vlc-media-player|expo-video/); assert.doesNotMatch(player, /alternateEngine|fallbackUsed|setEngine\(/);
});
