import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as session from "../src/core/playbackSession.ts";
import * as policy from "../src/core/streamPolicy.ts";
import { createPlaybackCoordinator } from "../src/core/serializedPlaybackCoordinator.ts";

const source = await readFile(new URL("../src/components/StreamPlayer.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

// Execute the production component's effects against fake native bindings.
// This tests prepare/control calls; it is not a React Native renderer or TV test.
function fixture(initial = {}, initialAppState = "active", options = {}) {
  session.resetPlaybackSessionsForTests();
  const calls = [];
  const slots = [];
  const appListeners = new Set();
  const nativeListeners = { state: new Set(), diagnostic: new Set(), refresh: new Set(), tracks: new Set() };
  let cursor = 0;
  let dirty = true;
  let effects = [];
  let nativeOwner = options.initialNativeOwner ?? "none";
  let focused = true;
  let appState = initialAppState;
  let confirmedType;
  let props = { uri: "https://provider.invalid/live/1", channelKey: "one", onStatus() {}, ...initial };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((item, i) => !Object.is(item, b[i]));
  const hooks = {
    createElement: (type, attributes, ...children) => ({ type, attributes, children }),
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) {
      const i = cursor++;
      slots[i] ??= { value: typeof value === "function" ? value() : value };
      return [slots[i].value, next => {
        const value = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useMemo(create, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: create(), deps };
      return slots[i].value;
    },
    useEffect(create, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) {
        effects.push({ i, create, cleanup: slots[i]?.cleanup });
        slots[i] = { deps, cleanup: undefined };
      }
    },
    useSyncExternalStore(subscribe, snapshot) {
      hooks.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return snapshot();
    },
  };
  const native = {
    nativePlaybackAvailable: () => true,
    prepareNativeFullscreen: (generation, channelKey, uri, headers, contentType, bufferProfile) => {
      nativeOwner = "fullscreen";
      calls.push({ type: "prepare", generation, channelKey, uri, headers, contentType, bufferProfile });
      if (options.synchronousPrepareState) {
        for (const listener of nativeListeners.state) listener({ owner: nativeOwner, generation, channelKey, state: options.synchronousPrepareState });
      }
    },
    prepareNativePreview: (generation, channelKey, uri, headers, contentType, bufferProfile) => {
      nativeOwner = "preview";
      calls.push({ type: "prepare", generation, channelKey, uri, headers, contentType, bufferProfile });
      if (options.synchronousPrepareState) {
        for (const listener of nativeListeners.state) listener({ owner: nativeOwner, generation, channelKey, state: options.synchronousPrepareState });
      }
    },
    pauseNativePlayback: () => calls.push({ type: "pause" }),
    resumeNativePlayback: () => calls.push({ type: "resume" }),
    setNativePlaybackMuted: value => calls.push({ type: "mute", value }),
    setNativePlaybackResizeMode: value => calls.push({ type: "resize", value }),
    selectNativeAudio: () => calls.push({ type: "audio" }),
    selectNativeSubtitle: () => calls.push({ type: "subtitle" }),
    resolveNativePlaybackFreshSource: () => calls.push({ type: "source-refresh" }),
  };
  for (const [name, kind] of [
    ["addNativePlaybackStateListener", "state"], ["addNativePlaybackDiagnosticListener", "diagnostic"],
    ["addNativePlaybackSourceRefreshListener", "refresh"], ["addNativePlaybackTracksListener", "tracks"],
  ]) native[name] = listener => { nativeListeners[kind].add(listener); return () => nativeListeners[kind].delete(listener); };
  const coordinator = createPlaybackCoordinator({
    owner: async () => { if (options.waitForOwner) await options.waitForOwner; return nativeOwner; },
    stop: async (_engine, role) => {
      calls.push({ type: "stop", role });
      if (options.releaseFailure) throw options.releaseFailure;
      nativeOwner = "none";
    },
    pause: () => native.pauseNativePlayback(),
  });
  const modules = {
    react: hooks,
    "react-native": {
      AppState: {
        get currentState() { return appState; },
        addEventListener(_event, listener) { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; },
      },
      Platform: { OS: "android", isTV: true }, requireNativeComponent: name => name, View: "View",
    },
    "@react-navigation/native": { useIsFocused: () => focused },
    "@/src/core/streamPolicy": policy,
    "@/src/core/playbackSession": session,
    "@/src/core/nativePlaybackCoordinator": {
      activateNativePlaybackEngine: coordinator.activate, pauseActiveNativePlayback: coordinator.pause,
      releaseNativePlaybackRole: coordinator.release, runNativePlaybackCommand: coordinator.command,
    },
    "@/src/nativePlayback": native,
    "@/src/playerEnginePreference": { getPlayerEnginePreference: () => "media3" },
    "@/src/core/playbackProfileIndex": {
      getChannelPlaybackProfile: () => ({ confirmedType }), rememberDeclaredStreamType() {},
      rememberConfirmedStreamType() {}, rememberPlaybackEngine() {}, invalidateConfirmedStreamType() {},
    },
    "@/src/core/audioTrackPreferences": { getPreferredAudioLanguage: () => "", getRememberedChannelAudioTrack: () => undefined },
    "@/src/utils/tvRemote": { setNativePlaybackStarting() {} },
    "@/src/source": { refreshPlaybackChannel: async () => null },
    "@/src/core/audioDiagnostics": { fingerprintStreamUri: () => "redacted", recordAudioDiagnostics() {} },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) { assert.ok(name in modules, "Unexpected component dependency: " + name); return modules[name]; },
  }, { filename: "StreamPlayer.test.js" });
  async function flush() {
    for (let pass = 0; pass < 30; pass += 1) {
      if (dirty) {
        dirty = false; cursor = 0; effects = [];
        exports.StreamPlayer(props);
        for (const effect of effects) effect.cleanup?.();
        for (const effect of effects) slots[effect.i].cleanup = effect.create();
      }
      if (dirty && options.renderBeforeNativeCommands) continue;
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty) return;
    }
    assert.fail("Playback effects did not settle");
  }
  return {
    calls, flush,
    update(next = {}) { props = { ...props, ...next }; dirty = true; return flush(); },
    background(state) { appState = state; for (const listener of appListeners) listener(state); return flush(); },
    focus(value) { focused = value; dirty = true; return flush(); },
    confirm(value) { confirmedType = value; dirty = true; return flush(); },
    emit(state, reason = null) {
      const latest = calls.filter(call => call.type === "prepare").at(-1);
      assert.ok(latest);
      for (const listener of nativeListeners.state) listener({
        owner: nativeOwner, generation: latest.generation, channelKey: latest.channelKey, state, reason,
      });
      return flush();
    },
    async unmount() {
      for (const slot of slots) slot?.cleanup?.();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test("cold fullscreen prepares with null AppState and synchronous native loading or playing callbacks", async () => {
  for (const appState of [null, "active", "inactive"]) {
    for (const synchronousPrepareState of ["loading", "playing"]) {
      const player = fixture({}, appState, { synchronousPrepareState, renderBeforeNativeCommands: true });
      await player.flush();
      assert.equal(player.calls.filter(call => call.type === "prepare").length, 1, `${appState}/${synchronousPrepareState}: prepare`);
      assert.equal(player.calls.filter(call => call.type === "pause").length, 0, `${appState}/${synchronousPrepareState}: no pause`);
      assert.equal(player.calls.filter(call => call.type === "resume").length, 1, `${appState}/${synchronousPrepareState}: resume`);
      await player.unmount();
    }
  }
});

test("blocked preview renders do not retry a failed release or prepare another player in a loop", async () => {
  const player = fixture({ mode: "preview", sessionRole: "preview" }, "active", {
    releaseFailure: Object.assign(new Error("Native release is still blocked"), { code: "E_PLAYBACK_RELEASE" }),
    renderBeforeNativeCommands: true,
  });
  await player.flush();
  const stopped = session.stopPreviewSession();
  await player.flush();
  assert.equal((await stopped).status, "failed");
  assert.equal(session.hasPlaybackReleaseFailure(), true);
  const stops = player.calls.filter(call => call.type === "stop").length;
  for (let i = 0; i < 20; i += 1) await player.update({ onStatus() {}, style: { width: 320 + i } });
  assert.equal(player.calls.filter(call => call.type === "stop").length, stops);
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 1);
  await player.unmount();
});

test("cold fullscreen waits for a stale native owner, then releases and prepares without a pause", async () => {
  let resolveOwner;
  const waitForOwner = new Promise(resolve => { resolveOwner = resolve; });
  const player = fixture({}, null, { initialNativeOwner: "preview", waitForOwner, synchronousPrepareState: "loading", renderBeforeNativeCommands: true });
  await player.flush();
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 0);
  resolveOwner();
  await player.flush();
  const transport = player.calls.filter(call => ["stop", "prepare", "pause", "resume"].includes(call.type));
  assert.deepEqual(transport.map(call => call.type), ["stop", "prepare", "resume"]);
  assert.equal(transport[0].role, "preview");
  await player.unmount();
});

test("repeated clock, status, and learned-profile renders leave a healthy source prepared once", async () => {
  const player = fixture();
  await player.flush();
  for (let i = 0; i < 20; i += 1) {
    await player.emit("loading");
    await player.emit("playing");
    await player.update({ onStatus() {}, style: { width: 1280 + i } });
  }
  await player.confirm("hls");
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 1);
  assert.equal(player.calls.filter(call => call.type === "stop").length, 0);
  await player.unmount();
});

test("classification metadata cannot retune an unchanged URL, but the next source uses the updated hint", async () => {
  const player = fixture({ streamTypeHint: "unknown" });
  await player.flush();
  await player.emit("playing");
  await player.update({ streamTypeHint: "hls" });
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 1);
  await player.update({ uri: "https://provider.invalid/live/2", channelKey: "two" });
  const prepares = player.calls.filter(call => call.type === "prepare");
  assert.equal(prepares.length, 2);
  assert.equal(prepares[1].contentType, "hls");
  await player.unmount();
});

test("fullscreen background and foreground pause/resume the same native generation without preparing again", async () => {
  const player = fixture();
  await player.flush();
  await player.emit("playing");
  const first = player.calls.find(call => call.type === "prepare");
  const start = player.calls.length;
  await player.background("background");
  await player.background("active");
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 1);
  assert.equal(session.isSessionCurrent("fullscreen", first.generation), true);
  assert.equal(player.calls.slice(start).filter(call => call.type === "pause").length, 1);
  assert.equal(player.calls.slice(start).filter(call => call.type === "resume").length, 1);
  await player.unmount();
});

test("aspect and mute updates never issue resume or pause commands", async () => {
  const player = fixture();
  await player.flush();
  const start = player.calls.length;
  await player.update({ scaleMode: "zoom" });
  await player.update({ muted: true });
  assert.equal(player.calls.slice(start).filter(call => call.type === "resume" || call.type === "pause").length, 0);
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 1);
  await player.unmount();
});

test("foregrounding a manually paused stream does not resume or reprepare it", async () => {
  const player = fixture({ paused: true });
  await player.flush();
  const start = player.calls.length;
  await player.background("background");
  await player.background("active");
  assert.equal(player.calls.slice(start).filter(call => call.type === "resume").length, 0);
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 1);
  await player.unmount();
});

test("a fullscreen component first mounted in background waits for foreground before preparing", async () => {
  const player = fixture({}, "background");
  await player.flush();
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 0);
  await player.background("active");
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 1);
  await player.unmount();
});

test("foreground and overlay focus changes cannot revive an explicitly stopped fullscreen session", async () => {
  const player = fixture();
  await player.flush();
  await session.stopFullscreenSession();
  const start = player.calls.length;
  await player.background("background");
  await player.background("active");
  await player.focus(false);
  await player.focus(true);
  assert.equal(player.calls.slice(start).filter(call => call.type === "prepare" || call.type === "resume").length, 0);
  await player.unmount();
});

test("preview still releases on Guide blur instead of preserving a background decoder", async () => {
  const player = fixture({ sessionRole: "preview" });
  await player.flush();
  await player.focus(false);
  assert.equal(player.calls.filter(call => call.type === "stop").length, 1);
  await player.focus(true);
  assert.equal(player.calls.filter(call => call.type === "prepare").length, 2);
  await player.unmount();
});
