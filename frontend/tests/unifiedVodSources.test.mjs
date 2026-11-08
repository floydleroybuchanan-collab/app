import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = name => readFileSync(resolve(root, name), "utf8");

test("three VOD sources are accessible from one lazy entry point", () => {
  const content = src("src/components/MediaLabVodContent.tsx");
  const landing = src("src/components/UnifiedVodOverview.tsx");
  assert.match(content, /"all", "All VOD"/);
  assert.match(content, /"provider-xtream", "Xtream"/);
  assert.match(content, /"provider-stalker", "Stalker"/);
  assert.match(landing, /id: "home", label: "Streamflix"/);
  assert.match(landing, /readVodSnapshot/);
  assert.doesNotMatch(landing, /loadXtreamCatalog|listStalkerCatalog|NativeModules/);
});

test("one provider type loads only when user opens its tab", () => {
  const source = src("src/components/XtreamProviderBrowser.tsx");
  assert.match(source, /allowedProtocol\?: "xtream" \| "stalker"/);
  assert.match(source, /!allowedProtocol \|\| row\.kind === allowedProtocol/);
  assert.match(source, /FlatList data=\{displayed\}/);
  assert.match(source, /Math\.min\(visible\.length, current \+ 96\)/);
  assert.match(source, /hasTVPreferredFocus=\{item\.id === returnFocusId\}/);
});

test("short Xtream/Stalker playback records a recent title without erasing resume", () => {
  const player = src("app/provider-player.tsx");
  assert.match(player, /recentStartRecorded/);
  assert.match(player, /status !== "playing"/);
  assert.match(player, /mediaId: media\.id,/);
});
