import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  allocateChannelId,
  enforcePlaylistTextLimit,
  fingerprintKey,
  isAllowedPlaylistUrl,
  MAX_PLAYLIST_BYTES,
  parseM3U,
  parseM3UWithStats,
  parseXmltvTime,
  resolveXmltvStop,
  streamIdentityUrl,
  streamType,
} from "../src/core/sourceParsing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(join(here, "fixtures", name), "utf8");

test("M3U parser preserves metadata, classifies streams, and uses stable collision IDs", async () => {
  const text = await fixture("playlist-valid.m3u");
  const channels = parseM3U(text, (url) => url.replace(/^http:/, "https:"));
  assert.equal(channels.length, 3);
  const newsFp = fingerprintKey(streamIdentityUrl("https://stream.example/live/news.m3u8"));
  const backupFp = fingerprintKey(streamIdentityUrl("https://backup.example/live/channel"));
  assert.equal(channels[0].id, `news.1~${newsFp}`);
  assert.equal(channels[1].id, "sports.1");
  assert.equal(channels[2].id, `news.1~${backupFp}`);
  assert.equal(channels[0].logo, "https://img.example/news.png");
  assert.equal(channels[0].raw_tvg_id, "news.1");
  assert.equal(channels[0].stream_type, "hls");
  assert.equal(channels[1].stream_type, "ts");

  const reordered = `#EXTM3U
#EXTINF:-1 tvg-id="news.1" group-title="News",News One Backup
https://backup.example/live/channel
#EXTINF:-1 tvg-id="sports.1" group-title="Sports",Sports One
https://stream.example/live/sports.ts?token=redacted
#EXTINF:-1 tvg-id="news.1" tvg-name="News One" tvg-logo="http://img.example/news.png" group-title="News",News One
https://stream.example/live/news.m3u8
`;
  const again = parseM3U(reordered);
  const byUrl = Object.fromEntries(again.map((channel) => [channel.url, channel.id]));
  assert.equal(byUrl["https://stream.example/live/news.m3u8"], `news.1~${newsFp}`);
  assert.equal(byUrl["https://backup.example/live/channel"], `news.1~${backupFp}`);
  assert.equal(byUrl["https://stream.example/live/sports.ts?token=redacted"], "sports.1");
});

test("M3U parser skips records without a playable URL and survives a BOM", async () => {
  const channels = parseM3U(await fixture("playlist-malformed.m3u"));
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, "Playable After Bad Record");
});

test("M3U parser rejects disallowed protocols and reports stats", async () => {
  const stats = parseM3UWithStats(await fixture("playlist-protocols.m3u"));
  assert.equal(stats.channels.length, 3);
  assert.ok(stats.rejected >= 3);
  assert.equal(stats.truncated, false);
  assert.equal(isAllowedPlaylistUrl("https://ok.example/a.m3u8"), true);
  assert.equal(isAllowedPlaylistUrl("rtsp://cam.example/stream"), true);
  assert.equal(isAllowedPlaylistUrl("file:///tmp/x"), false);
  assert.equal(isAllowedPlaylistUrl("javascript:alert(1)"), false);
});

test("playlist text limit refuses oversized payloads", () => {
  assert.throws(() => enforcePlaylistTextLimit("x".repeat(MAX_PLAYLIST_BYTES + 1)), /size limit/);
});

test("M3U streamType matches native TiViMate Media3 hints for provider URLs", () => {
  assert.equal(streamType("https://cdn.example/live/news.m3u8"), "hls");
  assert.equal(streamType("https://cdn.example/hls/channel?token=1"), "hls");
  assert.equal(streamType("https://provider.example/live/1?format=hls"), "hls");
  assert.equal(streamType("https://cdn.example/dash/manifest.mpd"), "dash");
  assert.equal(streamType("https://provider.example/live/2?output=mpd"), "dash");
  assert.equal(streamType("https://cdn.example/live/sports.ts?token=x"), "ts");
  assert.equal(streamType("https://cdn.example/live/sports.m2ts"), "ts");
  assert.equal(streamType("https://provider.example/live/3?type=mpegts"), "ts");
  assert.equal(streamType("https://vod.example/movie.mp4"), "progressive");
  assert.equal(streamType("https://provider.example/live/opaque|User-Agent=Charm"), "unknown");
});

test("M3U EXTVLCOPT lines become pipe headers for Media3/VLC", () => {
  const text = `#EXTM3U
#EXTINF:-1 tvg-id="ua.1" group-title="News",UA Channel
#EXTVLCOPT:http-user-agent=ProviderBox/1.0
#EXTVLCOPT:http-referrer=https://provider.example/
https://provider.example/live/1
`;
  const channels = parseM3U(text);
  assert.equal(channels.length, 1);
  assert.match(channels[0].url, /\|/);
  assert.match(channels[0].url, /User-Agent=ProviderBox%2F1\.0/);
  assert.match(channels[0].url, /Referer=https%3A%2F%2Fprovider\.example%2F/);
});

test("allocateChannelId stays deterministic for the same URL", () => {
  const used = new Set();
  const a = allocateChannelId({
    tvgId: "",
    name: "Alpha",
    group: "News",
    url: "https://stream.example/a|User-Agent=x",
    used,
  });
  const used2 = new Set();
  const b = allocateChannelId({
    tvgId: "",
    name: "Alpha",
    group: "News",
    url: "HTTPS://STREAM.EXAMPLE/A",
    used: used2,
  });
  assert.equal(a, b);
  assert.ok(!a.includes("://"));
});

test("XMLTV timestamps respect offsets and reject malformed values", async () => {
  const xml = await fixture("epg-edge-cases.xml");
  const times = [...xml.matchAll(/(?:start|stop)="([^"]+)"/g)].map((match) => parseXmltvTime(match[1]));
  assert.equal(times[0], "2026-08-07T14:00:00.000Z");
  assert.equal(times[1], "2026-08-07T14:30:00.000Z");
  assert.equal(parseXmltvTime("not-a-date"), null);
  assert.ok(times.includes(null), "fixture still includes a malformed XMLTV timestamp");
});

test("XMLTV stop fallback is bounded and deterministic", () => {
  const start = "2026-08-07T14:30:00.000Z";
  assert.equal(resolveXmltvStop(start, ""), "2026-08-07T15:00:00.000Z");
  assert.equal(resolveXmltvStop(start, "20260808160000 -0400"), "2026-08-07T15:00:00.000Z");
  assert.equal(resolveXmltvStop(start, "20260807110000 -0400"), "2026-08-07T15:00:00.000Z");
});
