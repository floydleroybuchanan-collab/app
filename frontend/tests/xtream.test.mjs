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

test("Xtream fetches categories and streams together, not one after the other, once the account check passes", async () => {
  // An 18,000-channel account spent 3 full round-trips in series before this; categories and
  // streams have no data dependency on each other, so they should overlap instead.
  const original = globalThis.fetch; const started = []; const resolvers = [];
  globalThis.fetch = (url) => {
    const action = new URL(url).searchParams.get("action");
    started.push(action);
    return new Promise((resolve) => resolvers.push(() => resolve(new Response(JSON.stringify(
      action === null ? { user_info: { auth: 1, status: "Active" } }
        : action === "get_live_categories" ? [{ category_id: "1", category_name: "Live" }]
        : [{ stream_id: 1, name: "One", category_id: "1" }],
    )))));
  };
  try {
    const run = previewXtream(login);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(started, [null], "the account check must resolve before categories/streams start");
    resolvers[0]();
    await new Promise((r) => setTimeout(r, 0));
    // Both in-flight together: neither waited for the other to finish first.
    assert.deepEqual(started.sort(), [null, "get_live_categories", "get_live_streams"].sort());
    resolvers[1](); resolvers[2]();
    await run;
  } finally { globalThis.fetch = original; }
});
