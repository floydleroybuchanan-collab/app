import test from "node:test";
import assert from "node:assert/strict";
import { nextAnnouncement } from "../src/core/announcementEligibility.ts";

test("the next notice wakes after the global cooldown, even without an announcement refresh", () => {
  const dismissed = { id: "dismissed", kind: "general", expires_at: 60, version_code: 0 };
  const next = { id: "next", kind: "general", expires_at: 120, version_code: 0 };
  const history = { dismissed: { next: 24 * 3600_000 } };
  assert.deepEqual(nextAnnouncement([dismissed, next], history, 31_000, 224, 1000), { notice: null, wakeAt: 31_000 });
  assert.deepEqual(nextAnnouncement([dismissed, next], history, 31_000, 224, 31_000), { notice: next, wakeAt: null });
});

test("installed versions and expired or ineligible notices do not keep a reminder timer", () => {
  const installed = { id: "installed", kind: "update", expires_at: 60, version_code: 224 };
  const expired = { id: "expired", kind: "general", expires_at: 1, version_code: 0 };
  const tooSoon = { id: "tooSoon", kind: "general", expires_at: 20, version_code: 0 };
  assert.deepEqual(nextAnnouncement([installed, expired, tooSoon], {}, 31_000, 224, 1000), { notice: null, wakeAt: null });
});
