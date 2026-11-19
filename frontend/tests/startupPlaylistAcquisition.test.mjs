import assert from "node:assert/strict";
import fs from "node:fs";

const nativeBridge = fs.readFileSync(new URL("../src/nativeEpg.ts", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../src/source.native.ts", import.meta.url), "utf8");

assert.match(nativeBridge, /PLAYLIST_FETCH_TIMEOUT_MS = 45_000/);
assert.match(nativeBridge, /fetch\(cleanUrl/);
assert.match(nativeBridge, /parseM3UWithStats/);
assert.match(nativeBridge, /enforcePlaylistByteLimit/);
assert.match(nativeBridge, /enforcePlaylistTextLimit/);
assert.match(nativeBridge, /Playlist request timed out before channels could be loaded/);
assert.doesNotMatch(nativeBridge, /return nativeModule\.fetchPlaylist\(url\)/);
assert.match(source, /refreshPlaylists\(/);
const registry = fs.readFileSync(new URL("../src/core/playlistRegistry.ts", import.meta.url), "utf8");
assert.match(registry, /managedPlaylistUrl\(source.sourceId\)/);
assert.match(registry, /seedLegacyPlaylist/);
assert.match(source, /Preserve provider protocol exactly/);

// A playlist this size (an Xtream catalog of thousands of channels) used to leave the startup
// screen frozen at its floor percentage for the whole fetch: refreshPlaylists had nowhere to
// report progress to. It now reports per-playlist progress through a callback (no circular
// import back to source.native.ts, which already imports refreshPlaylists from here).
assert.match(registry, /onProgress\?: \(progress: PlaylistRefreshProgress\) => void,/);
assert.match(registry, /onProgress\?\.\(\{ completed, total, label: /);
assert.match(source, /refreshPlaylists\(undefined, false, \(\) => true, \(\{ completed, total, label \}\) => \{/);
assert.match(source, /setProgress\(\{ phase: "channels", ratio: 0\.06 \+ \(completed \/ total\) \* 0\.11, etaSeconds: null, message: label \}\)/);
const startupScreen = fs.readFileSync(new URL("../src/components/StartupVersion4.tsx", import.meta.url), "utf8");
assert.match(startupScreen, /targetRef\.current = Math\.min\(1, Math\.max\(milestoneRatio, Math\.min\(1, Math\.max\(0, epg\.ratio\)\) \* 0\.92\)\);/);

console.log("startup playlist acquisition regression: ok");
