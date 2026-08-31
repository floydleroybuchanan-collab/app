import test from "node:test";
import assert from "node:assert/strict";
import { buildPlaylistMenu, providerGroupKey } from "../src/core/playlistGuideMenu.ts";
import { channelInGroup } from "../src/core/guideGroups.ts";
import { PRIMARY_PLAYLIST, SECOND_PLAYLIST } from "../src/core/playlistCatalog.ts";

const sources = [{ id: PRIMARY_PLAYLIST, name: "CharmIPTV", enabled: true }, { id: SECOND_PLAYLIST, name: "CharmIPTV 2", enabled: true }];
const channels = [
  { id: "one", playlist_id: PRIMARY_PLAYLIST, name: "Sports News", group: "Provider News", source_group: "Provider News" },
  { id: "two", playlist_id: SECOND_PLAYLIST, name: "Sports News", group: "Provider News · CharmIPTV 2 [charm-secondary]", source_group: "Provider News" },
];

test("every playlist gets its own All Channels, Favorites and provider groups", () => {
  const sections = buildPlaylistMenu(sources, channels, new Set(["two"]), new Set());
  assert.deepEqual(sections.map(section => section.label), ["CharmIPTV", "CharmIPTV 2", "All Playlists"]);
  assert.deepEqual(sections[0].groups.map(group => group.label), ["All Channels", "Favorites", "Provider News"]);
  assert.equal(sections[0].groups[1].count, 0);
  assert.equal(sections[1].groups[1].count, 1);
  assert.notEqual(sections[0].groups[2].key, sections[1].groups[2].key);
  assert.equal(sections[2].groups[0].count, 2);
  assert.equal(sections[2].groups[1].count, 1);
  assert.ok(!sections[0].groups.some(group => ["HD Only", "Failed Streams", "24/7"].includes(group.label)));
});

test("disabled playlists and hidden channels do not appear in drawer counts", () => {
  const sections = buildPlaylistMenu([sources[0], { ...sources[1], enabled: false }], channels, new Set(["one"]), new Set(["one"]));
  assert.equal(sections.length, 2);
  assert.equal(sections[0].count, 0);
  assert.equal(sections[0].groups[1].count, 0);
});

test("a provider group called Sports is exact, not the previous app-generated Sports category", () => {
  const options = { favoriteSet: new Set(), recentIds: new Set(), hasEpgMatch: () => false, isFailed: () => false };
  assert.equal(channelInGroup({ ...channels[0], name: "ESPN", group: "News" }, providerGroupKey("Sports"), options), false);
  assert.equal(channelInGroup({ ...channels[0], name: "Plain station", group: "Sports" }, providerGroupKey("Sports"), options), true);
  assert.equal(channelInGroup({ ...channels[0], group: "Favorites" }, providerGroupKey("Favorites"), options), true);
});
