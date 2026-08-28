import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const native = async (name) => (await readFile(new URL(`../android/app/src/main/java/com/charmiptv/app/${name}.kt`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("hidden and detached native Guide cannot dispatch or publish reads", async () => {
  const view = await native("NativeGuideView");
  assert.match(view, /queriesEnabled\(\): Boolean = !disposed && enabled && attached && windowVisible/);
  assert.match(between(view, "private fun loadPrograms()", "private fun scheduleQueryDrain()"), /if \(!queriesEnabled\(\) \|\| io\.isShutdown\) return/);
  assert.match(view, /if \(!queriesEnabled\(\) \|\| request\.token != generation\) return@post/);
  const disabled = between(view, "if (!value) {", "scheduleLiveClock()\n    applyPendingRestoreChannel()");
  assert.match(disabled, /cancelPendingQueries\(\)/);
  assert.doesNotMatch(disabled, /programs = emptyMap\(\)/);
  const detach = between(view, "override fun onDetachedFromWindow()", "override fun onAttachedToWindow()");
  assert.match(detach, /attached = false/);
  assert.match(detach, /cancelPendingQueries\(\)/);
  assert.match(detach, /programs = emptyMap\(\)/);
  assert.match(view, /if \(!wasEnabled\) loadPrograms\(\)/);
  const visibility = between(view, "override fun onWindowVisibilityChanged(", "fun dispose()");
  assert.match(visibility, /windowVisible = visibility == VISIBLE/);
  assert.match(visibility, /stopLiveClock\(\)/);
  assert.match(visibility, /cancelPendingQueries\(\)/);
});

test("Guide cancels stale SQLite work and takes the newest queued request atomically", async () => {
  const [view, database] = await Promise.all([native("NativeGuideView"), native("EpgDatabase")]);
  assert.match(view, /AtomicReference<GuideQuery\?>/);
  assert.match(view, /val request = pendingQuery\.getAndSet\(null\) \?: break/);
  assert.match(view, /activeQueryCancellation\.get\(\)\?\.cancel\(\)/);
  assert.match(view, /database\.queryGuideWindow\(request\.startMs, request\.endMs, request\.ids, request\.cancellation\)/);
  const query = between(database, "fun queryGuideWindow(", "fun setMeta(");
  assert.match(query, /cancellationSignal: CancellationSignal\? = null/);
  assert.match(query, /cancellationSignal\?\.throwIfCanceled\(\)/);
  assert.match(query, /args\.toTypedArray\(\), cancellationSignal\)/);
});

test("memory trim does not repopulate an inactive Guide", async () => {
  const view = await native("NativeGuideView");
  const trim = between(view, "private val unregisterMemoryListener", "private val density");
  assert.match(trim, /cancelPendingQueries\(\)/);
  assert.match(trim, /if \(queriesEnabled\(\)\) \{\s*loadPrograms\(\)/);
});

test("EPG result allocation and cache clear cannot block the React module queue", async () => {
  const [engine, module] = await Promise.all([native("EpgRamEngine"), native("EpgRamModule")]);
  const joined = between(engine, "fun queryGuideWindow(", "fun queryWindow(");
  assert.match(joined, /val windows = synchronized\(lock\)/);
  assert.match(joined, /val result = ArrayList<NativeEpgProgram>\(\)\s*for \(\(playlistId, programmes\) in windows\) appendWindow/);
  assert.match(engine, /if \(generationBeforeRead != cacheGeneration\) return false/);
  assert.match(engine, /fun clear\(cooldownMs: Long = 0L\) = synchronized\(lock\) \{\s*cacheGeneration \+= 1/);
  const clear = between(module, "fun clearMemory(", "fun stats(");
  assert.match(clear, /worker\.execute \{\s*synchronized\(epochTransitionLock\)/);
});
