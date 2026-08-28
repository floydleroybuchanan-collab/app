import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beginSession, getPlaybackOwnershipRevision, getSessionPhase, isPreviewPlaybackAllowed, isSessionCurrent, pauseSessionDecoders, registerSessionStop, resetPlaybackSessionsForTests, setNativePlaybackReleaseHandler, setSessionPhase, stopPreviewForFullscreen, stopFullscreenSession, stopAllPlaybackSessions, waitForFullscreenRelease } from "../src/core/playbackSession.ts";
import { detectStreamKind, media3ContentType, preferredEngine } from "../src/core/streamPolicy.ts";
import { createPlaybackCoordinator } from "../src/core/serializedPlaybackCoordinator.ts";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("fullscreen reservation releases preview before allocating its decoder", async () => { resetPlaybackSessionsForTests(); const previewGen = beginSession("preview"); let stopped = 0; registerSessionStop("preview", previewGen, () => { stopped += 1; }); await stopPreviewForFullscreen(); assert.equal(stopped, 1); assert.equal(isPreviewPlaybackAllowed(), false); const fullGen = beginSession("fullscreen"); assert.equal(isSessionCurrent("preview", previewGen), false); assert.equal(isSessionCurrent("fullscreen", fullGen), true); });

function coordinatorFixture(overrides = {}) {
  const events = [];
  const native = {
    owner: async () => "none",
    stop: async (engine, role, release) => { events.push(`stop:${engine}:${role}:${release}`); },
    pause: (engine) => { events.push(`pause:${engine}`); },
    ...overrides,
  };
  return { events, native, coordinator: createPlaybackCoordinator(native) };
}

test("coordinator waits for release acknowledgement before the next decoder prepares", async () => {
  const { events, native, coordinator } = coordinatorFixture();
  await coordinator.activate("preview", "media3", () => true, () => events.push("prepare:media3"));
  let finish;
  native.stop = async () => { events.push("stop:start"); await new Promise(resolve => { finish = resolve; }); events.push("stop:done"); };
  const handoff = coordinator.activate("fullscreen", "media3", () => true, () => events.push("prepare:fullscreen"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["prepare:media3", "stop:start"]);
  finish();
  await handoff;
  assert.deepEqual(events, ["prepare:media3", "stop:start", "stop:done", "prepare:fullscreen"]);
  await coordinator.release("preview");
  assert.deepEqual(coordinator.current(), { role: "fullscreen", engine: "media3" });
});

test("cancelled queued activation cannot stop the current decoder or prepare later", async () => {
  const { coordinator, events } = coordinatorFixture();
  await coordinator.activate("fullscreen", "media3", () => true, () => events.push("prepare:media3"));
  await coordinator.activate("preview", "media3", () => false, () => events.push("prepare:fullscreen"));
  assert.deepEqual(events, ["prepare:media3"]);
  assert.deepEqual(coordinator.current(), { role: "fullscreen", engine: "media3" });
});

test("cancellation during release prevents a stale prepare and the queue remains usable", async () => {
  let current = true;
  const { coordinator, events } = coordinatorFixture({ stop: async () => { current = false; } });
  await coordinator.activate("preview", "media3", () => true, () => {});
  await coordinator.activate("fullscreen", "media3", () => current, () => events.push("stale"));
  assert.deepEqual(events, []);
  await coordinator.activate("fullscreen", "media3", () => true, () => events.push("fresh"));
  assert.deepEqual(events, ["fresh"]);
});

test("release failure never authorizes another owner and keeps ownership for cleanup", async () => {
  const { coordinator, native, events } = coordinatorFixture();
  await coordinator.activate("fullscreen", "media3", () => true, () => {});
  native.stop = async () => { throw new Error("release failed"); };
  await assert.rejects(coordinator.activate("preview", "media3", () => true, () => events.push("unsafe")), /release failed/);
  assert.deepEqual(events, []);
  assert.deepEqual(coordinator.current(), { role: "fullscreen", engine: "media3" });
});

test("queued cleanup and pause recheck their generation after an earlier native operation settles", async () => {
  let finishLookup;
  let current = true;
  const { coordinator, events } = coordinatorFixture({ owner: () => new Promise(resolve => { finishLookup = resolve; }) });
  const activate = coordinator.activate("fullscreen", "media3", () => true, () => events.push("prepare:new"));
  await new Promise(resolve => setImmediate(resolve));
  const release = coordinator.release("fullscreen", () => current);
  const pause = coordinator.pause("fullscreen", () => current);
  current = false;
  finishLookup("none");
  await Promise.all([activate, release, pause]);
  assert.deepEqual(events, ["prepare:new"]);
  assert.deepEqual(coordinator.current(), { role: "fullscreen", engine: "media3" });
});

test("cleanup invalidated during native owner lookup cannot stop a later generation", async () => {
  let finishLookup;
  let current = true;
  const { coordinator, events } = coordinatorFixture({ owner: () => new Promise(resolve => { finishLookup = resolve; }) });
  const release = coordinator.release("fullscreen", () => current);
  await new Promise(resolve => setImmediate(resolve));
  current = false;
  finishLookup("fullscreen");
  await release;
  assert.deepEqual(events, []);
});

test("activation invalidated during native owner lookup cannot stop the current native decoder", async () => {
  let finishLookup;
  let current = true;
  const { coordinator, native, events } = coordinatorFixture({ owner: () => new Promise(resolve => { finishLookup = resolve; }) });
  const activation = coordinator.activate("preview", "media3", () => current, () => events.push("stale:prepare"));
  await new Promise(resolve => setImmediate(resolve));
  current = false;
  finishLookup("fullscreen");
  await activation;
  assert.deepEqual(events, []);
  assert.equal(coordinator.current(), null);
  native.owner = async () => "none";
  await coordinator.activate("fullscreen", "media3", () => true, () => events.push("fresh:prepare"));
  assert.deepEqual(events, ["fresh:prepare"]);
});

test("session release carries a live generation guard into the asynchronous coordinator", async () => {
  resetPlaybackSessionsForTests();
  let guard;
  let finish;
  setNativePlaybackReleaseHandler((_role, isCurrent) => {
    guard = isCurrent;
    return new Promise(resolve => { finish = resolve; });
  });
  beginSession("fullscreen");
  const stopped = stopFullscreenSession();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(guard(), true);
  beginSession("fullscreen");
  assert.equal(guard(), false);
  finish();
  await stopped;
  setNativePlaybackReleaseHandler(null);
});

test("duplicate playback phase events do not publish redundant ownership renders", () => {
  resetPlaybackSessionsForTests();
  const generation = beginSession("fullscreen");
  setSessionPhase("fullscreen", generation, "playing");
  const revision = getPlaybackOwnershipRevision();
  for (let i = 0; i < 100; i += 1) assert.equal(setSessionPhase("fullscreen", generation, "playing"), true);
  assert.equal(getPlaybackOwnershipRevision(), revision);
  setSessionPhase("fullscreen", generation, "recovering");
  assert.equal(getPlaybackOwnershipRevision(), revision + 1);
});

test("JS reload cleanup is role scoped and native owner lookup errors fail closed", async () => {
  const { coordinator, native, events } = coordinatorFixture({ owner: async () => "fullscreen" });
  await coordinator.release("preview");
  assert.deepEqual(events, []);
  native.owner = async () => { throw new Error("bridge unavailable"); };
  await assert.rejects(coordinator.activate("preview", "media3", () => true, () => events.push("unsafe")), /bridge unavailable/);
  assert.deepEqual(events, []);
});

test("stale role, generation and engine commands cannot control another session", async () => {
  const { coordinator, events } = coordinatorFixture();
  await coordinator.activate("fullscreen", "media3", () => true, () => {});
  await coordinator.command("preview", "media3", () => true, () => events.push("stale-role"));
  await coordinator.command("fullscreen", "vlc", () => true, () => events.push("stale-engine"));
  await coordinator.command("fullscreen", "media3", () => false, () => events.push("stale-generation"));
  await coordinator.command("fullscreen", "media3", () => true, () => events.push("current"));
  assert.deepEqual(events, ["current"]);
});

test("a delayed stop callback cannot release a newly started same-role session", async () => {
  resetPlaybackSessionsForTests();
  let finishCallback;
  let nativeReleases = 0;
  const generation = beginSession("fullscreen");
  registerSessionStop("fullscreen", generation, () => new Promise(resolve => { finishCallback = resolve; }));
  setNativePlaybackReleaseHandler(() => { nativeReleases += 1; });
  const stopped = stopFullscreenSession();
  const next = beginSession("fullscreen");
  finishCallback();
  await stopped;
  assert.equal(nativeReleases, 0);
  assert.equal(isSessionCurrent("fullscreen", next), true);
  setNativePlaybackReleaseHandler(null);
});
test("stale session events are rejected after channel generation bump", () => { resetPlaybackSessionsForTests(); const gen1 = beginSession("fullscreen"); assert.equal(setSessionPhase("fullscreen", gen1, "playing"), true); const gen2 = beginSession("fullscreen"); assert.equal(setSessionPhase("fullscreen", gen1, "failed", "stream-error"), false); assert.equal(getSessionPhase("fullscreen"), "preparing"); assert.equal(setSessionPhase("fullscreen", gen2, "playing"), true); });
test("pause preview callbacks do not invalidate generation", () => { resetPlaybackSessionsForTests(); const gen = beginSession("preview"); let stops = 0; registerSessionStop("preview", gen, () => { stops += 1; }); pauseSessionDecoders("preview"); assert.equal(stops, 1); assert.equal(isSessionCurrent("preview", gen), true); });
test("new generation drains stale callbacks exactly once", () => { resetPlaybackSessionsForTests(); const gen = beginSession("fullscreen"); let stops = 0; registerSessionStop("fullscreen", gen, () => { stops += 1; }); beginSession("fullscreen"); assert.equal(stops, 1); stopFullscreenSession(); assert.equal(stops, 1); });
test("preview cannot re-arm until fullscreen fully releases", async () => {
  resetPlaybackSessionsForTests();
  let releaseFullscreen;
  setNativePlaybackReleaseHandler((role) => role === "fullscreen" ? new Promise((resolve) => { releaseFullscreen = resolve; }) : undefined);
  beginSession("fullscreen");
  const stopped = stopFullscreenSession();
  assert.equal(isPreviewPlaybackAllowed(), false);
  assert.equal(beginSession("preview"), 0);
  await new Promise((resolve) => setImmediate(resolve));
  releaseFullscreen();
  await stopped;
  assert.equal(isPreviewPlaybackAllowed(), true);
  const preview = beginSession("preview");
  setNativePlaybackReleaseHandler(null);
  await stopAllPlaybackSessions();
  assert.equal(isSessionCurrent("preview", preview), false);
});

test("duplicate fullscreen stops share one native decoder teardown", async () => {
  resetPlaybackSessionsForTests();
  let releases = 0;
  let finishRelease;
  setNativePlaybackReleaseHandler((role) => {
    if (role !== "fullscreen") return undefined;
    releases += 1;
    return new Promise((resolve) => { finishRelease = resolve; });
  });
  beginSession("fullscreen");
  const first = stopFullscreenSession();
  const second = stopFullscreenSession();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases, 1);
  let waited = false;
  const waiter = waitForFullscreenRelease().then(() => { waited = true; });
  await Promise.resolve();
  assert.equal(waited, false);
  finishRelease();
  await Promise.all([first, second, waiter]);
  assert.equal(waited, true);
  setNativePlaybackReleaseHandler(null);
});

test("MPEG-TS routing preserves a transport hint into native Media3", () => {
  for (const uri of [
    "https://x/live.ts",
    "https://x/live.m2ts?token=1",
    "http://provider/live/123?output=ts",
    "http://provider/live/123?format=mpegts",
  ]) {
    const kind = detectStreamKind(uri);
    assert.equal(kind, "transport");
    assert.equal(media3ContentType(kind), "transport");
    assert.equal(preferredEngine(kind), "media3");
  }
});

test("automatic routing starts all Media3-supported live types in Media3", () => {
  assert.equal(preferredEngine(detectStreamKind("https://x/live.m3u8")), "media3");
  assert.equal(preferredEngine(detectStreamKind("https://x/live.ts")), "media3");
  assert.equal(preferredEngine(detectStreamKind("http://provider/live/u/p/1")), "media3");
  assert.equal(preferredEngine(detectStreamKind("rtsp://x/live")), "media3");
  assert.equal(preferredEngine(detectStreamKind("srt://x:9000")), null);
});

test("play entry points hand off through openFullscreenPlayer", async () => { const files = ["app/(tabs)/guide.tsx", "app/(tabs)/index.tsx", "app/(tabs)/favorites.tsx", "app/(tabs)/channels.tsx", "app/(tabs)/search.tsx", "src/components/ProgramModal.tsx", "src/components/PurpleChannelCollection.tsx", "app/_layout.tsx"]; for (const file of files) { const body = await source(file); assert.match(body, /openFullscreenPlayer/); assert.doesNotMatch(body, /pathname:\s*["']\/player["']/); } });

test("StreamPlayer commands one native engine through one serialized coordinator", async () => { const [adapter, native, coordinator, handoff] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("src/core/serializedPlaybackCoordinator.ts"), source("src/utils/openFullscreenPlayer.ts")]); assert.match(adapter, /prepareNativeFullscreen/); assert.match(adapter, /prepareNativePreview/); assert.doesNotMatch(adapter, /NativeVlc|nativeVlc|tryAutomaticVlcFallback/); assert.match(adapter, /activateNativePlaybackEngine/); assert.doesNotMatch(adapter, /stopNativePreview|stopNativeFullscreen|stopNativeVlcPreview|stopNativeVlcFullscreen/); assert.doesNotMatch(adapter, /VideoView|createVideoPlayer|VLCPlayer|react-native-vlc-media-player/); assert.match(coordinator, /let operation: Promise<void> = Promise\.resolve\(\)/); assert.match(coordinator, /if \(active.role !== role\) return/); assert.match(coordinator, /await stopNativeOwner\("media3", undefined, isCurrent\)/); assert.doesNotMatch(coordinator, /"vlc"/); assert.doesNotMatch(coordinator, /Promise\.all|Promise\.allSettled/); assert.match(native, /private var player: ExoPlayer\? = null/); assert.match(native, /R\.layout\.charm_player_view/); assert.match(native, /onRenderedFirstFrame/); assert.match(handoff, /waitForFullscreenRelease\(\)[\s\S]*?stopPreviewForFullscreen\(\)/); assert.doesNotMatch(handoff, /FULLSCREEN_HANDOFF_SETTLE_MS|PREVIEW_RELEASE_TIMEOUT_MS|Promise\.race/); });

test("fullscreen launched from Guide returns current tuned channel to the originating Guide group", async () => {
  const [guide, player] = await Promise.all([source("app/(tabs)/guide.tsx"), source("app/player.tsx")]);
  assert.match(guide, /openFullscreenPlayer\(router, channel\.id, \{ returnToGuide: true, returnGuideGroup: group \}\)/);
  assert.match(player, /pendingChannelIdRef\.current \|\| channelIdRef\.current/);
  assert.match(player, /const returnGuideGroup = String\(params\.returnGuideGroup \|\| ""\)\.trim\(\) \|\| "All"/);
  assert.match(player, /requestGuideJump\(\{ channelId: currentChannelId, group: returnGuideGroup \}\)/);
});

test("native player has no periodic playback watchdog", async () => {
  const [adapter, native] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt")]);
  assert.doesNotMatch(native, /RECONNECT_STALL_MS|WATCHDOG_POLL_MS|bufferingWatchdog|TRANSPORT_HUNG_BUFFER_REPREPARE_MS|HARD_STALL_RECOVERY_MS|silentAudioCheck/);
  assert.match(native, /START_TIMEOUT_MS = 30_000L/);
  assert.match(native, /if \(owner == Owner\.NONE \|\| firstFrameRendered \|\| pendingRecovery != null \|\| pendingSourceRefresh != null\) return@Runnable/);
  assert.match(native, /override fun onPlayerError[\s\S]*?scheduleRecovery\(/);
  assert.doesNotMatch(adapter, /player\.currentTime|setInterval|REBUFFER_REPREPARE_MS|silentResyncCountRef/);
});
