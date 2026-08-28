import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlaybackSourceRefresher } from "../src/core/playbackSourceRefresh.ts";

test("concurrent playback refreshes share a download and return only the requested channel", async () => {
  let resolve;
  let calls = 0;
  const catalog = new Promise(done => { resolve = done; });
  const refresh = createPlaybackSourceRefresher(() => { calls += 1; return catalog; });
  const one = refresh(" one ");
  const two = refresh("two");
  await Promise.resolve();
  assert.equal(calls, 1);
  const rows = [{ id: "one", url: "https://provider.invalid/1?token=a+b" }, { id: "two", url: "https://provider.invalid/2" }];
  resolve(rows);
  assert.equal(await one, rows[0]);
  assert.equal(await two, rows[1]);
});

test("a later authentication outage gets new credentials and a failed fetch is not cached", async () => {
  let calls = 0;
  const refresh = createPlaybackSourceRefresher(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary playlist failure");
    return [{ id: "one", url: "https://provider.invalid/live?token=" + calls }];
  });
  await assert.rejects(refresh("one"), /temporary playlist failure/);
  assert.equal((await refresh("one")).url, "https://provider.invalid/live?token=2");
  assert.equal((await refresh("one")).url, "https://provider.invalid/live?token=3");
  assert.equal(calls, 3);
});

test("missing channel never silently substitutes another stream", async () => {
  let calls = 0;
  const refresh = createPlaybackSourceRefresher(async () => { calls += 1; return [{ id: "other" }]; });
  assert.equal(await refresh("  "), null);
  assert.equal(calls, 0);
  assert.equal(await refresh("missing"), null);
  assert.equal(calls, 1);
});

test("playback URL refresh is isolated from Guide refresh locks, cache writes and UI emissions", async () => {
  const source = await readFile(new URL("../src/source.native.ts", import.meta.url), "utf8");
  const start = source.indexOf("export const refreshPlaybackChannel =");
  const refresh = source.slice(start, source.indexOf("/** Check persisted", start));
  assert.match(refresh, /createPlaybackSourceRefresher<Channel>/);
  assert.match(refresh, /fetchNativePlaylist\(sourceUrl\(SOURCE_M3U\)\)/);
  assert.doesNotMatch(refresh, /refreshPlaylistOnly|refreshPromise|syncPlaylistToNative|persistMeta|setProgress|emit\(/);
});

test("authentication refresh deadline exceeds the actual playlist deadline without watching buffering", async () => {
  const native = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../src/nativeEpg.ts", import.meta.url), "utf8");
  const value = (text, name) => Number(text.match(new RegExp(name + " = ([\\d_]+)"))[1].replaceAll("_", ""));
  assert.equal(value(native, "SOURCE_REFRESH_TIMEOUT_MS"), 60_000);
  assert.ok(value(native, "SOURCE_REFRESH_TIMEOUT_MS") > value(bridge, "PLAYLIST_FETCH_TIMEOUT_MS"));
  const buffering = native.slice(native.indexOf("Player.STATE_BUFFERING -> {"), native.indexOf("Player.STATE_READY -> {"));
  assert.doesNotMatch(buffering, /sourceRefreshTimeout|requestFreshSource|postDelayed/);
});
