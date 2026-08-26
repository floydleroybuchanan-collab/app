import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

test("manual VLC engine is explicit and never auto-fallbacks", async () => {
  const [player, preference, policy] = await Promise.all([read("src/components/StreamPlayer.tsx"), read("src/playerEnginePreference.ts"), read("src/core/streamPolicy.ts")]);
  assert.match(preference, /"media3" \| "vlc"/); assert.match(preference, /cachedPreference: PlayerEnginePreference = "media3"/); assert.match(player, /playerEngine === "vlc"/);
  assert.match(player, /stopNativeFullscreen\(true\)/); assert.match(player, /stopNativeVlcFullscreen\(true\)/); assert.doesNotMatch(player, /alternateEngine|fallbackUsed|setEngine\(/);
  assert.match(policy, /isNativeMedia3SupportedStreamKind/); assert.match(policy, /isVlcSupportedStreamKind/);
});

test("LibVLC is native, single-owner, hardware-first, and fully releasable", async () => {
  const [manager, module, app, gradle] = await Promise.all([read("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackManager.kt"), read("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackModule.kt"), read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"), read("android/app/build.gradle")]);
  assert.match(gradle, /org\.videolan\.android:libvlc-all:3\.7\.5/); assert.match(gradle, /libc\+\+_shared\.so/); assert.match(app, /add\(NativeVlcPlaybackPackage\(\)\)/);
  assert.match(manager, /releasePlayerOnly\(removeLayout = false\)/); assert.match(manager, /MediaPlayer\(core\)/); assert.match(manager, /media\.setHWDecoderEnabled\((?:source\.)?hardwareDecode, false\)/); assert.match(manager, /fun releaseAll\(\)/);
  assert.match(manager, /attachViews\(layout, null, false, true\)/);
  assert.match(manager, /LibVLC delivers events off the main thread/);
  assert.match(module, /LifecycleEventListener/); assert.match(module, /onHostDestroy\(\).*releaseAll/s);
  const surface = await read("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackSurface.kt");
  assert.match(surface, /clipChildren = false/);
  assert.match(surface, /Do not call detachSurface\(\) here/);
});

test("channel playback profile index is stable-keyed and bounded", async () => {
  const profile = await read("src/core/playbackProfileIndex.ts"); assert.match(profile, /MAX_PROFILES = 512/); assert.match(profile, /confirmedType/); assert.match(profile, /rememberDeclaredStreamType/); assert.match(profile, /rememberConfirmedStreamType/); assert.match(profile, /channelKey/); assert.doesNotMatch(profile, /streamUrl|rawUri/);
});

test("native events carry session identity and lifecycle cleanup", async () => {
  const [bridge, module, player] = await Promise.all([read("src/nativePlayback.ts"), read("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt"), read("src/components/StreamPlayer.tsx")]);
  assert.match(bridge, /generation: number/); assert.match(bridge, /channelKey: string/); assert.match(module, /LifecycleEventListener/); assert.match(module, /activeGeneration/); assert.match(module, /activeChannelKey/); assert.match(player, /event\.generation !== generation/); assert.match(player, /event\.channelKey !== currentChannelKey/);
});

test("locked Media3 safety budgets remain unchanged", async () => {
  const manager = await read("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  for (const marker of ["MIN_BUFFER_MS_LOW_RAM = 20_000","MAX_BUFFER_MS_LOW_RAM = 90_000","PLAYBACK_BUFFER_MS_LOW_RAM = 5_000","REBUFFER_BUFFER_MS_LOW_RAM = 12_000","MIN_BUFFER_MS_NORMAL = 20_000","MAX_BUFFER_MS_NORMAL = 90_000","PLAYBACK_BUFFER_MS_NORMAL = 5_000","REBUFFER_BUFFER_MS_NORMAL = 12_000","HUNG_BUFFER_REPREPARE_MS = 35_000L","TRANSPORT_HUNG_BUFFER_REPREPARE_MS = 50_000L","MAX_AUTO_RECOVERIES = 4","longArrayOf(0L, 1_000L, 2_000L, 4_000L)"]) assert.match(manager, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
