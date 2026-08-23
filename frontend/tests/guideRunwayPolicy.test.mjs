import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDE_PREFETCH_PAGES_AHEAD,
  GUIDE_PREFETCH_PAGES_BEHIND,
  buildGuideRunwayIds,
  guideRunwayPagesForProfile,
} from "../src/core/guideRunwayPolicy.ts";

const rows = Array.from({ length: 120 }, (_, index) => ({ id: `channel-${index}` }));

test("guide runway keeps four bounded warm pages on both sides of focus", () => {
  assert.equal(GUIDE_PREFETCH_PAGES_AHEAD, 4);
  assert.equal(GUIDE_PREFETCH_PAGES_BEHIND, 4);

  const down = buildGuideRunwayIds(rows, 65, 10, 1);
  assert.equal(down[0], "channel-20");
  assert.equal(down.at(-1), "channel-109");
  assert.equal(down.length, 90);

  const up = buildGuideRunwayIds(rows, 65, 10, -1);
  assert.deepEqual(up, down);
});

test("guide runway clamps cleanly at both playlist boundaries", () => {
  const top = buildGuideRunwayIds(rows, 0, 10, -1);
  const bottom = buildGuideRunwayIds(rows, rows.length - 1, 10, 1);
  assert.equal(top[0], "channel-0");
  assert.equal(top.at(-1), "channel-49");
  assert.equal(bottom[0], "channel-70");
  assert.equal(bottom.at(-1), "channel-119");
});

test("compatibility power profile shortens both sides equally", () => {
  assert.deepEqual(guideRunwayPagesForProfile("weak"), { ahead: 3, behind: 3 });
  const weakDown = buildGuideRunwayIds(rows, 65, 10, 1, "weak");
  assert.equal(weakDown[0], "channel-30");
  assert.equal(weakDown.at(-1), "channel-99");
  assert.equal(weakDown.length, 70);
});
