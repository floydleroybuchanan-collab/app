import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAYLIST_AGENT_OPTIONS, describePlaylistAgent, playlistAgentChoice, playlistAgentForChannel, playlistAgentValue, setPlaylistAgents,
} from "../src/core/playlistUserAgent.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("a playlist's choice maps to a stored value and back", () => {
  assert.equal(playlistAgentValue({ preset: "app", custom: "ignored" }), "");
  assert.match(playlistAgentValue({ preset: "vlc", custom: "" }), /^VLC\//);
  assert.equal(playlistAgentValue({ preset: "custom", custom: "  My Player/2  " }), "My Player/2");
  assert.equal(playlistAgentValue({ preset: "custom", custom: "bad\nvalue\u00e9" }), "badvalue");
  assert.deepEqual(playlistAgentChoice(""), { preset: "app", custom: "" });
  const vlc = PLAYLIST_AGENT_OPTIONS.find((option) => option.id === "vlc").value;
  assert.deepEqual(playlistAgentChoice(vlc), { preset: "vlc", custom: "" });
  assert.deepEqual(playlistAgentChoice("Mine/1"), { preset: "custom", custom: "Mine/1" });
  assert.match(describePlaylistAgent({ preset: "app", custom: "" }, "TiviMate/5.1.6"), /app default \(TiviMate\/5\.1\.6\)/);
});

test("only personal playlists with a choice change their channels' agent", () => {
  setPlaylistAgents([
    { id: "mine", userAgent: "Mine/1" },
    { id: "other", userAgent: "" },
    { id: "charm-secondary", managed: true, userAgent: "Ignored/1" },
  ]);
  assert.equal(playlistAgentForChannel("pl:mine:abc123"), "Mine/1");
  assert.equal(playlistAgentForChannel("pl:other:abc123"), undefined);
  assert.equal(playlistAgentForChannel("pl:charm-secondary:abc"), undefined);
  assert.equal(playlistAgentForChannel("plain-channel-id"), undefined);
  setPlaylistAgents([]);
  assert.equal(playlistAgentForChannel("pl:mine:abc123"), undefined);
});

test("the choice reaches downloads, streams and the editor, and supplied playlists are untouched", async () => {
  const [registry, policy, editor, kotlin, parser, device, stream, multiview, xtream] = await Promise.all([
    source("src/core/playlistRegistry.ts"), source("src/core/streamPolicy.ts"), source("app/playlists.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/CharmUserAgent.kt"), source("android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CharmDeviceModule.kt"), source("src/components/StreamPlayer.tsx"), source("app/multiview.tsx"), source("src/core/xtream.ts"),
  ]);
  // supplied playlists pass nothing, personal ones pass their own (blank clears)
  assert.match(registry, /row\.managed \? undefined : row\.userAgent \?\? ""/);
  assert.match(registry, /setHostUserAgent/);
  assert.match(xtream, /headers: \{ "User-Agent": userAgent \}/);
  assert.match(policy, /playlistAgentForChannel\(channelKey\) \?\? getActiveUserAgent\(\)/);
  assert.match(stream, /parsePipeHeaders\(rawUri, channelKey\)/);
  assert.match(multiview, /parsePipeHeaders\(channel\.url, channel\.id\)/);
  assert.match(kotlin, /fun forUrl\(url: String\)/);
  assert.match(parser, /CharmUserAgent\.forUrl\(cleanUrl\) \?: CharmUserAgent\.current\(\)/);
  assert.match(device, /fun setHostUserAgent\(url: String, value: String\)/);
  assert.match(editor, /<AgentPicker choice=\{agent\}/);
  assert.match(editor, /User agent \(optional\)/);
  assert.match(editor, /Reset to app default/);
  assert.match(editor, /savePersonalPlaylist\(name, sourceValue\(\), preview, editing \|\| undefined, agentValue\)/);
  // the protected guide and playlist transport files are not touched by this feature
  assert.doesNotMatch(await source("src/nativeEpg.ts"), /playlistUserAgent|getActiveUserAgent/);
  assert.doesNotMatch(await source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"), /CharmUserAgent/);
});
