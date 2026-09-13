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
    assert.deepEqual(state,{menu:false,query:'',picker:destination,selected:0});
  }
  assert.match(screen, /setAudible\(slot\); setSelected\(slot\); setPicker\(null\)/);
});

test('picker, menu and pane share one bounded focus handoff with late ref resolution', () => {
  assert.match(screen, /requestNativeFocusWithRetry\(\s*\(\) => picker != null \? firstPicker\.current : menu \? firstMenu\.current : paneNodes\.current\[selected\]/);
  assert.match(screen, /\[0, 80, 160, 300, 560\], \(\) => focusConfirmed\.current/);
  assert.doesNotMatch(screen, /priorPicker/);
  assert.match(screen, /ref=\{pickerEntry \? firstPicker/);
  assert.match(screen, /onFocusCapture=\{confirmOverlayFocus\}/);
  assert.match(screen, /onFocus=\{\(\) => \{ if \(overlay\) return/);
  assert.match(screen, /searchFocused && styles\.focus/);
  assert.match(screen, /key=\{pickerEntry \? "picker-entry" : controlKey\}/);
  assert.match(screen, /false,name === "All",name/);
  assert.match(screen, /false,false,"playlist-filter"/);
  assert.match(screen, /false,false,"group-filter"/);
});
