import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createSourceRefreshTrace } from "../src/core/sourceRefreshTrace.ts";

test("import diagnostics distinguish active elapsed time from completed stages", () => {
  let time = 1000;
  const trace = createSourceRefreshTrace(() => time);
  trace.enter("catalog-index");
  time += 800;
  trace.enter("catalog-index");
  time += 200;
  trace.enter("primary-lease");
  time += 2500;
  assert.deepEqual(trace.read(), {
    active: { stage: "primary-lease", elapsedMs: 2500 },
    completed: [{ stage: "catalog-index", elapsedMs: 1000 }],
  });
  trace.finish();
  assert.equal(trace.read().active, null);
  assert.deepEqual(trace.read().completed.at(-1), { stage: "primary-lease", elapsedMs: 2500 });
});

test("refresh diagnostics bound history and release it on the next attempt", () => {
  let time = 0;
  const trace = createSourceRefreshTrace(() => ++time);
  for (let i = 0; i < 40; i++) trace.enter(i % 2 ? "primary-parse" : "primary-download");
  trace.finish();
  assert.equal(trace.read().completed.length, 18);
  trace.reset();
  assert.deepEqual(trace.read(), { active: null, completed: [] });
});

test("primary import reports lease and health checks before opening its parser stream", () => {
  const native = readFileSync(new URL("../android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt", import.meta.url), "utf8");
  const start = native.indexOf('emitImportProgress("waiting-for-import-lease"');
  assert.ok(start >= 0);
  const ordered = [
    "database.acquireImport().use",
    'emitImportProgress("checking-guide-database"',
    "database.ensureHealthy()",
    'emitImportProgress("downloading"',
    "val batches = streamProgramBatches(",
    "database.replaceBatches(batches)",
  ];
  let cursor = start;
  for (const marker of ordered) {
    const next = native.indexOf(marker, cursor + 1);
    assert.ok(next > cursor && next - start < 5000, marker);
    cursor = next;
  }
});
