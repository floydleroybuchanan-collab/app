import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("live TV core is one Activity-owned Media3 path", async () => {
  const [stream, native, bridge] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("src/nativePlayback.ts")]);
  assert.match(stream, /prepareNativeFullscreen/); assert.match(stream, /prepareNativePreview/); assert.doesNotMatch(stream, /VideoView|VLCPlayer|react-native-vlc-media-player|alternateEngine/);
  assert.match(native, /object NativePlaybackManager/); assert.match(native, /private var player: ExoPlayer\? = null/); assert.match(native, /private var owner: Owner = Owner\.NONE/); assert.match(native, /if \(requestedOwner == Owner\.PREVIEW && owner == Owner\.FULLSCREEN\) \{/); assert.match(native, /publishState\("error", "owner-reserved"\)/); assert.match(bridge, /NativeModules\.NativePlayback/);
});

test("channel changes build a fresh Media3 source on the same native ExoPlayer", async () => {
  const [player, native] = await Promise.all([
    source("app/player.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
  ]);
  assert.match(native, /player\?\.let \{ return it \}/); assert.match(native, /instance\.clearMediaItems\(\)/); assert.match(native, /instance\.setMediaSource\(mediaSource, true\)/); assert.match(native, /instance\.prepare\(\)/);
  assert.doesNotMatch(player, /decoderArmed|pauseSessionDecoders|CHANNEL_ZAP_SETTLE_MS|armDecoderAfterSettle/);
});

test("Media3 uses bounded TV buffers and one event-driven reconnect", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /fun tivimateBufferDurationsMs/);
  assert.match(native, /"low_latency" -> intArrayOf\(1_000, 5_000, 500, 1_000\)/);
  assert.match(native, /"balanced" -> intArrayOf\(3_000, 15_000, 1_000, 2_000\)/);
  assert.match(native, /else -> intArrayOf\(10_000, 30_000, 1_500, 3_000\)/);
  assert.match(native, /TARGET_BUFFER_BYTES_LOW_RAM = 16 \* 1024 \* 1024/);
  assert.match(native, /TARGET_BUFFER_BYTES_NORMAL = 48 \* 1024 \* 1024/);
  assert.match(native, /CharmMemoryCoordinator\.budgets\(\)\.lowRam/);
  assert.match(native, /START_TIMEOUT_MS = 30_000L/);
  assert.match(native, /DefaultHlsExtractorFactory\(liveTsFlags, true\)/);
  assert.match(native, /DashMediaSource\.Factory/);
  assert.match(native, /setWakeMode\(C\.WAKE_MODE_NETWORK\)/);
  assert.doesNotMatch(native, /TRANSPORT_HUNG_BUFFER_REPREPARE_MS|HARD_STALL_RECOVERY_MS|STABLE_REARM_MS|HUNG_BUFFER_REPREPARE_MS/);
  assert.match(native, /MAX_ERROR_RECOVERIES = 1/);
  assert.match(native, /ERROR_RECOVERY_DELAY_MS = 1_000L/);
  assert.match(await source("android/app/src/main/java/com/charmiptv/app/CharmHttpClients.kt"), /readTimeout\(20, TimeUnit.SECONDS\)/);
  assert.match(native, /CharmHttpClients\.mediaClient\(\)/);
  assert.match(native, /recoveryAttempts >= MAX_ERROR_RECOVERIES/);
  assert.match(native, /fullPlayerAndSourceRecovery\(instance, source\)/);
  assert.doesNotMatch(native, /RECONNECT_STALL_MS|bufferingWatchdog|RECOVERY_BACKOFF_MS|MAX_AUTO_RECOVERIES|silentAudioCheck/);
});

test("direct MPEG-TS keeps its extractor while hardware video uses the Onn-safe codec path", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /ProgressiveMediaSource\.Factory\(dataSource, createLiveTsExtractorsFactory\(\)\)\.createMediaSource\(item\)/);
  assert.match(native, /DefaultExtractorsFactory\(\)\.setTsExtractorFlags\(/);
  assert.match(native, /DefaultTsPayloadReaderFactory\.FLAG_ALLOW_NON_IDR_KEYFRAMES/);
  assert.match(native, /DefaultTsPayloadReaderFactory\.FLAG_DETECT_ACCESS_UNITS/);
  assert.match(native, /"transport" -> builder\.setMimeType\(MimeTypes\.VIDEO_MP2T\)/);
  assert.match(native, /setEnableDecoderFallback\(true\)/);
  assert.match(native, /forceDisableMediaCodecAsynchronousQueueing\(\)/);
});

test("first frame is the stable-playing gate and cancels delayed recovery", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  const firstFrame = native.match(/override fun onRenderedFirstFrame\(\)[\s\S]*?\n\s*}/)?.[0] || ""; assert.match(firstFrame, /firstFrameRendered = true/); assert.match(firstFrame, /removeCallbacks\(delayedRecovery\)/); assert.match(firstFrame, /publishState\("playing", null\)/);
});

test("native PlayerView is mounted inside the React playback target instead of below opaque screens", async () => {
  const [native, surface, adapter, previewLayout, fullscreenLayout, calibration, player, layout] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackSurface.kt"),
    source("src/components/StreamPlayer.tsx"),
    source("android/app/src/main/res/layout/charm_player_view.xml"),
    source("android/app/src/main/res/layout/charm_player_view_fullscreen.xml"),
    source("src/tvCalibration.tsx"),
    source("app/player.tsx"),
    source("app/_layout.tsx"),
  ]);
  assert.match(native, /attachSurface/); assert.match(native, /target\.addView\(video, fillParent\(\)\)/); assert.match(native, /setShutterBackgroundColor\(Color\.TRANSPARENT\)/); assert.match(native, /clipChildren = false/);
  assert.match(native, /unclipVideoAncestors/);
  assert.match(native, /setAudioAttributes/);
  assert.match(native, /isOpaque = true/);
  assert.doesNotMatch(native, /setZOrderMediaOverlay/);
  assert.doesNotMatch(native, /playWhenReady = false/);
  assert.doesNotMatch(native, /content\.removeView\(reactRoot\)/);
  assert.match(surface, /class NativePlaybackSurface/); assert.match(surface, /NativePlaybackManager\.attachSurface/);
  assert.match(surface, /clipChildren = false/);
  assert.doesNotMatch(surface, /surfaceHealthCheck/);
  assert.match(adapter, /CharmNativePlaybackSurface/);
  assert.match(adapter, /renderToHardwareTextureAndroid=\{false\}/);
  assert.match(previewLayout, /app:surface_type="texture_view"/);
  assert.match(fullscreenLayout, /app:surface_type="texture_view"/);
  assert.match(calibration, /overflow: "visible"/);
  assert.match(player, /overflow: "visible"/);
  assert.match(player, /!isTV \? \(/);
  assert.doesNotMatch(player, /zoomedVideo|transform: \[\{ scale/);
  assert.match(layout, /animation: "none"/);
});

test("audio and subtitles hot-apply through TrackSelectionParameters", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /trackSelectionParameters\.buildUpon\(\)/); assert.match(native, /TrackSelectionOverride/); assert.match(native, /clearOverridesOfType\(C\.TRACK_TYPE_AUDIO\)/); assert.match(native, /clearOverridesOfType\(C\.TRACK_TYPE_TEXT\)/);
});

test("Guide preview cannot own playback while fullscreen owns native player", async () => {
  const [stream, native, guide] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("app/(tabs)/guide.tsx")]);
  assert.match(stream, /isPreviewPlaybackAllowed\(\)/); assert.match(native, /requestedOwner == Owner\.PREVIEW && owner == Owner\.FULLSCREEN/); assert.doesNotMatch(guide, /noteStreamFailure|clearStreamFailure/);
  assert.match(stream, /event\.reason === "owner-reserved"/);
});

test("stale fullscreen native cleanup cannot release a newer Guide preview", async () => {
  const [native, module] = await Promise.all([source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt")]);
  assert.match(native, /if \(currentOwner\(\) != requestedOwner && decoderReleaseFailure == null\) \{ onStopped\?\.invoke\(null\); return@runOnMain }/);
  assert.match(module, /NativePlaybackManager\.stop\(requestedOwner, releasePlayer\)/);
  assert.match(native, /val video = playerViewFor\(owner\)/);
});

test("fullscreen exit returns currently tuned channel to the originating Guide group", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /const currentChannelId = pendingChannelIdRef\.current \|\| channelIdRef\.current/);
  assert.match(player, /const returnGuideGroup = String\(params\.returnGuideGroup \|\| ""\)\.trim\(\) \|\| "All"/);
  assert.match(player, /requestGuideJump\(\{ channelId: currentChannelId, group: returnGuideGroup \}\)/);
  assert.match(player, /stopFullscreenSession\(\)\.then\(\(\) => \{/);
  assert.match(player, /router\.replace\("\/guide" as any\)/);
});

test("Program Details Watch now preserves Guide return anchor", async () => { const modal = await source("src/components/ProgramModal.tsx"); assert.match(modal, /openFullscreenPlayer\(router, channel\.id, \{ returnToGuide: pathname\?\.startsWith\("\/guide"\) \}\)/); });

test("preview/fullscreen handoff leaves exactly one PlayerView attached to Media3", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  const start = native.indexOf("fun prepare(requestedOwner: Owner");
  const end = native.indexOf("fun provideFreshSource", start);
  const prepare = start >= 0 && end > start ? native.slice(start, end) : "";
  const bindReplacement = prepare.indexOf("video.player = instance");
  const retireInactive = prepare.indexOf("clearInactivePlayerView(requestedOwner)");
  assert.ok(bindReplacement >= 0, "prepare must bind the requested PlayerView");
  assert.ok(retireInactive >= 0, "prepare must retire inactive PlayerViews on every owner handoff");
  assert.ok(bindReplacement < retireInactive, "replacement PlayerView must be bound before an inactive PlayerView is cleared");
  const softStop = native.indexOf("private fun stopInternal(releasePlayer: Boolean)");
  const clearAll = native.indexOf("clearAllPlayerViews()", softStop);
  assert.ok(softStop >= 0 && clearAll > softStop, "a retained ExoPlayer must never retain an old surface");
  const surfaceCheck = native.indexOf("private fun ensureActiveSurfaceBound");
  const repairClear = native.indexOf("clearInactivePlayerView(activeOwner)", surfaceCheck);
  assert.ok(surfaceCheck >= 0 && repairClear > surfaceCheck, "watchdog surface repair must also clear a stale peer surface");
});
