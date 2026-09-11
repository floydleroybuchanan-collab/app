import test from "node:test";
import assert from "node:assert/strict";
import { normalizeXtream, encodeXtream, decodeXtream, mapXtreamChannels, accountInfo, previewXtream } from "../src/core/xtream.ts";

const login = { server: "http://provider.invalid:8080/", username: "user+one", password: "p/a&?", output: "ts" };
test("Xtream login round-trip preserves port, password and chosen protocol", () => {
  assert.deepEqual(decodeXtream(encodeXtream(login)), { ...login, server: "http://provider.invalid:8080" });
  assert.equal(decodeXtream("https://example.invalid/a.m3u"), null);
  assert.throws(() => normalizeXtream({ ...login, server: "file:///etc/passwd" }));
  assert.throws(() => normalizeXtream({ ...login, server: "https://other.invalid/?password=x" }));
});
test("Xtream channel identity survives password rotation, name and category changes", () => {
  const stream = { stream_id: 42, name: "News", category_id: 7, epg_channel_id: "news.us" };
  const [before] = mapXtreamChannels(login, [stream], [{ category_id: "7", category_name: "News" }]);
  const [after] = mapXtreamChannels({ ...login, password: "new" }, [{ ...stream, name: "Renamed" }], []);
  assert.equal(before.id, after.id);
  assert.equal(before.raw_tvg_id, "news.us");
  assert.match(before.url, /user%2Bone\/p%2Fa%26%3F\/42.ts$/);
  assert.equal(before.group, "News");
  assert.throws(() => mapXtreamChannels(login, [stream, stream], []));
});
test("Xtream rejects disabled or expired accounts without retaining provider error text", () => {
  assert.throws(() => accountInfo({ user_info: { auth: 0, message: "secret" } }), /rejected/);
  assert.throws(() => accountInfo({ user_info: { auth: 1, status: "Expired" } }), /expired/);
  assert.equal(accountInfo({ user_info: { auth: "1", status: "Active", exp_date: null } }).expires, null);
});
test("Xtream authentication precedes imports and produces an EPG association", async () => {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url).searchParams.get("action"));
    const payload = calls.length === 1 ? { user_info: { auth: 1, status: "Active" } }
      : calls.length === 2 ? [{ category_id: "1", category_name: "Live" }]
      : [{ stream_id: 1, name: "One", category_id: "1" }];
    return new Response(JSON.stringify(payload));
  };
  try {
    const result = await previewXtream(login);
    assert.deepEqual(calls, [null, "get_live_categories", "get_live_streams"]);
    assert.equal(result.length, 1);
    assert.equal(new URL(result.epgUrls[0]).pathname, "/xmltv.php");
  } finally { globalThis.fetch = original; }
});
