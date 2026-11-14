import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWarmTabRegistry, WARM_TAB_MAX, WARM_TAB_MS } from "../src/core/warmTabs.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("only a few screens stay warm, oldest first out", () => {
  const released = [];
  const registry = createWarmTabRegistry(2);
  registry.add("a", () => released.push("a"));
  registry.add("b", () => released.push("b"));
  registry.add("c", () => released.push("c"));
  assert.deepEqual(released, ["a"]);
  assert.equal(registry.size(), 2);
  registry.remove("b");
  assert.equal(registry.size(), 1);
  registry.releaseAll();
  assert.deepEqual(released, ["a", "c"]);
  assert.equal(registry.size(), 0);
  assert.ok(WARM_TAB_MAX <= 2 && WARM_TAB_MS <= 60_000);
});

test("a screen being left stays mounted, and is released on memory pressure, background, low RAM and player", async () => {
  const mount = await readFile(join(root, "src/components/FocusedTabMount.tsx"), "utf8");
  assert.match(mount, /setRetained\(visited\.current && !lowRamDevice && \(!tabs \|\| tabs\.isFocused\(\)\)\)/);
  assert.match(mount, /return isFocused \|\| retained \?/);
  assert.match(mount, /subscribeAndroidMemoryPressure\(\(\) => warmTabs\.releaseAll\(\)\)/);
  assert.match(mount, /state !== "active"\) warmTabs\.releaseAll/);
  assert.match(mount, /addListener\("blur"/);
  assert.match(mount, /clearTimeout\(timer\)/);
});
