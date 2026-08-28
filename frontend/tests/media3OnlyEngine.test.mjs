import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateMedia3OnlyPreferences, PLAYER_ENGINE_KEY, RETIRED_ENGINE_KEYS } from "../src/core/media3OnlyMigration.ts";
import { normalizeStoredPlaybackProfiles } from "../src/core/playbackProfileMigration.ts";
import { detectStreamKind, parsePipeHeaders, preferredEngine } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

test("native VLC implementation, JS bridge, preferences and dependency are absent", async () => {
  for (const path of [
    "src/nativeVlcPlayback.ts", "src/core/vlcPlaybackPreferences.ts",
    ...["Manager", "Module", "Package", "Surface"].map(name => `android/app/src/main/java/com/charmiptv/app/NativeVlcPlayback${name}.kt`),
  ]) await assert.rejects(access(join(root, path)), { code: "ENOENT" });
  const [app, gradle, player, coordinator] = await Promise.all([
    read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"), read("android/app/build.gradle"),
    read("src/components/StreamPlayer.tsx"), read("src/core/nativePlaybackCoordinator.ts"),
  ]);
  for (const body of [app, gradle, player, coordinator]) assert.doesNotMatch(body, /NativeVlc|nativeVlc|libvlc|videolan|tryAutomaticVlcFallback/);
  assert.match(gradle, /implementation project\(':ffmpeg-audio'\)/);
  assert.match(app, /add\(NativePlaybackPackage\(\)\)/);
  assert.match(player, /CharmNativePlaybackSurface/);
});

test("legacy automatic and VLC preferences migrate without touching provider credentials or audio selection", async () => {
  for (const legacy of ["auto", "vlc", "media3", null, "unexpected"]) {
    const values = new Map([
      [PLAYER_ENGINE_KEY, legacy], ...RETIRED_ENGINE_KEYS.map(key => [key, "old"]),
      ["provider_cookie", "session=a+b"], ["preferred_audio_language", "eng"], ["channel_audio_choice", "track-2"],
    ]);
    const storage = {
      setItem: async (key, value) => { values.set(key, value); return true; },
      removeItem: async key => { values.delete(key); return true; },
    };
    await migrateMedia3OnlyPreferences(storage);
    await migrateMedia3OnlyPreferences(storage);
    assert.deepEqual(Object.fromEntries(values), {
      [PLAYER_ENGINE_KEY]: "media3", provider_cookie: "session=a+b", preferred_audio_language: "eng", channel_audio_choice: "track-2",
    });
  }
  const preference = await read("src/playerEnginePreference.ts");
  assert.match(preference, /getPlayerEnginePreference\(\): PlayerEnginePreference \{\s*return "media3"/);
  assert.doesNotMatch(preference, /getItem|useState|useEffect|listeners|cachedPreference/);
});

test("profile hydration clears removed-engine confirmations and preserves Media3 metadata", () => {
  const media3 = { declaredType: "transport", confirmedType: "hls", lastEngine: "media3", updatedAt: 5 };
  const input = {
    legacy: { declaredType: "ts", confirmedType: "progressive", lastEngine: "vlc", updatedAt: 3 },
    automatic: { declaredType: "dash", confirmedType: "dash", lastEngine: "auto", updatedAt: 4 },
    current: media3, invalid: "bad", empty: null,
  };
  const normalized = normalizeStoredPlaybackProfiles(input);
  assert.deepEqual(normalized, {
    legacy: { declaredType: "transport", updatedAt: 3 },
    automatic: { declaredType: "dash", updatedAt: 4 },
    current: media3,
  });
  assert.equal(input.legacy.lastEngine, "vlc");
  assert.deepEqual(normalizeStoredPlaybackProfiles(normalized), normalized);
  assert.deepEqual(normalizeStoredPlaybackProfiles([]), {});
  assert.deepEqual(normalizeStoredPlaybackProfiles(null), {});
  assert.deepEqual(normalizeStoredPlaybackProfiles({ unknown: { declaredType: "bogus", updatedAt: Infinity } }), { unknown: { declaredType: "unknown", updatedAt: 0 } });
});

test("all supported streams use Media3 and unsupported transports have no fallback", async () => {
  for (const kind of ["hls", "dash", "transport", "progressive", "rtsp", "unknown"]) assert.equal(preferredEngine(kind), "media3");
  for (const url of ["rtsps://host/live", "srt://host/live", "rtmp://host/live", "udp://host:1234", "rtp://host:1234", "webrtc://host/live"]) {
    assert.equal(preferredEngine(detectStreamKind(url)), null);
  }
  assert.equal(detectStreamKind("rtsps://host/live", "rtsp"), "rtsps");
  assert.equal(preferredEngine(detectStreamKind("https://host/opaque", "rtsps")), null);
  const player = await read("src/components/StreamPlayer.tsx");
  assert.match(player, /onStatusRef.current\("error", "unsupported-protocol"\)/);
  const unsupported = player.slice(player.indexOf("if (!kindSupported)"), player.indexOf("const generation = beginSession(role)"));
  assert.match(unsupported, /releaseNativePlaybackRole\(role\)/);
  assert.doesNotMatch(unsupported, /prepareNative|activateNativePlaybackEngine/);
});

test("Media3 receives the unmodified provider source, cookies and custom headers", async () => {
  const url = "https://provider.invalid/live/A+b?token=x%2By&signature=a+b";
  const parsed = parsePipeHeaders(`${url}|Cookie=session%3Da%2Bb&Authorization=Bearer%20token&X-Provider=42`);
  assert.equal(parsed.uri, url);
  assert.equal(parsed.headers.Cookie, "session=a+b");
  assert.equal(parsed.headers.Authorization, "Bearer token");
  assert.equal(parsed.headers["X-Provider"], "42");
  const player = await read("src/components/StreamPlayer.tsx");
  for (const method of ["prepareNativePreview", "prepareNativeFullscreen"]) {
    assert.match(player, new RegExp(`${method}\\(generation, currentChannelKey, source.uri, source.headers, source.contentType, bufferProfile\\)`));
  }
  assert.match(player, /currentSourceRef.current = \{ key: playbackKey, \.\.\.fresh, contentType: freshType \}/);
  assert.match(player, /if \(!isNativeMedia3SupportedStreamKind\(freshKind\)\)/);
});

test("single Media3 ownership and focus safeguards remain active", async () => {
  const [player, coordinator] = await Promise.all([read("src/components/StreamPlayer.tsx"), read("src/core/serializedPlaybackCoordinator.ts")]);
  assert.match(player, /activateNativePlaybackEngine/);
  assert.match(player, /state !== "background"/);
  assert.match(player, /Never stopFullscreenSession/);
  assert.match(player, /setNativePlaybackMuted\(role === "preview" &&/);
  assert.doesNotMatch(player, /stopNativeFullscreen|Promise\.allSettled|setEngine\(/);
  assert.match(coordinator, /let operation: Promise<void> = Promise\.resolve\(\)/);
  assert.match(coordinator, /if \(engine !== "media3"\) throw new Error/);
  assert.doesNotMatch(coordinator, /Promise\.all|Promise\.allSettled/);
});

test("channel playback profile index remains stable-keyed and bounded", async () => {
  const profile = await read("src/core/playbackProfileIndex.ts");
  for (const marker of [/MAX_PROFILES = 512/, /confirmedType/, /rememberDeclaredStreamType/, /rememberConfirmedStreamType/, /channelKey/, /normalizeStoredPlaybackProfiles/]) assert.match(profile, marker);
  assert.doesNotMatch(profile, /streamUrl|rawUri|fetch\(|XMLHttpRequest|probeStream/);
});

test("native events retain session identity and lifecycle cleanup", async () => {
  const [bridge, module, player] = await Promise.all([read("src/nativePlayback.ts"), read("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt"), read("src/components/StreamPlayer.tsx")]);
  assert.match(bridge, /generation: number/);
  assert.match(bridge, /channelKey: string/);
  assert.match(module, /LifecycleEventListener/);
  assert.match(module, /activeGeneration/);
  assert.match(module, /activeChannelKey/);
  assert.match(player, /event\.generation !== generation/);
  assert.match(player, /event\.channelKey !== currentChannelKey/);
});

test("Media3 buffering retains bounded memory without a rebuffer watchdog", async () => {
  const manager = await read("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(manager, /media3BufferDurationsMs/);
  assert.match(manager, /48 \* 1024 \* 1024/);
  assert.match(manager, /START_TIMEOUT_MS = 30_000L/);
  assert.doesNotMatch(manager, /RECONNECT_STALL_MS|bufferingWatchdog|TRANSPORT_HUNG_BUFFER_REPREPARE_MS|HARD_STALL_RECOVERY_MS/);
  const policy = await read("android/app/src/main/java/com/charmiptv/app/Media3RecoveryPolicy.kt");
  assert.match(policy, /Failure.NETWORK, Failure.LIVE_WINDOW, Failure.LIVE_END -> Action.REPREPARE_SOURCE/);
  assert.match(policy, /minOf\(attempts, 5\) \* 1_000L/);
  assert.doesNotMatch(policy, /MAX_ERROR_RECOVERIES|postDelayed|Handler\(/);
});

test("playlist types stay batch-indexed and late profile hydration cannot overwrite edits", async () => {
  const [profile, source] = await Promise.all([read("src/core/playbackProfileIndex.ts"), read("src/source.native.ts")]);
  assert.match(profile, /let mutationRevision = 0/);
  assert.match(profile, /const revisionAtStart = mutationRevision/);
  assert.match(profile, /prune\(\{ \.\.\.storedProfiles, \.\.\.cached \}\)/);
  assert.match(profile, /const pendingLoad = loadPromise/);
  assert.match(source, /if \(!channels\.length\) return;[\s\S]*indexDeclaredStreamTypes\(channels\);[\s\S]*if \(!nativeEpgAvailable\) return;/);
});
