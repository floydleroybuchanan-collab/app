import test from "node:test";
import assert from "node:assert/strict";
import { challengeNeedsDeadline, startChallengeClock } from "../src/core/accountChallengeClock.ts";

test("challenge countdown stops at expiry and a resumed expired challenge schedules no ticks", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const ticks = [];
  startChallengeClock(2500, now => ticks.push(now));
  t.mock.timers.tick(1000);
  t.mock.timers.tick(500);
  t.mock.timers.tick(10_000);
  assert.deepEqual(ticks, [1000, 2000, 2500]);
  startChallengeClock(2500, now => ticks.push(now));
  t.mock.timers.tick(10_000);
  assert.deepEqual(ticks, [1000, 2000, 2500, 12500]);
});

test("background owner cleanup pauses ticks and foreground reads the real wall clock", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const ticks = [];
  const pause = startChallengeClock(10_000, now => ticks.push(now));
  pause();
  t.mock.timers.tick(5000);
  const stop = startChallengeClock(10_000, now => ticks.push(now));
  t.mock.timers.tick(1000);
  stop();
  t.mock.timers.tick(10_000);
  assert.deepEqual(ticks, [1000, 6000, 7000]);
});

test("only waiting or approved completion challenges retain a deadline", () => {
  for (const kind of ["reset", "registration", "access", "link"]) {
    assert.equal(challengeNeedsDeadline(kind, "waiting"), true);
    assert.equal(challengeNeedsDeadline(kind, "denied"), false);
    assert.equal(challengeNeedsDeadline(kind, "canceled"), false);
  }
  assert.equal(challengeNeedsDeadline("reset", "approved"), true);
  assert.equal(challengeNeedsDeadline("registration", "approved"), true);
  assert.equal(challengeNeedsDeadline("link", "approved"), false);
  assert.equal(challengeNeedsDeadline("access", "consumed"), false);
});
