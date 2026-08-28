import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function harness() {
  const source = await readFile(new URL("../src/store.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const flushProgramPatchQueue = useCallback(");
  const end = source.indexOf("  const setSelectedDate = useCallback(", start);
  assert.ok(start >= 0 && end > start, "actual Store queue callbacks must be present");
  const snippet = source.slice(start, end);
  const code = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const firstRead = deferred();
  const reads = [];
  const patches = [];
  const timers = [];
  const ref = (current) => ({ current });
  const context = {
    useCallback: (callback) => callback,
    patchInFlightRef: ref(false),
    patchGenerationRef: ref(0),
    patchTimerRef: ref(null),
    pendingPatchIdsRef: ref(new Set(["a", "b"])),
    pendingPatchPriorityIdsRef: ref([]),
    lastPatchRunwayIdsRef: ref(["a", "b"]),
    lastKeepIdsRef: ref(["a", "b"]),
    windowStartRef: ref("2026-08-28T00:00:00Z"),
    windowEndRef: ref("2026-08-29T00:00:00Z"),
    guideEpochRef: ref(1),
    guideWindowHoursRef: ref(24),
    powerProfile: "weak",
    lastChannelId: "a",
    buildGuidePatchTiers: (ids) => ids.map((id) => [id]),
    loadGuideProgramsForChannelIds: (ids) => {
      reads.push(Array.from(ids).join(","));
      return reads.length === 1 ? firstRead.promise : Promise.resolve({ [ids[0]]: ["current"] });
    },
    keepUsefulGuidePatch: (delta) => delta,
    makeGuideProgramWindowKey: (...parts) => parts.join("|"),
    applyGuidePrograms: (_key, delta) => patches.push(delta),
    retainGuidePrograms: () => {},
    retainProgrammeWindowCache: () => {},
    trimGuideProgramRows: () => {},
    trimProgrammeWindowCacheForMemoryPressure: () => {},
    clearChannelLogoMemory: () => {},
    pickKeepIdsAroundFocus: (ids) => ids,
    isGuideSurfing: () => false,
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
  };
  vm.createContext(context);
  vm.runInContext(code + "\nglobalThis.flush = flushProgramPatchQueue; globalThis.release = releaseGuideSlidingCache; globalThis.patch = patchProgramsForChannelIds;", context);
  return { context, firstRead, reads, patches, timers };
}

test("Guide blur drops an in-flight result and stops the remaining old runway tiers", async () => {
  const { context, firstRead, reads, patches } = await harness();
  const done = context.flush();
  assert.deepEqual(reads, ["a"]);
  context.release();
  firstRead.resolve({ a: ["stale"] });
  await done;
  assert.deepEqual(reads, ["a"]);
  assert.equal(patches.length, 0);
  assert.equal(context.patchInFlightRef.current, false);
});

test("new focus work survives the old cancelled queue finishing", async () => {
  const { context, firstRead, reads, patches, timers } = await harness();
  const old = context.flush();
  context.release();
  await context.patch(["c"]);
  firstRead.resolve({ a: ["stale"] });
  await old;
  assert.equal(patches.length, 0);
  assert.equal(timers.length, 1, "the pending new runway must be rescheduled");
  timers.shift()();
  // Drain the cross-context async callback before inspecting its publication.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reads, ["a", "c"]);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].c[0], "current");
});
