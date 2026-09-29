import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileGuideLayout, mobileGuideRestoreOffset } from '../src/core/mobileGuideLayout.ts';
test('mobile guide cards fit portrait, landscape and tablet content widths', () => {
  for (const width of [240,320,360,393,640,800,1024,1600]) {
    const { columns, cardWidth } = mobileGuideLayout(width);
    assert.ok(columns >= 1 && columns <= 5);
    assert.ok(cardWidth * columns + (columns - 1) * 8 <= width - 24 + 0.01);
  }
});
test('large text increases guide row height without corrupting scroll measurements', () => {
  assert.equal(mobileGuideLayout(393,1).rowHeight,192);
  assert.equal(mobileGuideLayout(393,2).rowHeight,376);
});
test('back preserves exact offset while rotation keeps the selected channel row', () => {
  const saved = { columns: 2, rowHeight: 192, offset: 897 };
  assert.equal(mobileGuideRestoreOffset(saved,2,192,9),897);
  assert.equal(mobileGuideRestoreOffset(saved,4,192,9),384);
  assert.equal(mobileGuideRestoreOffset(saved,2,376,9),1504);
  assert.equal(mobileGuideRestoreOffset(saved,4,192,-1),0);
});
