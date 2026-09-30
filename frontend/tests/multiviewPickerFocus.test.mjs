import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const screen = await readFile(new URL('../app/multiview.tsx', import.meta.url), 'utf8');

test('adding screens two through four preserves the original playback selection until admission succeeds', () => {
  const body = screen.match(/const openPicker = \(slot: number\) => \{([^}]+)\}/)?.[1];
  assert.ok(body);
  // Execute the actual opening transition with state setters, so assigning the
  // empty destination to selected reproduces the disabled-action regression.
  const open = new Function('slot','setMenu','setQuery','setPicker','setSelected',body);
  for (const destination of [1,2,3]) {
    const state = {menu:true,query:'old search',picker:null,selected:0};
    open(destination, v=>state.menu=v, v=>state.query=v, v=>state.picker=v, v=>state.selected=v);
    assert.deepEqual(state,{menu:false,query:'old search',picker:destination,selected:0});
  }
  assert.match(screen, /setAudible\(slot\); setSelected\(slot\); setPicker\(null\)/);
});

test('picker owns a measured modal and keeps channel scrolling separate from its footer', async () => {
  const picker = await readFile(new URL('../src/components/MultiviewChannelSelector.tsx', import.meta.url), 'utf8');
  assert.match(screen, /inputRef=\{firstPicker\} preferredFocus=\{preferOverlayFocus\}/);
  assert.match(picker, /<Modal visible transparent/);
  assert.match(picker, /onRequestClose=\{\(\) => open \? closeOptions\(\) : onCancel\(\)\}/);
  assert.match(picker, /height: geometry.panelHeight/);
  assert.match(picker, /testID="multiview-channel-viewport"/);
  assert.match(picker, /height: listHeight/);
  assert.match(picker, /testID="multiview-picker-footer"/);
  assert.doesNotMatch(picker, /<FlatList/);
  assert.match(picker, /removeClippedSubviews=\{false\}/);
  assert.match(picker, /pickerFocusOffset\(index, columns, rowHeight, listHeight, rows.length\)/);
  assert.match(picker, /onFocusCapture=\{onFocusCapture\}/);
  assert.match(screen, /\[0, 80, 160, 300, 560\]/);
});
