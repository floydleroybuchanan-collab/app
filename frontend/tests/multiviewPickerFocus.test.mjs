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

test('selector owns a bounded mounted page and shares overlay focus with the pane menu', async () => {
  const picker = await readFile(new URL('../src/components/MultiviewChannelSelector.tsx', import.meta.url), 'utf8');
  assert.match(screen, /inputRef=\{firstPicker\} preferredFocus=\{preferOverlayFocus\}/);
  assert.match(picker, /initialNumToRender=\{PAGE\} maxToRenderPerBatch=\{PAGE\}/);
  assert.match(picker, /removeClippedSubviews=\{false\}/);
  assert.match(picker, /onFocus=\{\(\) => list.current\?\.scrollToIndex/);
  assert.match(picker, /searchFocused && styles.focus/);
  assert.match(picker, /keyExtractor=\{item => item.id\}/);
  assert.match(picker, /onFocusCapture=\{onFocusCapture\}/);
  assert.match(screen, /\[0, 80, 160, 300, 560\]/);
});
