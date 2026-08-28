import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as session from "../src/core/playbackSession.ts";
import { createPlaybackCoordinator } from "../src/core/serializedPlaybackCoordinator.ts";
import { requestPlayerExit } from "../src/core/playerExit.ts";

const handoffSource = await readFile(new URL("../src/utils/openFullscreenPlayer.ts", import.meta.url), "utf8");
const handoffCompiled = ts.transpileModule(handoffSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

// Exercise the actual registry, serialized coordinator, route helper and exit
// helper together. Native release timing/acknowledgement is deliberately fake;
// these tests do not claim to reproduce a device renderer release timeout.
async function fixture(role = "preview") {
  session.resetPlaybackSessionsForTests();
  const calls = [];
  const routes = [];
  const alerts = [];
  const releaseError = Object.assign(new Error("Media3 decoder release failed"), { code: "E_PLAYBACK_RELEASE" });
  const native = { owner: "none", ownerFailure: null, failRelease: false, releaseGate: null };
  const coordinator = createPlaybackCoordinator({
    owner: async () => { if (native.ownerFailure) throw native.ownerFailure; return native.owner; },
    stop: async (_engine, stoppedRole, releasePlayer) => {
      calls.push({ type: "stop", role: stoppedRole, releasePlayer });
      if (native.releaseGate) await native.releaseGate;
      if (native.failRelease) throw releaseError;
      native.owner = "none";
      calls.push({ type: "released", role: stoppedRole });
    },
    pause: () => calls.push({ type: "pause" }),
  });
  session.setNativePlaybackReleaseHandler(coordinator.release);
  if (role) {
    const generation = session.beginSession(role);
    await coordinator.activate(role, "media3", () => session.isSessionCurrent(role, generation), () => {
      native.owner = role;
      calls.push({ type: "prepare", role });
    });
  }
  const exports = {};
  const modules = {
    "@/src/core/playbackSession": session,
    "react-native": { Alert: { alert: (title, message) => alerts.push({ title, message }) } },
  };
  vm.runInNewContext(handoffCompiled, {
    exports,
    require(name) { assert.ok(name in modules, `Unexpected handoff dependency: ${name}`); return modules[name]; },
  }, { filename: "openFullscreenPlayer.test.js" });
  return {
    calls, routes, alerts, native, coordinator, releaseError,
    open(channelId = "next-channel") { exports.openFullscreenPlayer({ push: route => routes.push(route) }, channelId); },
  };
}

test("combined handoff waits for a successful native release before routing fullscreen", async () => {
  const f = await fixture();
  try {
    const release = deferred();
    f.native.releaseGate = release.promise;
    f.open();
    await flush();
    assert.equal(f.routes.length, 0);
    assert.equal(session.isPreviewPlaybackAllowed(), false);
    assert.equal(f.native.owner, "preview");
    release.resolve();
    await flush();
    assert.equal(f.routes.length, 1);
    assert.equal(f.routes[0].pathname, "/player");
    assert.equal(f.native.owner, "none");
    assert.equal(f.alerts.length, 0);
    assert.deepEqual(f.calls.map(call => call.type), ["prepare", "stop", "released"]);
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("a failed preview release cannot route fullscreen or silently permit another preview", async () => {
  const f = await fixture();
  try {
    f.native.failRelease = true;
    f.open();
    await flush();
    assert.equal(f.routes.length, 0, "release rejection must not be caught and followed by router.push");
    assert.equal(f.alerts.length, 1, "the blocked handoff must explain why playback did not open");
    assert.equal(f.native.owner, "preview");
    assert.deepEqual(f.coordinator.current(), { role: "preview", engine: "media3" });
    assert.equal(session.getSessionPhase("preview"), "failed");
    assert.equal(session.hasPlaybackReleaseFailure(), true);
    assert.equal(session.isPreviewPlaybackAllowed(), false);
    assert.equal(session.beginSession("preview"), 0);
    assert.equal(f.calls.filter(call => call.type === "prepare").length, 1);
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("failed fullscreen cleanup settles with its failure and keeps preview blocked", async () => {
  const f = await fixture("fullscreen");
  try {
    f.native.failRelease = true;
    const stopped = session.stopFullscreenSession();
    assert.equal(session.stopFullscreenSession(), stopped, "duplicate cleanup shares one native request");
    const outcome = await stopped;
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.error, f.releaseError);
    assert.equal(session.getSessionPhase("fullscreen"), "failed");
    assert.equal(session.hasPlaybackReleaseFailure(), true);
    assert.equal(session.isPreviewPlaybackAllowed(), false);
    assert.equal(f.native.owner, "fullscreen");
    assert.deepEqual(f.coordinator.current(), { role: "fullscreen", engine: "media3" });
    assert.equal(f.calls.filter(call => call.type === "stop").length, 1);
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("a later play attempt rechecks a failed fullscreen release and routes only after native acknowledges it", async () => {
  const f = await fixture("fullscreen");
  try {
    f.native.failRelease = true;
    await session.stopFullscreenSession();
    f.open("still-blocked");
    await flush();
    assert.equal(f.routes.length, 0);
    assert.equal(f.alerts.length, 1);
    assert.equal(f.native.owner, "fullscreen");
    assert.equal(session.isPreviewPlaybackAllowed(), false);
    // Model native observing actual cleanup completion, not elapsed JS time.
    f.native.failRelease = false;
    f.open("after-native-acknowledgement");
    await flush();
    assert.equal(f.routes.length, 1);
    assert.equal(f.routes[0].params.channelId, "after-native-acknowledgement");
    assert.equal(f.native.owner, "none");
    assert.equal(f.coordinator.current(), null);
    assert.equal(session.hasPlaybackReleaseFailure(), false);
    assert.equal(f.alerts.length, 1);
    assert.equal(f.calls.filter(call => call.type === "prepare").length, 1);
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("Back can leave after failed cleanup settles without declaring decoder release success", async () => {
  const f = await fixture("fullscreen");
  try {
    const release = deferred();
    f.native.releaseGate = release.promise;
    f.native.failRelease = true;
    let navigated = false;
    const pending = requestPlayerExit({
      inFlight: { current: false }, generation: { current: 1 }, isCurrentRoute: () => true,
      stop: session.stopFullscreenSession, navigate: () => { navigated = true; },
    });
    await flush();
    assert.equal(navigated, false);
    release.resolve();
    assert.equal(await pending, true);
    assert.equal(navigated, true);
    assert.equal(session.getSessionPhase("fullscreen"), "failed");
    assert.equal(session.isPreviewPlaybackAllowed(), false);
    assert.equal(f.native.owner, "fullscreen");
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("a superseded stop reports cancellation without claiming to have released the new session", async () => {
  const f = await fixture("fullscreen");
  try {
    const callback = deferred();
    session.registerSessionStop("fullscreen", session.getSessionGeneration("fullscreen"), () => callback.promise);
    const stopped = session.stopFullscreenSession();
    const next = session.beginSession("fullscreen");
    callback.resolve();
    const outcome = await stopped;
    assert.equal(outcome.status, "superseded");
    assert.equal(session.isSessionCurrent("fullscreen", next), true);
    assert.equal(session.getSessionPhase("fullscreen"), "preparing");
    assert.equal(f.calls.filter(call => call.type === "stop").length, 0);
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("repeated play commands share an in-flight failed release and only the latest request reports it", async () => {
  const f = await fixture();
  try {
    const release = deferred();
    f.native.releaseGate = release.promise;
    f.native.failRelease = true;
    f.open("first");
    await flush();
    f.open("latest");
    await flush();
    assert.equal(f.calls.filter(call => call.type === "stop").length, 1);
    release.resolve();
    await flush();
    assert.equal(f.routes.length, 0);
    assert.equal(f.alerts.length, 1);
    assert.equal(f.native.owner, "preview");
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("native acknowledgement clears a failed preview without leaving an abandoned fullscreen reservation", async () => {
  const f = await fixture();
  try {
    f.native.failRelease = true;
    f.open();
    await flush();
    assert.equal(session.isPreviewPlaybackAllowed(), false);
    assert.equal(session.hasPlaybackReleaseFailure(), true);
    f.native.failRelease = false;
    const outcome = await session.waitForPreviewRelease();
    assert.equal(outcome.status, "completed");
    assert.equal(f.native.owner, "none");
    assert.equal(session.isPreviewPlaybackAllowed(), true);
    assert.equal(session.hasPlaybackReleaseFailure(), false);
    assert.equal(f.routes.length, 0, "cleanup acknowledgement alone must not navigate an abandoned handoff");
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("synchronous ownership subscribers see the pending stop before the registry publishes idle", async () => {
  const f = await fixture("fullscreen");
  let unsubscribe = () => {};
  try {
    const release = deferred();
    f.native.releaseGate = release.promise;
    let observed;
    unsubscribe = session.subscribePlaybackOwnership(() => {
      if (observed) return;
      observed = { allowed: session.isPreviewPlaybackAllowed(), pending: session.waitForFullscreenRelease() };
    });
    const stopped = session.stopFullscreenSession();
    assert.equal(observed.allowed, false);
    assert.equal(observed.pending, stopped, "subscribers must wait for the actual release, not an already-resolved promise");
    release.resolve();
    assert.equal((await stopped).status, "completed");
    assert.equal(f.native.owner, "none");
  } finally { unsubscribe(); session.resetPlaybackSessionsForTests(); }
});

test("an explicit Play retries a failed preview release without needing a process or registry reset", async () => {
  const f = await fixture();
  try {
    f.native.failRelease = true;
    f.open("blocked");
    await flush();
    assert.equal(f.routes.length, 0);
    assert.equal(session.hasPlaybackReleaseFailure(), true);
    f.native.failRelease = false;
    f.open("released");
    await flush();
    assert.equal(f.routes.length, 1);
    assert.equal(f.routes[0].params.channelId, "released");
    assert.equal(session.hasPlaybackReleaseFailure(), false);
    assert.equal(f.native.owner, "none");
    assert.equal(f.coordinator.current(), null);
  } finally { session.resetPlaybackSessionsForTests(); }
});

test("explicit Play can clear both retained role failures after native acknowledges late cleanup", async () => {
  const f = await fixture(null);
  const snapshots = [];
  const unsubscribe = session.subscribePlaybackOwnership(() => snapshots.push(session.hasPlaybackReleaseFailure()));
  try {
    // JS reload has no active coordinator owner. Native getOwner rejects while
    // it cannot safely report ownership, so both cleanup requests retain failure.
    f.native.ownerFailure = f.releaseError;
    assert.equal((await session.stopAllPlaybackSessions()).status, "failed");
    assert.equal(session.hasPlaybackReleaseFailure(), true);
    const revision = session.getPlaybackOwnershipRevision();
    for (let i = 0; i < 20; i += 1) assert.equal(session.hasPlaybackReleaseFailure(), true);
    assert.equal(session.getPlaybackOwnershipRevision(), revision, "the failure snapshot must be read-only");
    f.open("still-releasing");
    await flush();
    assert.equal(f.routes.length, 0);
    assert.equal(f.alerts.length, 1);
    f.native.ownerFailure = null;
    f.open("cleanup-confirmed");
    await flush();
    assert.equal(f.routes.length, 1);
    assert.equal(f.routes[0].params.channelId, "cleanup-confirmed");
    assert.equal(session.hasPlaybackReleaseFailure(), false);
    assert.equal(f.coordinator.current(), null);
    assert.ok(snapshots.includes(true));
    assert.equal(snapshots.at(-1), false);
  } finally { unsubscribe(); session.resetPlaybackSessionsForTests(); }
});
