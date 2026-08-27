import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("native Media3 hot-applies audio subtitles mute pause and aspect without decoder rebuild", async () => {
  const [adapter, native] = await Promise.all([readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8"), readFile(join(root, "android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), "utf8")]);
  assert.match(adapter, /selectNativeAudio/); assert.match(adapter, /selectNativeSubtitle/); assert.match(adapter, /setNativePlaybackMuted/); assert.match(adapter, /pauseNativePlayback/); assert.match(adapter, /resumeNativePlayback/); assert.match(adapter, /setNativePlaybackResizeMode/);
  assert.match(native, /trackSelectionParameters\.buildUpon\(\)/); assert.match(native, /TrackSelectionOverride/); assert.match(native, /setResizeMode/); assert.doesNotMatch(adapter, /alternateEngine|fallbackUsed|setEngine\(/);
});

test("real-device defaults use Media3 first with an explicit serialized VLC fallback", async () => {
  const [store, layout, settings, quickActions, packageJson, appJson, player, preference, coordinator] = await Promise.all([readFile(join(root, "src/store.tsx"), "utf8"), readFile(join(root, "src/core/guideLayoutDefault.ts"), "utf8"), readFile(join(root, "app/(tabs)/settings.tsx"), "utf8"), readFile(join(root, "src/components/TvQuickActionsOverlay.tsx"), "utf8"), readFile(join(root, "package.json"), "utf8"), readFile(join(root, "app.json"), "utf8"), readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8"), readFile(join(root, "src/playerEnginePreference.ts"), "utf8"), readFile(join(root, "src/core/nativePlaybackCoordinator.ts"), "utf8")]);
  assert.match(store, /useState<SafePreviewMode>\("delayed"\)/); assert.match(store, /SAFE_PREVIEW_MODE_KEY, "delayed"/); assert.match(store, /useState<DeviceLayoutMode>\("tv"\)/); assert.match(layout, /return "cinematic"/);
  assert.match(settings, /label="Player engine"/); assert.match(settings, /Automatic \(Media3 → VLC\)/); assert.match(settings, /Media3 only/); assert.match(settings, /VLC only/); assert.match(settings, /playerEngine !== "media3"/); assert.match(settings, /VLC hardware decoding/); assert.match(settings, /VLC audio output/);
  assert.match(preference, /cachedPreference: PlayerEnginePreference = "auto"/); assert.match(preference, /gs_player_engine_preference_v3/);
  assert.match(player, /tryAutomaticVlcFallback/); assert.match(player, /activateNativePlaybackEngine/); assert.match(coordinator, /await stopEngine\(active\.engine, active\.role, active\.engine !== engine\)/); assert.match(coordinator, /await stopEngine\(current\.engine, current\.role, true\)/); assert.doesNotMatch(coordinator, /Promise\.all|Promise\.allSettled/);
  assert.doesNotMatch(quickActions, /Player engine|ENGINE_ORDER|usePlayerEnginePreference/); assert.doesNotMatch(packageJson, /react-native-vlc-media-player|expo-video|patch-package/); assert.doesNotMatch(appJson, /react-native-vlc-media-player|expo-video/); assert.doesNotMatch(player, /alternateEngine|fallbackUsed|setEngine\(/);
});
