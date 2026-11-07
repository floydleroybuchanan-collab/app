import test from "node:test";
import assert from "node:assert/strict";
import { resolveGuideSearchResults } from "../src/core/guideSearchResults.ts";

const program = { title: "News", start: "2026-11-06T12:00:00Z" };
const row = (channelId) => ({ channelId, program });

test("an exact playlist channel ID beats an earlier XMLTV alias", () => {
  const alias = { id: "pl:other:a", tvg_id: "pl:primary:b", raw_tvg_id: "same" };
  const exact = { id: "pl:primary:b", tvg_id: "same", raw_tvg_id: "same" };
  assert.deepEqual(resolveGuideSearchResults([row(exact.id)], [alias, exact]), [{ channel: exact, program }]);
  assert.deepEqual(resolveGuideSearchResults([row(exact.id)], [exact, alias]), [{ channel: exact, program }]);
});

test("ambiguous XMLTV aliases never play an arbitrary playlist channel", () => {
  const first = { id: "pl:primary:a", tvg_id: "shared", raw_tvg_id: "shared" };
  const second = { id: "pl:secondary:b", tvg_id: "shared", raw_tvg_id: "shared" };
  assert.deepEqual(resolveGuideSearchResults([row("shared")], [first, second]), []);
  assert.deepEqual(resolveGuideSearchResults([row("shared"), row(first.id)], [first]), [{ channel: first, program }]);
});

test("a resolved EPG mapping takes precedence over an unverified raw alias", () => {
  const matched = { id: "pl:primary:a", tvg_id: "shared" };
  const rawOnly = { id: "pl:secondary:b", raw_tvg_id: "shared" };
  assert.deepEqual(resolveGuideSearchResults([row("shared")], [rawOnly, matched]), [{ channel: matched, program }]);
});
