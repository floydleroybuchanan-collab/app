import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("Media3 publishes stable playback only after native onRenderedFirstFrame", async () => {
  const [native, adapter] = await Promise.all([source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("src/components/StreamPlayer.tsx")]);
  const firstFrame = native.match(/override fun onRenderedFirstFrame\(\)[\s\S]*?\n\s*}/)?.[0] || "";
  assert.match(firstFrame, /firstFrameRendered = true/);
  assert.match(firstFrame, /removeCallbacks\(delayedRecovery\)/);
  assert.match(firstFrame, /publishState\("playing", null\)/);
  assert.match(adapter, /event\.state === "playing"/);
  assert.match(adapter, /setSessionPhase\(role, generation, "playing"\)/);
  assert.doesNotMatch(adapter, /onFirstFrameRender|readyToPlay|player\.currentTime/);
});

test("Media3 keeps bounded startup and event-driven recovery without a lifetime network cap", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /START_TIMEOUT_MS = 30_000L/);
  assert.match(native, /OPAQUE_CONFIRM_MS = 5_000L/);
  assert.doesNotMatch(native, /FULLSCREEN_START_TIMEOUT_MS|PREVIEW_START_TIMEOUT_MS|TRANSPORT_HUNG_BUFFER_REPREPARE_MS|HARD_STALL_RECOVERY_MS|STABLE_REARM_MS/);
  assert.match(native, /recoveryPolicy\.decide\(failure, SystemClock\.elapsedRealtime\(\)\)/);
  assert.match(native, /main\.postDelayed\(delayedRecovery, decision\.delayMs\)/);
  assert.match(native, /decision\.action == Action\.STOP/);
  assert.match(native, /pendingRecovery = PendingRecovery\(instance, playbackRevision, decision, resumePosition\)/);
  assert.match(native, /main\.postDelayed\(delayedRecovery, decision\.delayMs\)/);
  assert.match(native, /fullPlayerAndSourceRecovery\(instance, source, pending\.resumePositionMs\)/);
  assert.doesNotMatch(native, /RECONNECT_STALL_MS|bufferingWatchdog|MAX_AUTO_RECOVERIES|RECOVERY_BACKOFF_MS|silentAudioCheck/);
});

test("Media3 never polls healthy playback to decide on recovery", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.doesNotMatch(native, /bufferingLastPositionMs|hungForMs|RECONNECT_STALL_MS|WATCHDOG_POLL_MS|bufferingWatchdog/);
  assert.match(native, /override fun onPlayerError[\s\S]*?scheduleRecovery\(/);
  assert.match(native, /Player\.STATE_ENDED -> \{[\s\S]*?scheduleRecovery\(/);
});

test("Media3 recovers transient live reads without a terminal attempt limit", async () => {
  const [native, clients] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CharmHttpClients.kt"),
  ]);
  assert.match(clients, /readTimeout\(20, TimeUnit.SECONDS\)/);
  assert.match(native, /CharmHttpClients\.mediaClient\(\)/);
  const playerError = native.match(/override fun onPlayerError\(error: PlaybackException\)[\s\S]*?\n\s*}/)?.[0] || "";
  assert.doesNotMatch(playerError, /rearmRecoveryAfterStablePlayback\(\)/);
  assert.match(playerError, /recordDiagnostic\("player-error", error, created\)/);
  assert.match(playerError, /scheduleRecovery\(created, classifyFailure\(error\)\)/);
  assert.doesNotMatch(playerError, /publishState\("error"/);
  assert.doesNotMatch(native, /Toast\.makeText|showDiagnostic\(/);
  assert.match(native, /private fun scheduleRecovery\(instance: ExoPlayer, failure: Failure\): Boolean/);
  assert.match(native, /private fun performRecovery\(pending: PendingRecovery\)/);
  assert.doesNotMatch(native, /private fun rearmRecoveryAfterStablePlayback\(\)/);
  assert.match(native, /if \(decision\.action == Action\.STOP\)[\s\S]*?finishWithError\("stream-error", instance\)/);
  assert.match(native, /publishState\("loading", "native-reprepare"\)/);
  assert.match(native, /removeCallbacks\(delayedRecovery\)/);
  const firstFrame = native.match(/override fun onRenderedFirstFrame\(\)[\s\S]*?\n\s*}/)?.[0] || "";
  assert.doesNotMatch(firstFrame, /recoveryAttempts = 0/);
});
