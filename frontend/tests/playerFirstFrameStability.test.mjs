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

test("Media3 keeps bounded native startup and four-attempt post-playback recovery", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /START_TIMEOUT_MS = 60_000L/);
  assert.match(native, /RECONNECT_STALL_MS = 50_000L/);
  assert.match(native, /OPAQUE_CONFIRM_MS = 5_000L/);
  assert.doesNotMatch(native, /FULLSCREEN_START_TIMEOUT_MS|PREVIEW_START_TIMEOUT_MS|TRANSPORT_HUNG_BUFFER_REPREPARE_MS|HARD_STALL_RECOVERY_MS|STABLE_REARM_MS/);
  assert.match(native, /MAX_AUTO_RECOVERIES = 4/);
  assert.match(native, /RECOVERY_BACKOFF_MS = longArrayOf\(0L, 1_000L, 3_000L, 6_000L\)/);
  assert.match(native, /recoveryAttempts >= MAX_AUTO_RECOVERIES/);
  assert.match(native, /recoveryAttempts \+= 1/);
  assert.match(native, /main\.postDelayed\(delayedRecovery, delayMs\)/);
  assert.match(native, /instance\.prepare\(\)/);
});

test("Media3 reconnect watchdog requires no progress before recovery", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /val madeProgress = instance\.isPlaying \|\|/);
  assert.match(native, /position != C\.TIME_UNSET && position > bufferingLastPositionMs/);
  assert.match(native, /if \(hungForMs < RECONNECT_STALL_MS\)/);
  assert.match(native, /recoverOnce\(instance, skipBarePrepare = false\)/);
});

test("Media3 recovers bounded terminal live reads before exposing Retry", async () => {
  const [native, clients] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CharmHttpClients.kt"),
  ]);
  assert.match(clients, /readTimeout\(0, TimeUnit.SECONDS\)/);
  assert.match(native, /CharmHttpClients\.mediaClient\(\)/);
  const playerError = native.match(/override fun onPlayerError\(error: PlaybackException\)[\s\S]*?\n\s*}/)?.[0] || "";
  assert.doesNotMatch(playerError, /rearmRecoveryAfterStablePlayback\(\)/);
  assert.match(playerError, /recordDiagnostic\("player-error", error, created\)/);
  assert.match(playerError, /forceFreshSource = isAuthenticationFailure\(error\)/);
  assert.match(playerError, /skipBarePrepare = isContainerMismatch\(error\)/);
  assert.doesNotMatch(playerError, /publishState\("error"/);
  assert.doesNotMatch(native, /Toast\.makeText|showDiagnostic\(/);
  assert.match(native, /private fun recoverOnce\(instance: ExoPlayer, forceFreshSource: Boolean = false, skipBarePrepare: Boolean = false\): Boolean/);
  assert.match(native, /private fun performRecovery\(instance: ExoPlayer\)/);
  assert.doesNotMatch(native, /private fun rearmRecoveryAfterStablePlayback\(\)/);
  assert.match(native, /if \(recoveryAttempts >= MAX_AUTO_RECOVERIES\)[\s\S]*?finishWithError\("stream-error", instance\)/);
  assert.match(native, /publishState\("loading", "native-reprepare"\)/);
  assert.match(native, /removeCallbacks\(delayedRecovery\)/);
});