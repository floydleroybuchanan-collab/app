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

test("XMLTV consumers own their input through SQLite staging and worker cancellation", () => {
  const native = name => readFileSync(new URL(`../android/app/src/main/java/com/charmiptv/app/${name}.kt`, import.meta.url), "utf8");
  const primary = native("EpgNativeModule");
  const custom = native("CustomEpgNativeModule");
  const background = native("BackgroundEpgUpdater");
  assert.match(primary, /openPossiblyGzipped\(url,[^\n]+\.use \{ input ->[\s\S]{0,900}database\.replaceBatches\(batches\)/);
  assert.match(primary, /openPossiblyGzipped\(sourceUrl,[^\n]+\.use \{ input ->[\s\S]{0,500}userDatabase\.replaceBatches\(batches\)/);
  assert.match(custom, /openPossiblyGzipped\(sourceUrl,[^\n]+\.use \{ input ->[\s\S]{0,950}targetDatabase\.replaceBatches\(batches\)/);
  assert.match(background, /open\(source\.url, database\)\.use \{ input ->[\s\S]{0,700}database\.replaceBatches\(batches, ::checkCurrentSource\)/);
  assert.match(background, /if \(\(events\+\+ and 255\) == 0\) checkRunning\(\)/);
  assert.match(native("EpgUpdateScheduler"), /workerContext\.ensureActive\(\)[\s\S]{0,80}if \(isStopped\)/);
  assert.match(native("EpgUpdateScheduler"), /updater\.refresh\(source, checkRunning\)/);
});
