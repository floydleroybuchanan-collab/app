import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

test("VLC never silently drops provider cookies or unsupported HTTP headers", async () => {
  const native = await read("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackManager.kt");
  assert.match(native, /finishWithError\(identity, "request-headers-unsupported"\)/);
  assert.ok(native.indexOf('finishWithError(identity, "request-headers-unsupported")') < native.indexOf("val media = Media(core"));
  assert.doesNotMatch(native, /media\.addOption\(":http-header=|media\.addOption\(":http-cookie=/);
});

test("automatic mode starts Media3 and serializes one VLC fallback", async () => {
  const [player, preference, policy, coordinator] = await Promise.all([read("src/components/StreamPlayer.tsx"), read("src/playerEnginePreference.ts"), read("src/core/streamPolicy.ts"), read("src/core/serializedPlaybackCoordinator.ts")]);
  assert.match(preference, /"auto" \| "media3" \| "vlc"/); assert.match(preference, /cachedPreference: PlayerEnginePreference = "auto"/); assert.match(preference, /gs_player_engine_preference_v3/);
  assert.match(player, /initialEngine\(playerEngine, kind\)/); assert.match(player, /tryAutomaticVlcFallback/);
  assert.match(player, /activateNativePlaybackEngine/); assert.doesNotMatch(player, /stopNativeFullscreen|stopNativeVlcFullscreen|Promise\.allSettled/); assert.doesNotMatch(player, /alternateEngine|fallbackUsed|setEngine\(/);
  assert.match(player, /state !== "background"/);
  assert.match(player, /Never stopFullscreenSession/);
  assert.match(player, /role === "fullscreen"/);
  assert.match(player, /setNativeVlcMuted\(role === "preview" &&/);
  assert.match(policy, /isNativeMedia3SupportedStreamKind/); assert.match(policy, /isVlcSupportedStreamKind/); assert.match(policy, /return isNativeMedia3SupportedStreamKind\(kind\) \? "media3" : "vlc"/);
  assert.match(coordinator, /let operation: Promise<void> = Promise\.resolve\(\)/); assert.doesNotMatch(coordinator, /Promise\.all|Promise\.allSettled/);
});

test("LibVLC is native, single-owner, hardware-first, and fully releasable", async () => {
  const [manager, module, app, gradle] = await Promise.all([read("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackManager.kt"), read("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackModule.kt"), read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"), read("android/app/build.gradle")]);
  assert.match(gradle, /org\.videolan\.android:libvlc-all:3\.7\.5/); assert.match(gradle, /libc\+\+_shared\.so/); assert.match(app, /add\(NativeVlcPlaybackPackage\(\)\)/);
  assert.match(manager, /releasePlayerOnly\(removeLayout = false\)/); assert.match(manager, /MediaPlayer\(core\)/); assert.match(manager, /media\.setHWDecoderEnabled\((?:source\.)?hardwareDecode, false\)/); assert.match(manager, /fun releaseAll\(\)/);
  assert.match(manager, /attachViews\(layout, null, false, true\)/);
  assert.match(manager, /LibVLC delivers events off the main thread/);
  assert.match(manager, /MAX_ERROR_RECOVERIES = 1/);
  assert.match(manager, /recoverOnce\(identity/);
  assert.match(manager, /performReconnect\(identity, source\)/);
  assert.match(manager, /onPlaybackProblem/);
  assert.doesNotMatch(manager, /advanceUriLadder|opaqueUriVariants/);
  assert.match(manager, /:http-reconnect/);
  assert.match(manager, /:live-caching=/);
  assert.doesNotMatch(manager, /:clock-jitter=0|:clock-synchro=0/);
  assert.match(manager, /CharmHttpClients\.cookieHeaderFor/);
  assert.match(manager, /val media = Media\(core, Uri\.parse\(source\.uri\)\)/);
  assert.match(manager, /awaiting-surface/);
  assert.match(manager, /pendingPrepare/);
  assert.match(manager, /Fullscreen must never inherit Guide preview mute/);
  assert.match(manager, /mutedState = false/);
  assert.match(module, /LifecycleEventListener/); assert.match(module, /onHostDestroy\(\).*releaseAll/s);
  assert.match(module, /HostPause for transient overlays/);
  const surface = await read("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackSurface.kt");
  assert.match(surface, /clipChildren = false/);
  assert.match(surface, /Do not call detachSurface\(\) here/);
  assert.match(surface, /onSizeChanged/);
  assert.match(surface, /oldw <= 0 \|\| oldh <= 0/);
});

test("channel playback profile index is stable-keyed and bounded", async () => {
  const profile = await read("src/core/playbackProfileIndex.ts"); assert.match(profile, /MAX_PROFILES = 512/); assert.match(profile, /confirmedType/); assert.match(profile, /rememberDeclaredStreamType/); assert.match(profile, /rememberConfirmedStreamType/); assert.match(profile, /channelKey/); assert.doesNotMatch(profile, /streamUrl|rawUri/);
});

test("native events carry session identity and lifecycle cleanup", async () => {
  const [bridge, module, player] = await Promise.all([read("src/nativePlayback.ts"), read("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt"), read("src/components/StreamPlayer.tsx")]);
  assert.match(bridge, /generation: number/); assert.match(bridge, /channelKey: string/); assert.match(module, /LifecycleEventListener/); assert.match(module, /activeGeneration/); assert.match(module, /activeChannelKey/); assert.match(player, /event\.generation !== generation/); assert.match(player, /event\.channelKey !== currentChannelKey/);
});

test("Media3 safety budgets remain bounded and watchdog-free", async () => {
  const manager = await read("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  for (const marker of [
    'fun tivimateBufferDurationsMs',
    '"low_latency" -> intArrayOf(1_000, 5_000, 500, 1_000)',
    '"balanced" -> intArrayOf(3_000, 15_000, 1_000, 2_000)',
    'else -> intArrayOf(10_000, 30_000, 1_500, 3_000)',
    'START_TIMEOUT_MS = 30_000L',
    'MAX_ERROR_RECOVERIES = 1',
    'ERROR_RECOVERY_DELAY_MS = 1_000L',
  ]) assert.match(manager, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(manager, /RECONNECT_STALL_MS|bufferingWatchdog|MAX_AUTO_RECOVERIES|RECOVERY_BACKOFF_MS|TRANSPORT_HUNG_BUFFER_REPREPARE_MS|HARD_STALL_RECOVERY_MS|STABLE_REARM_MS/);
});


test("playlist stream types are batch-indexed without probing and hydration cannot clobber edits", async () => {
  const [profile, source, engine, vlc] = await Promise.all([read("src/core/playbackProfileIndex.ts"), read("src/source.native.ts"), read("src/playerEnginePreference.ts"), read("src/core/vlcPlaybackPreferences.ts")]);
  assert.match(profile, /let mutationRevision = 0/);
  assert.match(profile, /const revisionAtStart = mutationRevision/);
  assert.match(profile, /prune\(\{ \.\.\.storedProfiles, \.\.\.cached \}\)/);
  assert.match(profile, /const pendingLoad = loadPromise/);
  assert.match(source, /indexDeclaredStreamTypes\(channels\)/);
  assert.match(source, /if \(!channels\.length\) return;[\s\S]*indexDeclaredStreamTypes\(channels\);[\s\S]*if \(!nativeEpgAvailable\) return;/);
  assert.match(engine, /const revisionAtStart = mutationRevision/);
  assert.match(engine, /mutationRevision === revisionAtStart/);
  assert.match(vlc, /hardwareMutationRevision === hardwareRevisionAtStart/);
  assert.match(vlc, /hardwareDecode === true/);
  assert.match(vlc, /audioMutationRevision === audioRevisionAtStart/);
  assert.doesNotMatch(profile, /fetch\(|XMLHttpRequest|probeStream/);
});

// Native validation trigger: manual VLC final compile/scan.
