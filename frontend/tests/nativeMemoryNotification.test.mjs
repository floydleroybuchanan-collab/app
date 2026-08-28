import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const native = async (name) => (await readFile(new URL(`../android/app/src/main/java/com/charmiptv/app/${name}.kt`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("JavaScript memory notification follows the accepted native trim decision", async () => {
  const application = await native("MainApplication");
  const callback = application.slice(application.indexOf("override fun onTrimMemory("));
  const guard = callback.indexOf("if (!CharmMemoryCoordinator.trim(trimLevel)) return");
  const emit = callback.indexOf('.emit("CharmMemoryPressure", pressure)');
  assert.ok(guard >= 0 && emit > guard, "deferred native pressure must not leak into JS listeners");
  assert.equal((callback.match(/CharmMemoryCoordinator\.trim\(/g) || []).length, 1);
});

test("native trim returns dispatch acceptance and uses elapsed realtime for startup grace", async () => {
  const coordinator = await native("CharmMemoryCoordinator");
  assert.match(coordinator, /elapsedRealtimeMs: \(\) -> Long = SystemClock::elapsedRealtime/);
  assert.doesNotMatch(coordinator, /System\.currentTimeMillis/);
  assert.match(coordinator, /playbackStartingUntilMs = if \(starting\) elapsedRealtimeMs\(\) \+ 15_000L else 0L/);
  assert.match(coordinator, /level != CharmTrimLevel\.CRITICAL && elapsedRealtimeMs\(\) < playbackStartingUntilMs\) return false/);
  assert.match(coordinator, /onTrim\(level\)\s*return true/);
  assert.match(coordinator, /fun trim\(level: CharmTrimLevel\): Boolean \{[\s\S]*?return startupGrace\.dispatch\(level, ::dispatchTrim\)/);
});
