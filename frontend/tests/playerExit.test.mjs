import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requestPlayerExit } from "../src/core/playerExit.ts";
import * as session from "../src/core/playbackSession.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const release = deferred();
  const calls = [];
  const inFlight = { current: false };
  const generation = { current: 10 };
  let routeRevision = 0;
  let focused = true;
  const options = {
    inFlight,
    generation,
    isCurrentRoute: () => routeRevision === 0 && focused,
    stop: () => { calls.push("stop"); return release.promise; },
    navigate: () => calls.push("navigate"),
  };
  return { options, release, calls, inFlight, generation, replaceRoute: () => { routeRevision += 1; }, focus: (value) => { focused = value; } };
}

test("Guide and Settings exits await native cleanup and repeated commands share one exit", async () => {
  const f = fixture();
  const pending = requestPlayerExit(f.options);
  assert.deepEqual(f.calls, ["stop"]);
  assert.equal(f.inFlight.current, true);
  assert.equal(await requestPlayerExit(f.options), false);
  assert.deepEqual(f.calls, ["stop"]);
  f.release.resolve();
  assert.equal(await pending, true);
  assert.deepEqual(f.calls, ["stop", "navigate"]);
  assert.equal(f.inFlight.current, true, "successful navigation retains exit ownership for unmount cleanup");
});

test("route replacement during delayed cleanup suppresses navigation and clears only the stale exit", async () => {
  const f = fixture();
  const pending = requestPlayerExit(f.options);
  f.replaceRoute();
  f.release.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(f.calls, ["stop"]);
  assert.equal(f.inFlight.current, false);
});

test("a same-route focus roundtrip before cleanup completes does not cancel the requested exit", async () => {
  const f = fixture();
  const pending = requestPlayerExit(f.options);
  f.focus(false);
  f.focus(true);
  f.release.resolve();
  assert.equal(await pending, true);
  assert.deepEqual(f.calls, ["stop", "navigate"]);
});

test("a newer channel generation cancels the old exit and can subsequently exit normally", async () => {
  const f = fixture();
  const pending = requestPlayerExit(f.options);
  f.generation.current += 1;
  f.release.resolve();
  assert.equal(await pending, false);
  assert.equal(f.inFlight.current, false);
  assert.deepEqual(f.calls, ["stop"]);
  assert.equal(await requestPlayerExit({ ...f.options, stop: async () => {} }), true);
  assert.deepEqual(f.calls, ["stop", "navigate"]);
});

test("an old completion cannot clear a newer exit's in-flight flag", async () => {
  const f = fixture();
  const first = requestPlayerExit(f.options);
  f.generation.current += 1;
  f.inFlight.current = false;
  const nextRelease = deferred();
  const second = requestPlayerExit({ ...f.options, stop: () => nextRelease.promise });
  f.release.resolve();
  assert.equal(await first, false);
  assert.equal(f.inFlight.current, true);
  assert.deepEqual(f.calls, ["stop"]);
  nextRelease.resolve();
  assert.equal(await second, true);
  assert.equal(f.inFlight.current, true);
  assert.deepEqual(f.calls, ["stop", "navigate"]);
});

test("the intentional session generation change from Stop does not cancel a valid screen exit", async () => {
  session.resetPlaybackSessionsForTests();
  const f = fixture();
  const nativeGeneration = session.beginSession("fullscreen");
  session.setNativePlaybackReleaseHandler(() => f.release.promise);
  try {
    const pending = requestPlayerExit({ ...f.options, stop: session.stopFullscreenSession });
    assert.equal(session.getSessionGeneration("fullscreen"), nativeGeneration + 1);
    f.release.resolve();
    assert.equal(await pending, true);
    assert.deepEqual(f.calls, ["navigate"]);
  } finally {
    session.resetPlaybackSessionsForTests();
  }
});

test("replacement-route tuning waits for Stop and observes the old exit flag already cleared", async () => {
  session.resetPlaybackSessionsForTests();
  const f = fixture();
  session.beginSession("fullscreen");
  session.setNativePlaybackReleaseHandler(() => f.release.promise);
  try {
    const pending = requestPlayerExit({ ...f.options, stop: session.stopFullscreenSession });
    f.replaceRoute();
    const tune = session.waitForFullscreenRelease().then(() => {
      assert.equal(f.inFlight.current, false);
      f.calls.push("new-tune");
      session.beginSession("fullscreen");
    });
    assert.deepEqual(f.calls, []);
    f.release.resolve();
    assert.equal(await pending, false);
    await tune;
    assert.deepEqual(f.calls, ["new-tune"]);
  } finally {
    session.resetPlaybackSessionsForTests();
  }
});

test("a stale request never stops playback and a rejected stop never claims successful navigation", async () => {
  const f = fixture();
  assert.equal(await requestPlayerExit({ ...f.options, isCurrentRoute: () => false }), false);
  assert.deepEqual(f.calls, []);
  const pending = requestPlayerExit(f.options);
  f.release.reject(new Error("release failed"));
  await assert.rejects(pending, /release failed/);
  assert.equal(f.inFlight.current, false);
  assert.deepEqual(f.calls, ["stop"]);
});

test("fullscreen Quick Actions delegate exits while Guide Settings retains normal routing", async () => {
  const overlay = await readFile(new URL("../src/components/TvQuickActionsOverlay.tsx", import.meta.url), "utf8");
  for (const [name, command, route] of [["goGuide", "GO_GUIDE", "guide"], ["openSettings", "OPEN_SETTINGS", "settings"]]) {
    const handler = overlay.slice(overlay.indexOf(`const ${name} = useCallback`));
    assert.match(handler, new RegExp(`if \\(context === "player"\\) \\{ runPlayerCommand\\("${command}"\\); return; \\}\\s*close\\(\\);\\s*router.replace\\("/${route}" as any\\)`));
  }
  const deferredCommand = overlay.slice(overlay.indexOf("const afterPlayerOverlayClose"), overlay.indexOf("const runPlayerCommand"));
  assert.match(deferredCommand, /generation === overlayGeneration.current/);
  assert.match(deferredCommand, /playbackGeneration === getSessionGeneration\("fullscreen"\)/);
  assert.match(deferredCommand, /pathnameRef.current === path && acceptsQuickActionsContext\(path, "player"\)/);
});

test("PlayerScreen shares awaited exit ownership and validates live route identity", async () => {
  const player = await readFile(new URL("../app/player.tsx", import.meta.url), "utf8");
  assert.match(player, /void requestPlayerExit\(\{/);
  assert.match(player, /inFlight: exitInFlightRef,[\s\S]*?generation: generationRef/);
  assert.match(player, /stop: stopFullscreenSession/);
  assert.match(player, /isCurrentRoute: \(\) => mountedRef.current && exitRouteRef.current.revision === routeRevision/);
  assert.match(player, /const routeIdentityChanged = previousRoute.pathname !== pathname \|\| previousRoute.channelId !== params.channelId/);
  assert.match(player, /focused: routeFocused, channelId: params.channelId, revision: previousRoute.revision \+ \(routeIdentityChanged \? 1 : 0\)/);
  assert.doesNotMatch(player, /previousRoute.focused !== routeFocused/);
  assert.match(player, /void requestPlayerExit\([\s\S]*?\}\).catch\(\(\) => undefined\)/);
  assert.match(player, /mountedRef.current = false; generationRef.current \+= 1/);
  assert.match(player, /command === "GO_GUIDE"\) return goGuide\(\)/);
  assert.match(player, /command === "OPEN_SETTINGS"\) return openSettings\(\)/);
  assert.match(player, /exitPlayer\(\(\) => router.replace\("\/settings" as any\)\)/);
  assert.match(player, /exitPlayer\(\(\) => router.replace\("\/" as any\)\)/);
  assert.match(player, /if \(exitInFlightRef.current\) void waitForFullscreenRelease\(\).then\(applyRouteChannel\)/);
  assert.match(player, /if \(canceled \|\| !mountedRef.current \|\| exitInFlightRef.current/);
  assert.match(player, /String\(exitRouteRef.current.channelId \|\| ""\).trim\(\) !== routeChannelId/);
});
