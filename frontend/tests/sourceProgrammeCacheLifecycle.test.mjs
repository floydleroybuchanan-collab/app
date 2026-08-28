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
  const source = await readFile(new URL("../src/source.native.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("source.native.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set([
    "maxProgrammeWindowKeys", "programmeWindowCache", "programmeWindowEmptyKeys",
    "programmeWindowAccessOrder", "programmeWindowCacheKey", "programmeWindowGeneration",
    "programmeWindowInFlight", "clearProgrammeWindowCache", "invalidateProgrammeWindowReads",
    "touchProgrammeWindowKey", "trimProgrammeWindowCache", "retainProgrammeWindowCache",
    "trimProgrammeWindowCacheForMemoryPressure", "hasCachedProgrammeResult",
    "mergeProgrammeQueryResult", "loadProgrammeCacheMisses", "loadGuideProgramsForChannelIds",
  ]);
  const snippets = [];
  for (const statement of tree.statements) {
    const name = ts.isFunctionDeclaration(statement) ? statement.name?.text
      : ts.isVariableStatement(statement) ? statement.declarationList.declarations[0]?.name.getText(tree) : null;
    if (names.has(name)) {
      snippets.push(statement.getText(tree).replace(/^export\s+/, ""));
      names.delete(name);
    }
  }
  assert.equal(names.size, 0, `actual source cache implementation must be present: ${[...names]}`);
  const reads = [];
  const fallbacks = [];
  let ownershipReads = 0;
  const context = {
    nativeEpgAvailable: true,
    EMPTY_PROGRAMS: Object.freeze([]),
    viewportGuideChannelIds: [],
    MEM: { channels: [{ id: "kept", tvg_id: "kept" }, { id: "late", tvg_id: "late" }], guideEpoch: 1 },
    resolveGuideWindowBounds: () => ({ startMs: 1_000, endMs: 4_000 }),
    withManualRemaps: (channels) => channels,
    queryNativeGuideWindow: (ids) => {
      const read = { ids: Array.from(ids), ...deferred() };
      reads.push(read);
      return read.promise;
    },
    getEpgSourcePreferences: async () => {
      ownershipReads += 1;
      return { primaryEnabled: true, userEnabled: false, userUrl: "", userOverrides: {} };
    },
    getMultiEpgSources: async () => [],
    loadNativeEpgWindow: (ids) => {
      const read = { ids: Array.from(ids), ...deferred() };
      fallbacks.push(read);
      return read.promise;
    },
  };
  vm.createContext(context);
  const code = ts.transpileModule(snippets.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(code + `
    programmeWindowCacheKey = "1000|4000|1";
    globalThis.api = {
      load: loadGuideProgramsForChannelIds,
      clear: clearProgrammeWindowCache,
      seed: (id, rows) => mergeProgrammeQueryResult([id], { [id]: rows }),
      release: () => {
        retainProgrammeWindowCache(["kept"]);
        trimProgrammeWindowCacheForMemoryPressure(["kept"], true);
      },
      cache: () => programmeWindowCache,
      negative: () => Array.from(programmeWindowEmptyKeys),
      inFlightCount: () => programmeWindowInFlight.size,
    };
  `, context);
  return { api: context.api, reads, fallbacks, ownershipReads: () => ownershipReads };
}

test("late Guide tier cannot refill trimmed JS rows and retained focus data survives", async () => {
  const { api, reads, fallbacks } = await harness();
  const kept = [{ title: "Kept" }];
  api.seed("kept", kept);
  const old = api.load(["late"]);
  assert.equal(reads.length, 1);
  api.release();
  reads[0].resolve({ late: [{ title: "Stale" }] });
  assert.equal(Object.keys(await old).length, 0);
  assert.deepEqual(Object.keys(api.cache()), ["kept"]);
  assert.equal(api.cache().kept, kept);
  assert.equal(fallbacks.length, 0);
});

test("released empty response stops before ownership lookup or fallback warming", async () => {
  const { api, reads, fallbacks, ownershipReads } = await harness();
  const old = api.load(["late"]);
  api.release();
  reads[0].resolve({});
  assert.equal(Object.keys(await old).length, 0);
  assert.equal(ownershipReads(), 0);
  assert.equal(fallbacks.length, 0);
  assert.equal(api.negative().length, 0);
});

test("same-window reentry does not coalesce with or accept the released request", async () => {
  const { api, reads } = await harness();
  const old = api.load(["late"]);
  api.clear();
  const fresh = api.load(["late"]);
  assert.equal(reads.length, 2);
  reads[0].resolve({ late: [{ title: "Stale" }] });
  assert.equal(Object.keys(await old).length, 0);
  assert.equal(api.inFlightCount(), 1, "old cleanup must not erase the new pending read");
  assert.equal(api.cache().late, undefined);
  reads[1].resolve({ late: [{ title: "Current" }] });
  assert.equal((await fresh).late[0].title, "Current");
  assert.equal(api.cache().late[0].title, "Current");
  assert.equal(api.inFlightCount(), 0);
});

test("release also rejects a fallback response that was already in flight", async () => {
  const { api, reads, fallbacks } = await harness();
  const kept = [{ title: "Kept" }];
  api.seed("kept", kept);
  const old = api.load(["late"]);
  reads[0].resolve({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fallbacks.length, 1);
  api.release();
  fallbacks[0].resolve({ late: [{ title: "Stale fallback" }] });
  assert.equal(Object.keys(await old).length, 0);
  assert.deepEqual(Object.keys(api.cache()), ["kept"]);
  assert.equal(api.cache().kept, kept);
});

test("active overlapping Guide reads still coalesce and preserve current rows", async () => {
  const { api, reads } = await harness();
  const first = api.load(["late"]);
  const second = api.load(["late"]);
  assert.equal(reads.length, 1);
  const current = [{ title: "Current" }];
  reads[0].resolve({ late: current });
  assert.equal((await first).late, current);
  assert.equal((await second).late, current);
  assert.equal(api.inFlightCount(), 0);
});
