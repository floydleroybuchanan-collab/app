import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("native VOD route waits for nonzero layout before Fabric mounts FragmentContainerView", () => {
  const route = source("app/(tabs)/vod.tsx");
  assert.match(route, /const ready = layout\.width > 0 && layout\.height > 0/);
  assert.match(route, /!mountError && layoutReady/);
  assert.match(route, /StyleSheet\.absoluteFillObject/);
  assert.doesNotMatch(route, /style:\s*\{ flex: 1, width: "100%", height: "100%" \}/);
});

test("embedded VOD manually lays out late Fragment children and never mounts in 0x0", () => {
  const surface = source("android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt");
  assert.match(surface, /override fun onLayout\(/);
  assert.match(surface, /if \(width <= 0 \|\| height <= 0\) return/);
  assert.match(surface, /layoutEmbeddedFragment\(\)/);
  assert.match(surface, /View\.MeasureSpec\.EXACTLY/);
  assert.match(surface, /fragment\?\.view\?\.let/);
  assert.match(surface, /post \{ layoutEmbeddedFragment\(\) \}/);
});

test("NavHost readiness deadline starts only after visible and measured root", () => {
  const root = source("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt");
  const geometryGuard = root.indexOf("if (b.root.width <= 0 || b.root.height <= 0 || !b.root.isShown) return@post");
  const budget = root.indexOf("++readyAttempts <= 45");
  assert.ok(geometryGuard > 0 && budget > geometryGuard, "do not count an inactive 0x0 Expo route as a failed VOD destination");
  assert.match(root, /addOnLayoutChangeListener\(readinessLayoutListener\)/);
  assert.match(root, /removeOnLayoutChangeListener\(readinessLayoutListener\)/);
  assert.match(root, /b\.navMainFragment\.requestLayout\(\)/);
  assert.match(root, /container=\$\{b\.navMainFragment\.width\}x\$\{b\.navMainFragment\.height\}, /);
});
