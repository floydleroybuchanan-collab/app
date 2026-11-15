import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a touch phone gets the clear-page neon glass tokens; the TV tokens are untouched", () => {
  const theme = read("src/theme.ts");
  assert.match(theme, /const tvGlass = \{\s*page: "#120826",\s*rail: "#1A0B33",\s*drawer: "#1E0C3C"/);
  assert.match(theme, /Platform\.OS === "android" && !Platform\.isTV/);
  assert.match(theme, /page: "transparent"/);
  assert.match(theme, /export const glass: typeof tvGlass = phoneUi \? phoneGlassTokens : tvGlass/);
});

test("the player uses glass transport icons on a phone only", () => {
  const player = read("app/player.tsx");
  assert.match(player, /const phoneUi = !shouldUseTvLayout\(deviceLayoutMode\)/);
  assert.match(player, /phoneUi \? <Image source=\{PLAYER_GLASS\.prev\}/);
  assert.match(player, /<Ionicons name="play-skip-back"/);
  for (const name of ["prev", "pause", "play", "next", "back"]) {
    assert.ok(existsSync(new URL(`../assets/glass/player_${name}.png`, import.meta.url)), `player_${name}.png`);
  }
});

test("phone layouts: 3-up channel cards, 2/3-up reminders, 3-up settings tiles, no TV drawer button, glass back button", () => {
  const collection = read("src/components/PurpleChannelCollection.tsx");
  assert.match(collection, /phoneUi \? \(width < 600 \? 3 : 4\) : width >= 1500 \? 6/);
  assert.match(read("app/(tabs)/reminders.tsx"), /phoneUi \? \(contentWidth < 600 \? 2 : 3\) : TV_COLUMNS/);
  assert.match(read("app/(tabs)/settings.tsx"), /width: phoneUi \? "31\.5%" : "23\.8%"/);
  assert.match(read("src/components/PurpleDrawerButton.tsx"), /if \(phoneUi\) return null;/);
  assert.match(read("app/player.tsx"), /testID="player-glass-back"/);
});

test("the native VOD settings rows are 40% see-through on a phone and unchanged on a TV", () => {
  const styler = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/SettingsListStyler.kt");
  assert.match(styler, /val rowBackgroundColor = if \(isTv\) 0x2E9A5CF0 else 0x999A5CF0\.toInt\(\)/);
});

test("secondary pages use the shared glass tokens, so a phone gets the phone look and a TV keeps its own", () => {
  for (const file of ["app/playlists.tsx", "app/epg-custom.tsx", "app/epg-source.tsx", "app/group-settings.tsx", "app/(tabs)/epg-sources.tsx", "app/(tabs)/settings.tsx"]) {
    const src = read(file);
    assert.doesNotMatch(src, /"rgba\(150,90,235,0\.18\)"|"rgba\(216,178,255,0\.30\)"|"rgba\(122,62,214,0\.13\)"/, file);
  }
  const theme = read("src/theme.ts");
  assert.match(theme, /export const ph = \(n: number\): number => \(phoneUi \? Math\.round\(n \* 1\.3 \* 2\) \/ 2 : n\)/);
  assert.match(read("app/playlists.tsx"), /minHeight: ph\(34\)/);
});

test("settings are one big glass window (18% see-through) on a phone", () => {
  const settings = read("app/(tabs)/settings.tsx");
  assert.match(settings, /tileGridWrap: \{[^}]*\.\.\.\(phoneUi \? \{ backgroundColor: "rgba\(98,52,170,0\.82\)"/);
  assert.match(settings, /detailsWrap: \{ flex: 1, \.\.\.\(phoneUi \? \{ backgroundColor: "rgba\(98,52,170,0\.82\)"/);
});

test("native VOD player glass icons are phone-only: touch devices get the glass play/pause, the TV keeps its own", () => {
  const layout = read("android/vod/app/src/main/res/layout/content_exo_controller_mobile.xml");
  for (const name of ["ic_glass_back", "ic_glass_prev", "ic_glass_next"]) assert.match(layout, new RegExp(`@drawable/${name}`));
  assert.doesNotMatch(layout, /exo_play_pause"[^>]*tint/);
  for (const f of ["drawable-finger/exo_styled_controls_play.png", "drawable-finger/exo_styled_controls_pause.png", "drawable-nodpi/ic_glass_back.png"]) {
    assert.ok(existsSync(new URL(`../android/vod/app/src/main/res/${f}`, import.meta.url)), f);
  }
  const tv = read("android/vod/app/src/main/res/layout/content_exo_controller_tv.xml");
  assert.doesNotMatch(tv, /ic_glass_/);
});
