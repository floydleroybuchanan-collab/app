import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (p) => readFileSync(resolve(root, p), "utf8");

test("overlay and preview share the existing Media3 session instead of creating a second player", () => {
  const player = source("app/player.tsx");
  const panel = source("src/components/PlayerGuidePanel.tsx");
  assert.equal((player.match(/<StreamPlayer\b/g) || []).length, 1);
  assert.doesNotMatch(panel, /<StreamPlayer\b/);
  assert.match(player, /showPlayerGuidePreview/);
  assert.match(player, /style=\{showPlayerGuidePreview \?/);
  assert.match(player, /<PlayerGuidePanel/);
  assert.match(panel, /testID=\{mode === "overlay" \? "player-unified-guide-overlay" : "player-unified-guide-preview"\}/);
});

test("60% transparent overlay at default setting; preview has fully opaque panels", () => {
  const settings = source("src/core/guidePresentation.ts");
  const native = source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const panel = source("src/components/PlayerGuidePanel.tsx");
  assert.match(settings, /transparency: 60/);
  assert.match(settings, /1 - clampTransparency\(level\) \* 0\.01/);
  assert.match(settings, /mode === "preview" \? 1 : overlayOpacity\(level\)/);
  assert.match(native, /private var transparencyLevel = 60/);
  assert.match(native, /header\.alpha = if \(overlayMode\) opacity else 110/);
  // The Guide is glass in every mode now: the app's crown background shows between the cells.
  assert.match(native, /rowSurface\.alpha = 0/);
  assert.match(native, /setBackgroundColor\(Color\.TRANSPARENT\)/);
  assert.match(panel, /backgroundColor: "#1A0B33"/);
});

test("player guide includes group navigation, date selection, program detail and D-pad boundaries", () => {
  const surface = source("src/components/PlayerGuidePanel.tsx");
  const guide = source("src/components/NativeGuideCanvas.tsx");
  const native = source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  for (const marker of ["player-guide-groups", "player-guide-day-picker", "player-guide-mode-toggle", "player-guide-close"]) {
    assert.ok(surface.includes(marker), marker);
  }
  assert.match(surface, /onLeftBoundary=\{openGroups\}/);
  assert.match(surface, /enableUpBoundary/);
  assert.match(surface, /onProgramPress=\{\(program, channel\) => setDetail\(\{ program, channel \}\)\}/);
  assert.match(guide, /transparencyLevel=\{transparencyLevel\}/);
  assert.match(native, /overlayMode \|\| enableUpBoundary/);
  assert.match(surface, /availableGuideDays\(windowStart, windowEnd\)/);
  assert.match(surface, /autoplayOnFocus && channel\.id !== playingChannel\?\.id/);
});

