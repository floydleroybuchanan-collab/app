import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mapXtreamTitles, mapXtreamDetails, loadXtreamCatalog, loadXtreamDetails, xtreamMediaUrl, xtreamCatchupUrl, mapXtreamChannels } from "../src/core/xtream.ts";
import { stageProviderMedia, takeProviderMedia, clearProviderMedia, providerStreamAddress } from "../src/core/providerMediaSession.ts";
import { parsePipeHeaders } from "../src/core/streamPolicy.ts";
import { mergeProviderLibrary, providerPlaybackId, providerResumePosition } from "../src/core/providerLibraryCore.ts";
const login = { server: "https://panel.invalid:8443", username: "one/a", password: "p&?", output: "ts" };

// Fixtures mirror supplied clone InterfaceC2867 and Xtream *JsonAdapter fields.
test("clone movie/series identities, category and detail models remain distinct", () => {
  const movie = mapXtreamTitles("movie", [{ stream_id: 8, name: "Movie", stream_icon: "https://img.invalid/a", category_id: 2, rating: 7, added: 3 }], [{ category_id: "2", category_name: "Films" }])[0];
  const series = mapXtreamTitles("series", [{ series_id: 8, name: "Series", cover: "https://img.invalid/b", category_id: 3, last_modified: 5 }], [{ category_id: 3, category_name: "Shows" }])[0];
  assert.equal(movie.category, "Films"); assert.equal(series.category, "Shows"); assert.notEqual(movie.kind, series.kind);
  const detail = mapXtreamDetails({ info: { plot: "Plot", releasedate: "2020", duration_secs: "120" }, movie_data: { container_extension: "mkv" } }, "movie");
  assert.equal(detail.extension, "mkv"); assert.equal(detail.durationSeconds, 120);
  const episodes = mapXtreamDetails({ info: { releaseDate: "2021", description: "Series plot" }, episodes: { 2: [{ id: 11, title: "Episode", season: "2", container_extension: "mp4", info: { movie_image: "https://img.invalid/e", releasedate: "2021" } }] } }, "series");
  assert.equal(episodes.episodes[0].season, "2"); assert.equal(episodes.plot, "Series plot");
  assert.throws(() => mapXtreamTitles("movie", [{ stream_id: 8 }, { stream_id: 8 }], []), /duplicate/);
  assert.throws(() => mapXtreamDetails({ movie_data: { container_extension: "mp4?token=bad" } }, "movie"), /format/);
});

test("clone C3860/C1847 media paths and C7027 timeshift preserve escaped credentials", () => {
  assert.equal(xtreamMediaUrl(login, "movie", "8", "mkv"), "https://panel.invalid:8443/movie/one%2Fa/p%26%3F/8.mkv");
  assert.match(xtreamMediaUrl(login, "series", "11", ""), /\/series\/one%2Fa\/p%26%3F\/11$/);
  const start = Date.parse("2026-01-02T04:05:00Z");
  assert.equal(xtreamCatchupUrl(login, "42", start, start + 90 * 60_000, "UTC"), "https://panel.invalid:8443/timeshift/one%2Fa/p%26%3F/90/2026-01-02:04-05/42.ts");
  assert.throws(() => xtreamCatchupUrl(login, "42", start, start, "UTC"), /interval/);
  const channel = mapXtreamChannels(login, [{ stream_id: 42, name: "Channel", tv_archive_duration: "7" }], [])[0];
  assert.equal(channel.archive_days, 7); assert.equal(channel.xtream_stream_id, "42");
});

test("clone API sequence authenticates library before import and requests exact detail parameter", async () => {
  const before = globalThis.fetch, calls = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url), action = parsed.searchParams.get("action"); calls.push(parsed);
    return new Response(JSON.stringify(!action ? { user_info: { auth: 1, status: "Active" } } : action === "get_vod_categories" ? [{ category_id: 1, category_name: "Films" }] : action === "get_vod_streams" ? [{ stream_id: 3, name: "Three", category_id: 1 }] : { info: { plot: "Detail" }, movie_data: { container_extension: "mp4" } }));
  };
  try {
    assert.equal((await loadXtreamCatalog(login, "movie"))[0].name, "Three");
    assert.equal((await loadXtreamDetails(login, "movie", "3")).plot, "Detail");
    assert.deepEqual(calls.map(url => url.searchParams.get("action")), [null, "get_vod_categories", "get_vod_streams", "get_vod_info"]);
    assert.equal(calls[3].searchParams.get("vod_id"), "3");
  } finally { globalThis.fetch = before; }
});

test("provider navigation has one-use opaque tokens and explicit account cleanup", () => {
  const media = { id: "movie:8", owner: "source-one", title: "Title", url: "https://panel.invalid/movie/user/password/8.mp4" };
  const token = stageProviderMedia(media); assert.doesNotMatch(token, /password|panel/);
  assert.equal(takeProviderMedia("wrong"), null); assert.deepEqual(takeProviderMedia(token), media); assert.equal(takeProviderMedia(token), null);
  const next = stageProviderMedia(media); clearProviderMedia(); assert.equal(takeProviderMedia(next), null);
});

test("portal playback headers survive the existing player header parser", () => {
  const uri = "https://media.invalid/stream?signature=a%26b";
  const headers = { "User-Agent": "Portal Client/1 (TV)", Cookie: "mac=00%3A01; timezone=Etc/UTC" };
  assert.deepEqual(parsePipeHeaders(providerStreamAddress(uri, headers)), { uri, headers });
});

test("provider library separates identical title IDs by source and resumes only the saved episode", () => {
  const first = { owner: "source-one", kind: "series", catalogId: "8", title: "Show", favorite: true };
  const other = { ...first, owner: "source-two", favorite: false };
  let entries = mergeProviderLibrary([], first);
  entries = mergeProviderLibrary(entries, other);
  entries = mergeProviderLibrary(entries, { owner: first.owner, kind: first.kind, catalogId: first.catalogId,
    mediaId: "series:11", positionMs: 15_000, durationMs: 60_000, updatedAt: 1, url: "https://secret.invalid" });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].favorite, true);
  assert.equal(entries[1].favorite, false);
  assert.equal(providerResumePosition(entries[0], "series:11", 60_000), 15_000);
  assert.equal(providerResumePosition(entries[0], "series:12", 60_000), 0);
  assert.equal(providerResumePosition(entries[0], "series:11", 15_500), 0);
  assert.doesNotMatch(JSON.stringify(entries), /secret\.invalid/);
  const legacyId = providerPlaybackId("series", "11", 3);
  entries = mergeProviderLibrary(entries, { ...first, mediaId: legacyId, positionMs: 9_000 });
  assert.equal(providerResumePosition(entries[0], legacyId, 60_000), 9_000);
  assert.equal(providerResumePosition(entries[0], providerPlaybackId("series", "11", 4), 60_000), 0);
  const portalId = providerPlaybackId("series", "show_8.season_1.file_2.3", 3);
  entries = mergeProviderLibrary(entries, { ...first, catalogId: "show_8", mediaId: portalId, positionMs: 6_000, updatedAt: 2 });
  assert.equal(providerResumePosition(entries[0], portalId, 60_000), 6_000);
});

test("native VOD seek rejects a stale generation or unrelated decoder owner", async () => {
  const module = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt", import.meta.url), "utf8");
  const manager = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt", import.meta.url), "utf8");
  assert.match(module, /activeChannelKey == channelKey && activeGeneration == generation\.toLong\(\)/);
  assert.match(manager, /owner != Owner\.FULLSCREEN \|\| activeSource\?\.channelKey != channelKey \|\| !instance\.isCurrentMediaItemSeekable/);
  assert.match(manager, /instance\.seekTo\(positionMs\.coerceIn\(0L, maximum\)\)/);
});
