import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Cross-reference every tracked source/config file. Do not limit the audit to
// files edited in this PR. API and device tests remain independently required.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const names = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot, encoding: "utf8", maxBuffer: 12 * 1024 * 1024
}).split("\0").filter(Boolean);
const sourceExtension = /\.(?:kt|java|ts|tsx|js|jsx|mjs|cjs|py|xml|gradle|kts|json|ya?ml)$/i;
const indexed = new Map();
for (const name of names) {
  if (!sourceExtension.test(name)) continue;
  try { indexed.set(name, readFileSync(path.join(repoRoot, name), "utf8")); }
  catch (error) { assert.fail("Tracked source inaccessible: " + name + ": " + error.message); }
}
const runtimeCode = (name) =>
  /^(?:frontend\/(?:app\/|src\/|android\/(?:app\/|vod\/app\/src\/main\/)|scripts\/)|ci\/|\.github\/)/.test(name) &&
  !/(?:^|\/)(?:tests?|fixtures|docs|build|node_modules)\//.test(name) &&
  !/\.trigger$/.test(name);
const matchPaths = (pattern) =>
  [...indexed].filter(([name, content]) => runtimeCode(name) && pattern.test(content)).map(([name]) => name).sort();
const read = (name) => {
  assert.ok(indexed.has(name), "Missing required source file: " + name);
  return indexed.get(name);
};
const route = "frontend/app/(tabs)/vod.tsx";
const bridge = "frontend/android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt";
const host = "frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt";
const root = "frontend/android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt";
const focus = "frontend/android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodFocusCoordinator.kt";

test("source cross-reference audit covers every tracked source/config file", () => {
  assert.ok(names.length > 1200, "Repository scan unexpectedly partial: " + names.length);
  assert.ok(indexed.size > 1000, "Source scan unexpectedly partial: " + indexed.size);
  for (const file of [route, bridge, host, root, focus]) read(file);
  console.info("[VOD ownership audit] " + names.length + " tracked files, " + indexed.size + " source/config files scanned");
});

test("removed native Back dispatcher and overlay have no active callers", () => {
  for (const symbol of ["nativeBackCallback", "charm_vod_failure"]) {
    const paths = matchPaths(new RegExp("\\b" + symbol + "\\b"));
    assert.deepEqual(paths, [], "Removed symbol " + symbol + " still referenced: " + paths.join(", "));
  }
  assert.doesNotMatch(read(root), /OnBackPressedCallback|onBackPressedDispatcher|nativeBackCallback/);
  assert.doesNotMatch(read(bridge), /showFailure\s*\(|\bTextView\s*\(|charm_vod_failure/);
  assert.match(read(host), /override fun onBackPressed\(\)/);
  assert.match(read(host), /nativeVodOwnsFocus\(\) && vodBackHandler\?\.invoke\(\) == true/);
  assert.match(read(host), /if \(nativeVodOwnsFocus\(\) && vodKeyHandler\?\.invoke\(event\) == true\)/);
});

test("every VOD event has one native producer and one React subscriber", () => {
  for (const event of [
    "CharmVodRootBack", "CharmVodFocusHostRail", "CharmVodImmersiveChanged",
    "CharmVodRootReady", "CharmVodMountError"
  ]) {
    const paths = matchPaths(new RegExp("\\b" + event + "\\b"));
    assert.deepEqual(paths, [route, bridge].sort(),
      "Event " + event + " has dangling or competing owners: " + paths.join(", "));
    assert.match(read(route), new RegExp("DeviceEventEmitter\\.addListener\\(\"" + event + "\""));
    assert.match(read(bridge), new RegExp("emit\\(\"" + event + "\""));
  }
  assert.match(read(route), /back\.remove\(\); rail\.remove\(\); mode\.remove\(\); failure\.remove\(\); mounted\.remove\(\)/);
});

test("active-tab focus, navigation, and event-listener owners agree", () => {
  assert.match(read(route), /screenActive=\{isFocused\}/);
  assert.match(read(bridge), /@ReactProp\(name = "screenActive", defaultBoolean = false\)/);
  assert.match(read(bridge), /fragment\?\.setHostActive\(value\)/);
  assert.match(read(root), /coordinator\?\.setHostActive\(active\)/);
  assert.match(read(focus), /if \(!active\) cancelPendingRestore\(\)/);
  assert.match(read(host), /container\.screenActive && visible\(container\)/);
  assert.match(read(root), /immersiveDestinationListener\?\.let \{ controller\.removeOnDestinationChangedListener\(it\) \}/);
  assert.match(read(root), /controller\.addOnDestinationChangedListener\(immersiveListener\)/);
});

test("React exclusively renders VOD errors; native owns real measured layout", () => {
  assert.match(read(route), /setMountError\(message \|\| "Unable to open the VOD screen\."\)/);
  assert.match(read(route), /accessibilityLabel="Retry Video OnDemand"/);
  assert.match(read(bridge), /container\.measure\(widthSpec, heightSpec\)/);
  assert.match(read(bridge), /container\.layout\(0, 0, w, h\)/);
  assert.doesNotMatch(read(root), /onRootReady = null|onRootError = null/);
  assert.match(read(bridge), /onRootReady = null/);
  assert.match(read(bridge), /onRootError = null/);
});
