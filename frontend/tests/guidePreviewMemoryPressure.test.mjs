import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const guideSource = await readFile(new URL("../app/(tabs)/guide.tsx", import.meta.url), "utf8");
const guideAst = ts.createSourceFile("guide.tsx", guideSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode(root, predicate) {
  let found;
  const visit = (node) => {
    if (found) return;
    if (predicate(node)) { found = node; return; }
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(found, "the actual production callback must exist");
  return found;
}

function callback(name) {
  const declaration = findNode(guideAst, node => ts.isVariableDeclaration(node) && node.name.getText(guideAst) === name);
  assert.ok(ts.isCallExpression(declaration.initializer));
  return `const ${name} = ${declaration.initializer.getText(guideAst)};`;
}

function pressureCallback(ast) {
  return findNode(ast, node => ts.isCallExpression(node) && node.expression.getText(ast) === "subscribeAndroidMemoryPressure")
    .arguments[0].getText(ast);
}

const lifecycle = findNode(guideAst, node => ts.isCallExpression(node) && node.expression.getText(guideAst) === "useEffect" &&
  node.arguments[0]?.getText(guideAst).includes("const lifecycle = runwayLifecycleRef.current"));

function compile(code) {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
}

function fixture({ playing = false } = {}) {
  const channels = new Map(["a", "b"].map(id => [id, { id, name: id, url: `https://example.invalid/${id}.ts` }]));
  const timers = new Map();
  let nextTimer = 0;
  const stops = [];
  const cacheReleases = [];
  const previewWrites = [];
  const ref = current => ({ current });
  const context = {
    useCallback: fn => fn,
    guideForeground: true,
    guideForegroundRef: ref(true),
    guideSessionChannelId: "a",
    guideSessionGroup: "All",
    guideSessionChannelByGroup: new Map([["All", "a"]]),
    previewId: playing ? "a" : null,
    previewStatus: playing ? "playing" : "loading",
    previewMemoryPaused: false,
    previewMemoryPauseRef: ref(null),
    previewRequestGenerationRef: ref(0),
    previewTimer: ref(null),
    surfReleaseTimer: ref(null),
    memoryLogoRestoreTimer: ref(null),
    runwayPatchTimer: ref(null),
    previewFocusFrame: ref(null),
    pendingRunwayPatchRef: ref(null),
    rapidSurfUntilRef: ref(0),
    lastFocusAtRef: ref(0),
    groupChangedAt: ref(0),
    lastRunwayRef: ref({ ids: ["a", "b"], priority: ["a"], pageSize: 8 }),
    orderedFilteredIdsRef: ref(["a", "b"]),
    filteredIdIndexRef: ref(new Map([["a", 0], ["b", 1]])),
    runwayLifecycleRef: ref(null),
    group: "All",
    safePreviewMode: "on",
    powerTuning: { rapidSurfHoldMs: 700, previewArmDelayedMs: 1800 },
    previewDelay: 1200,
    surfSettleExtraMs: 0,
    logosOffWhileSurfing: true,
    surfLogosSuppressed: false,
    previewEpoch: 0,
    resetToken: 0,
    channelById: id => channels.get(id),
    isPreviewProtocolSupported: channel => !!channel?.url,
    peekGuideJump: () => null,
    expandRunwayKeepSet: (_ordered, ids) => ids,
    setViewportGuideChannelIds: () => {},
    setPriorityMatchChannelIds: () => {},
    patchProgramsForChannelIds: () => Promise.resolve(),
    retainGuideSlidingCache: () => {},
    releaseGuideSlidingCache: () => cacheReleases.push("release"),
    setPreviewId: value => { context.previewId = value; previewWrites.push(value); },
    setPreviewStatus: value => { context.previewStatus = value; },
    setPreviewMemoryPaused: value => { context.previewMemoryPaused = value; },
    setPreviewActionsFocused: () => {},
    setSurfLogosSuppressed: value => { context.surfLogosSuppressed = value; },
    setPreviewEpoch: fn => { context.previewEpoch = fn(context.previewEpoch); },
    setResetToken: fn => { context.resetToken = fn(context.resetToken); },
    setGroup: value => { context.group = value; },
    setJumpFilterBypassId: () => {},
    resetGuideSelection: id => { context.guideSessionChannelId = id; },
    setRestoreTimeMs: () => {},
    setGroupDrawerOpen: () => {},
    closeDrawer: () => {},
    rememberGuideGroupChannel: () => {},
    Haptics: { selectionAsync: () => Promise.resolve() },
    markGuideSurfing: () => {},
    stopPreviewSession: reason => { stops.push(reason); return Promise.resolve(); },
    cancelAnimationFrame: () => {},
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay, cleared: false }); return id; },
    clearTimeout: id => { const timer = timers.get(id); if (timer) timer.cleared = true; },
  };
  vm.createContext(context);
  const names = ["cancelGuideTransientTimers", "quiesceGuideForTransition", "schedulePreview", "armPreviewForChannel", "applyGroup"];
  vm.runInContext(compile(names.map(callback).join("\n")) +
    names.map(name => `\nglobalThis.${name} = ${name};`).join("") +
    `\nglobalThis.pressure = ${compile(`(${pressureCallback(guideAst)})`).trim().replace(/;$/, "")};` +
    `\nglobalThis.enterForeground = ${compile(`(${lifecycle.arguments[0].getText(guideAst)})`).trim().replace(/;$/, "")};`, context);
  context.runwayLifecycleRef.current = {
    channelsCount: 2,
    patchProgramsForChannelIds: context.patchProgramsForChannelIds,
    quiesceGuideForTransition: context.quiesceGuideForTransition,
    retainGuideSlidingCache: context.retainGuideSlidingCache,
  };
  let leaveForeground = context.enterForeground();
  const flushTimers = () => {
    // Run each currently scheduled timer once. Cancelled callbacks remain
    // available separately so tests can model an already queued stale callback.
    for (const [id, timer] of [...timers]) {
      if (timer.cleared) continue;
      timer.cleared = true;
      timer.fn();
      timers.delete(id);
    }
  };
  return {
    context, channels, timers, stops, cacheReleases, previewWrites, flushTimers,
    arm: id => context.armPreviewForChannel(channels.get(id)),
    background() {
      context.guideForeground = false;
      context.guideForegroundRef.current = false;
      leaveForeground?.();
      leaveForeground = undefined;
    },
    foreground() {
      context.guideForeground = true;
      context.guideForegroundRef.current = true;
      leaveForeground = context.enterForeground();
    },
  };
}

test("moderate pressure preserves the first pending preview tune", () => {
  const h = fixture();
  h.arm("a");
  const pending = h.context.previewTimer.current;
  h.context.pressure("moderate");
  assert.equal(h.context.previewTimer.current, pending);
  assert.equal(h.timers.get(pending).cleared, false);
  assert.deepEqual(h.stops, []);
  h.flushTimers();
  assert.equal(h.context.previewId, "a");
  assert.equal(h.context.previewMemoryPaused, false);
});

test("moderate pressure does not stop or replace an already playing preview", () => {
  const h = fixture({ playing: true });
  h.context.pressure("moderate");
  h.flushTimers();
  assert.equal(h.context.previewId, "a");
  assert.equal(h.context.previewStatus, "playing");
  assert.equal(h.context.previewEpoch, 0);
  assert.deepEqual(h.stops, []);
});

test("background pressure is only a hint; actual Guide background releases and reentry can tune", () => {
  const h = fixture();
  h.arm("a");
  const stale = h.timers.get(h.context.previewTimer.current).fn;
  h.context.pressure("background");
  assert.deepEqual(h.stops, [], "UI-hidden hints cannot stop a still foreground Guide");
  h.background();
  assert.deepEqual(h.stops, ["superseded"]);
  assert.equal(h.context.previewId, null);
  assert.equal(h.cacheReleases.length, 1);
  stale();
  h.arm("b");
  assert.equal(h.context.previewId, null);
  h.foreground();
  assert.equal(h.context.previewId, null, "foreground entry waits for current native selection");
  h.arm("a");
  h.flushTimers();
  assert.equal(h.context.previewId, "a");
});

for (const playing of [false, true]) {
  test(`critical pressure pauses ${playing ? "playing" : "pending"} preview without timer or same-channel reboot`, () => {
    const h = fixture({ playing });
    if (!playing) h.arm("a");
    h.context.pressure("critical");
    assert.equal(h.context.previewId, null);
    assert.equal(h.context.previewMemoryPaused, true);
    assert.equal(h.context.guideSessionChannelId, "a", "memory pressure must preserve logical selection");
    assert.deepEqual(h.stops, ["superseded"]);
    h.flushTimers();
    h.arm("a");
    h.context.schedulePreview("a", 1200, true);
    h.flushTimers();
    assert.equal(h.context.previewId, null);
    assert.equal(h.context.previewEpoch, 0, "cache/logo timers and same-channel EPG events cannot retune");
    assert.equal(h.context.previewMemoryPaused, true);
  });
}

test("a new settled channel resumes after critical pressure, but a cancelled old tune cannot rearm", () => {
  const h = fixture();
  h.arm("a");
  const stale = h.timers.get(h.context.previewTimer.current).fn;
  h.context.pressure("critical");
  h.arm("b");
  h.flushTimers();
  assert.equal(h.context.previewMemoryPaused, false);
  assert.equal(h.context.previewId, "b");
  const writes = [...h.previewWrites];
  stale();
  assert.deepEqual(h.previewWrites, writes);
  assert.equal(h.context.previewId, "b");
});

test("critical pressure before the first selected channel does not immediately reboot on its first event", () => {
  const h = fixture();
  h.context.guideSessionChannelId = null;
  h.context.pressure("critical");
  h.arm("a");
  h.flushTimers();
  assert.equal(h.context.previewMemoryPaused, true);
  assert.equal(h.context.previewId, null);
  h.arm("b");
  h.flushTimers();
  assert.equal(h.context.previewId, "b");
});

test("actual foreground reentry clears critical pause and requests one native selection restore", () => {
  const h = fixture();
  h.arm("a");
  const stale = h.timers.get(h.context.previewTimer.current).fn;
  h.context.pressure("critical");
  h.background();
  h.foreground();
  assert.equal(h.context.previewMemoryPaused, false);
  assert.equal(h.context.resetToken, 1);
  assert.equal(h.context.previewId, null);
  stale();
  assert.equal(h.context.previewId, null);
  h.arm("a");
  h.flushTimers();
  assert.equal(h.context.previewId, "a");
});

test("explicit group selection can resume the preserved channel after critical pressure", () => {
  const h = fixture({ playing: true });
  h.context.pressure("critical");
  h.context.applyGroup("All");
  assert.equal(h.context.previewMemoryPaused, false);
  assert.equal(h.context.resetToken, 1);
  h.arm("a");
  h.flushTimers();
  assert.equal(h.context.previewId, "a");
});

test("moderate cache trimming still keeps a bounded focus neighbourhood and clears logo memory", async () => {
  const source = await readFile(new URL("../src/store.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("store.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  const context = {
    powerProfile: "normal", lastKeepIdsRef: { current: ["a", "b"] }, lastPatchRunwayIdsRef: { current: [] },
    lastChannelIdRef: { current: "b" },
    pickKeepIdsAroundFocus: (ids, limit, focus) => { calls.push(["keep", limit, focus]); return ids; },
    trimGuideProgramRows: (_keep, critical) => calls.push(["rows", critical]),
    trimProgrammeWindowCacheForMemoryPressure: (_keep, critical) => calls.push(["window", critical]),
    clearChannelLogoMemory: () => calls.push(["logos"]),
  };
  vm.runInNewContext(compile(`(${pressureCallback(ast)})`), context)("moderate");
  assert.deepEqual(calls, [["keep", 32, "b"], ["rows", false], ["window", false], ["logos"]]);
});

function renderPreview(overrides = {}) {
  const component = findNode(guideAst, node => ts.isFunctionDeclaration(node) && node.name?.text === "GuideSelectionPreview");
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useMemo: fn => fn(), useGuideSelection: () => ({ channelId: "a", program: null }),
    useGuidePrograms: () => [], nowNext: () => ({}), isPreviewProtocolSupported: () => true,
    styles: {}, GuidePreviewRail: "GuidePreviewRail", View: "View", Text: "Text", Ionicons: "Ionicons",
    tvColors: { purpleSoft: "purple" },
  };
  vm.createContext(context);
  vm.runInContext(compile(component.getText(guideAst)) + "\nglobalThis.render = GuideSelectionPreview;", context);
  const channel = { id: "a", url: "https://example.invalid/a.ts" };
  const plays = [];
  const onPlay = selected => plays.push(selected.id);
  const tree = context.render({ channelById: new Map([["a", channel]]), favoriteSet: new Set(),
    channelNumberById: {}, now: "2026-08-28T12:00:00Z", previewId: "a", previewEpoch: 7,
    previewMemoryPaused: false, previewReleaseBlocked: false, onPlay, ...overrides });
  return { tree, plays };
}

test("critical pause has an explicit explanation and an existing Play action", () => {
  const { tree } = renderPreview({ previewMemoryPaused: true });
  const overlay = tree.children.find(child => child?.props?.testID === "guide-preview-memory-paused");
  assert.ok(overlay, "a stopped preview must not keep claiming it is tuning");
  const text = JSON.stringify(overlay);
  assert.match(text, /Preview paused to free memory/);
  assert.match(text, /Select another channel or press Play/);
  assert.equal(tree.children[0].props.previewVisible, false);
  assert.equal(typeof tree.children[0].props.onPlay, "function");
});

test("release failure notice supersedes critical pause and keeps retry on the existing Play action", () => {
  const { tree, plays } = renderPreview({ previewMemoryPaused: true, previewReleaseBlocked: true });
  const overlay = tree.children.find(child => child?.props?.testID === "guide-preview-release-blocked");
  assert.ok(overlay, "a retained decoder release failure must explain the blocked preview");
  assert.equal(tree.children.some(child => child?.props?.testID === "guide-preview-memory-paused"), false);
  const text = JSON.stringify(overlay);
  assert.match(text, /previous player could not finish stopping/i);
  assert.match(text, /Press Play to try again/);
  assert.match(text, /If this persists, force-stop CharmIPTV in Android Settings/);
  assert.doesNotMatch(text, /example\.invalid|\.ts\b|token|stack|E_PLAYBACK_RELEASE/);
  assert.deepEqual(plays, [], "showing a release failure cannot start a stream");
  tree.children[0].props.onPlay();
  assert.deepEqual(plays, ["a"]);
});

test("release failure visibility never changes preview identity or overrides Hide preview", () => {
  const before = renderPreview().tree.children[0].props;
  const after = renderPreview({ previewReleaseBlocked: true }).tree.children[0].props;
  assert.equal(after.channel.id, before.channel.id);
  assert.equal(after.previewEpoch, before.previewEpoch);
  assert.equal(after.previewVisible, before.previewVisible, "status-only notices must not remount the player subtree");
  const hidden = renderPreview({ previewReleaseBlocked: true, previewMemoryPaused: true, hidePreview: true }).tree;
  assert.equal(hidden.children.some(child => child?.props?.testID === "guide-preview-release-blocked"), false);
  assert.equal(hidden.children.some(child => child?.props?.testID === "guide-preview-memory-paused"), false);
});

test("Guide observes only the retained release-failure boolean through the ownership subscription", () => {
  const declaration = findNode(guideAst, node => ts.isVariableDeclaration(node) && node.name.getText(guideAst) === "previewReleaseBlocked");
  let failure = true;
  const listeners = new Set();
  const subscribePlaybackOwnership = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const hasPlaybackReleaseFailure = () => failure;
  const snapshots = [];
  const context = {
    subscribePlaybackOwnership,
    hasPlaybackReleaseFailure,
    useSyncExternalStore(subscribe, snapshot, serverSnapshot) {
      assert.equal(subscribe, subscribePlaybackOwnership);
      assert.equal(snapshot, hasPlaybackReleaseFailure);
      assert.equal(serverSnapshot, hasPlaybackReleaseFailure);
      subscribe(() => snapshots.push(snapshot()));
      return snapshot();
    },
  };
  const result = vm.runInNewContext(compile(`const ${declaration.getText(guideAst)};\npreviewReleaseBlocked;`), context);
  assert.equal(result, true);
  failure = false;
  for (const listener of listeners) listener();
  assert.deepEqual(snapshots, [false]);
});
