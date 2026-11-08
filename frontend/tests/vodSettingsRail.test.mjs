import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const settings = readFileSync(resolve(root, "android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/CharmSettingsLayout.kt"), "utf8");
const shell = readFileSync(resolve(root, "src/components/PurpleTvShell.tsx"), "utf8");

test("native settings keep their buttons clear of the compact TV rail", () => {
  assert.match(shell, /PURPLE_ICON_RAIL_WIDTH = 52/);
  assert.match(settings, /if \(embedded\) 76 else 24/);
  assert.match(settings, /content\.setPadding\(leftInset, 0, rightInset/);
  assert.match(settings, /root\.clipChildren = true/);
});

test("settings card grid adapts to host width changes without resetting focus on each subpage", () => {
  assert.match(settings, /root\.addOnLayoutChangeListener/);
  assert.match(settings, /if \(columns == appliedColumns\) return/);
  assert.match(settings, /updateGridColumns\(\)/);
});
