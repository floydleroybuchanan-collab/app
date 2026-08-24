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
  assert.match(native, /FULLSCREEN_START_TIMEOUT_MS = 12_000L/);
  assert.match(native, /PREVIEW_START_TIMEOUT_MS = 8_000L/);
  assert.match(native, /HUNG_BUFFER_REPREPARE_MS = 5_000L/);
  assert.match(native, /TRANSPORT_HUNG_BUFFER_REPREPARE_MS = 7_000L/);
  assert.match(native, /MAX_AUTO_RECOVERIES = 4/);
  assert.match(native, /RECOVERY_BACKOFF_MS = longArrayOf\(0L, 1_000L, 2_000L, 4_000L\)/);
  assert.match(native, /recoveryAttempts >= MAX_AUTO_RECOVERIES/);
  assert.match(native, /recoveryAttempts \+= 1/);
  assert.match(native, /main\.postDelayed\(delayedRecovery, delayMs\)/);
  assert.match(native, /instance\.prepare\(\)/);
  assert.match(native, /STABLE_REARM_MS = 30_000L/);
});

test("Media3 TS watchdog requires no progress before recovery", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /val madeProgress = bufferedPosition > bufferingLastBufferedPositionMs \|\| position > bufferingLastPositionMs/);
  assert.match(native, /if \(madeProgress\) \{[\s\S]*?bufferingSinceMs = nowMs/);
  assert.match(native, /val recoveryThresholdMs = if \(transport\) TRANSPORT_HUNG_BUFFER_REPREPARE_MS else HUNG_BUFFER_REPREPARE_MS/);
  assert.match(native, /recoverOnce\(instance, skipBarePrepare = transport\)/);
});

test("Media3 recovers bounded terminal live reads before exposing Retry", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /readTimeout\(5, TimeUnit\.SECONDS\)/);
  const playerError = native.match(/override fun onPlayerError\(error: PlaybackException\)[\s\S]*?\n\s*}/)?.[0] || "";
  assert.match(playerError, /rearmRecoveryAfterStablePlayback\(\)/);
  assert.match(playerError, /recordDiagnostic\("player-error", error, created\)/);
  assert.match(playerError, /forceFreshSource = isAuthenticationFailure\(error\)/);
  assert.match(playerError, /skipBarePrepare = activeSource\?\.sourceType == "transport"/);
  assert.doesNotMatch(playerError, /publishState\("error"/);
  assert.doesNotMatch(native, /Toast\.makeText|showDiagnostic\(/);
  assert.match(native, /private fun recoverOnce\(instance: ExoPlayer, forceFreshSource: Boolean = false, skipBarePrepare: Boolean = false\): Boolean/);
  assert.match(native, /private fun performRecovery\(instance: ExoPlayer\)/);
  assert.match(native, /private fun rearmRecoveryAfterStablePlayback\(\)/);
  assert.match(native, /if \(recoveryAttempts >= MAX_AUTO_RECOVERIES\)[\s\S]*?finishWithError\("stream-error", instance\)/);
  assert.match(native, /publishState\("loading", "native-reprepare"\)/);
  assert.match(native, /removeCallbacks\(delayedRecovery\)/);
});