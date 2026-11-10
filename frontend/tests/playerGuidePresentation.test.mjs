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

test("25% transparent overlay at default setting; preview has fully opaque panels", () => {
  const settings = source("src/core/guidePresentation.ts");
  const native = source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const panel = source("src/components/PlayerGuidePanel.tsx");
  assert.match(settings, /transparency: 50/);
  assert.match(settings, /1 - clampTransparency\(level\) \* 0\.005/);
  assert.match(settings, /mode === "preview" \? 1 : overlayOpacity\(level\)/);
  assert.match(native, /private var transparencyLevel = 50/);
  assert.match(native, /if \(overlayMode\) 0 else 255/);
  assert.match(native, /rowSurface\.alpha = if \(overlayMode\) 0 else 255/);
  assert.match(native, /setBackgroundColor\(if \(overlayMode\) Color\.TRANSPARENT/);
  assert.match(panel, /backgroundColor: "#0C0E12"/);
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

