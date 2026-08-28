import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const native = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt", import.meta.url), "utf8");
const bridge = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt", import.meta.url), "utf8");

test("ordinary rebuffering never spends a retry or schedules source destruction", () => {
  const buffering = native.slice(native.indexOf("Player.STATE_BUFFERING -> {"), native.indexOf("Player.STATE_READY -> {"));
  assert.match(buffering, /publishState\("loading", null\)/);
  assert.doesNotMatch(buffering, /scheduleRecovery|postDelayed|finishWithError|releaseDecoder|rebuildMediaSource|\.decide\(/);
  const startup = native.slice(native.indexOf("private val startupTimeout"), native.indexOf("private val delayedRecovery"));
  assert.match(startup, /hasPlayedThisTune \|\| recoveringNetwork/);
  assert.match(startup, /instance.playbackState == Player.STATE_BUFFERING\) return@Runnable/);
});

test("transient network recovery retains the player and finite VOD position", () => {
  const recovery = native.slice(native.indexOf("Action.REPREPARE_SOURCE -> {"), native.indexOf("Action.REBUILD_PLAYER ->"));
  assert.match(recovery, /rebuildMediaSource\(instance, source, "network-source-recovery", pending.resumePositionMs\)/);
  assert.doesNotMatch(recovery, /releaseDecoder|ensurePlayer|fullPlayerAndSourceRecovery/);
  assert.match(native, /if \(lastKnownLive \|\| isLivePlayback\(instance\)\) null else instance.currentPosition/);
  assert.match(native, /else instance.setMediaSource\(mediaSource, resumePositionMs\)/);
});

test("retired source callbacks cannot stop or confirm a new tune on the reused player", () => {
  assert.match(native, /val revision = playbackRevision/);
  assert.match(native, /player === created && playbackRevision == revision && owner != Owner.NONE && activeSource != null/);
  assert.match(native, /playbackListener\?\.let \{ created.removeListener\(it\) \}/);
  assert.match(native, /analyticsListener\?\.let \{ created.removeAnalyticsListener\(it\) \}/);
  assert.match(native, /created.playerError !== error/);
  assert.match(native, /pendingRecovery !== pending[\s\S]*?playbackRevision != pending.revision/);
  const rebuild = native.slice(native.indexOf("private fun rebuildMediaSource("), native.indexOf("private fun buildMediaItem("));
  assert.ok(rebuild.indexOf("playbackRevision += 1") < rebuild.indexOf("instance.stop()"));
  assert.ok(rebuild.indexOf("bindPlaybackCallbacks(instance)") < rebuild.indexOf("instance.setMediaSource"));
});

test("a queued frame after a player error cannot cancel the required reconnect", () => {
  const frame = native.slice(native.indexOf("override fun onRenderedFirstFrame()"), native.indexOf("override fun onPlayerError("));
  assert.match(frame, /created.playerError != null/);
  assert.match(frame, /Player.STATE_IDLE/);
  assert.match(frame, /Player.STATE_ENDED/);
  assert.ok(frame.indexOf("return") < frame.indexOf("pendingRecovery = null"));
});

test("manual pause prevents delayed recovery and startup deadlines from resuming playback", () => {
  const pause = native.slice(native.indexOf("fun pause()"), native.indexOf("fun resume()"));
  assert.match(pause, /userPaused = true/);
  assert.match(pause, /removeCallbacks\(delayedRecovery\)/);
  assert.match(pause, /removeCallbacks\(startupTimeout\)/);
  assert.match(native, /if \(userPaused\) return false[\s\S]*?pendingRecovery = null/);
  assert.doesNotMatch(native, /(?:instance|created).playWhenReady = true/);
  assert.match(native, /instance.playWhenReady = !userPaused/);
});

test("rejecting late preview does not overwrite the fullscreen bridge identity", () => {
  const preview = bridge.slice(bridge.indexOf("fun preparePreview("), bridge.indexOf("@ReactMethod fun resolveFreshSource"));
  const rejection = preview.slice(preview.indexOf("if (NativePlaybackManager.currentOwner()"), preview.indexOf("attachActivity()"));
  assert.match(rejection, /putString\("owner", "preview"\)/);
  assert.match(rejection, /putDouble\("generation", generation\)/);
  assert.match(rejection, /putString\("reason", "owner-reserved"\)/);
  assert.match(rejection, /return@onMain/);
  assert.doesNotMatch(rejection, /setIdentity/);
});

test("the active JavaScript downloader bridges cookies before React Native starts", async () => {
  const app = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/MainApplication.kt", import.meta.url), "utf8");
  const setup = app.slice(app.indexOf("override fun onCreate()"));
  assert.ok(setup.indexOf("OkHttpClientProvider.setOkHttpClientFactory") < setup.indexOf("loadReactNative(this)"));
  assert.match(setup, /CharmHttpClients.bridgeReactNativeCookies\(OkHttpClientProvider.createClientBuilder\(\).build\(\)\)/);
});

test("an established source cannot rotate containers after a damaged segment or recovery stall", () => {
  const route = native.slice(native.indexOf("private fun advanceOpaqueCandidate("), native.indexOf("private fun buildOpaqueAttempts("));
  assert.match(route, /if \(hasPlayedThisTune && \(firstFrameRendered \|\| recoveringNetwork\)\) return false/);
  assert.ok(route.indexOf("return false") < route.indexOf("opaqueRouteIndex = nextIndex"));
  assert.match(native, /isEstablishedLive = hasPlayedThisTune && lastKnownLive/);
});

test("learning a container cannot reprepare the active stream through a profile subscription", async () => {
  const player = await readFile(new URL("../src/components/StreamPlayer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(player, /useChannelPlaybackProfile/);
  const hint = player.slice(player.indexOf("const learnedHint = useMemo("), player.indexOf("const kind = useMemo("));
  assert.match(hint, /getChannelPlaybackProfile\(currentChannelKey\)\?\.confirmedType/);
  assert.match(hint, /\}, \[currentChannelKey, sourceTypeHint, uri\]\);/);
  assert.match(player, /sourceTypeHintRef.current.key !== playbackKey/);
  // Learned information remains available to the next explicit tune.
  assert.match(player, /rememberConfirmedStreamType\(currentChannelKey, event.sourceType, "media3"\)/);
});
