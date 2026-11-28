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
  // One handoff owner: chooser pop-up, the button it returns to, the picker,
  // the menu, then the pane.
  assert.match(screen, /requestNativeFocusWithRetry\(\s*\(\) => picker != null\s*\? chooser \? chooserFocus\.current\s*: chooserReturn === "group" \? groupButton\.current\s*: chooserReturn === "playlist" \? playlistButton\.current\s*: firstPicker\.current\s*: menu \? firstMenu\.current : paneNodes\.current\[selected\]/);
  assert.match(screen, /\[0, 80, 160, 300, 560\], \(\) => focusConfirmed\.current/);
  assert.doesNotMatch(screen, /priorPicker/);
  assert.match(screen, /ref=\{pickerEntry \? firstPicker/);
  assert.match(screen, /onFocusCapture=\{confirmOverlayFocus\}/);
  assert.match(screen, /onFocus=\{\(\) => \{ if \(overlay\) return/);
  assert.match(screen, /searchFocused && styles\.focus/);
  assert.match(screen, /key=\{pickerEntry \? "picker-entry" : controlKey\}/);
  assert.match(screen, /false,name === "All",name/);
  // Playlist and group are drop-downs that open a list (never cycle on OK).
  assert.match(screen, /onPress=\{\(\) => openChooser\("playlist"\)\}/);
  assert.match(screen, /onPress=\{\(\) => openChooser\("group"\)\}/);
  assert.doesNotMatch(screen, /\(ids\.indexOf\((sourceFilter|groupFilter)\)\+1\)%ids\.length/);
});

test('multiview channel and group lists are bounded and fixed-height', () => {
  // A row floor, never minHeight:0: inside the focus guide a zero floor let
  // both lists measure zero height and render no rows at all.
  assert.match(screen, /pickerList:\{flexGrow:1,flexShrink:1,minHeight:PICKER_ROW_HEIGHT\*3\}/);
  assert.match(screen, /chooserList:\{flexGrow:1,flexShrink:1,minHeight:CHOOSER_ROW_HEIGHT\*3/);
  assert.doesNotMatch(screen, /(picker|chooser)List:\{flex:1,minHeight:0/);
  // Tail padding, so the last row rests inside the panel and focus cannot
  // walk off the bottom edge.
  assert.match(screen, /pickerListContent:\{paddingBottom:PICKER_ROW_HEIGHT\+PICKER_ROW_GAP\}/);
  assert.match(screen, /chooserListContent:\{paddingBottom:CHOOSER_ROW_HEIGHT\+CHOOSER_ROW_GAP\}/);
  assert.match(screen, /style=\{styles\.pickerList\} contentContainerStyle=\{styles\.pickerListContent\} getItemLayout=\{channelRowLayout\}/);
  assert.match(screen, /getItemLayout=\{chooserRowLayout\}/);
  assert.match(screen, /row:\{height:PICKER_ROW_HEIGHT,marginBottom:PICKER_ROW_GAP/);
  // Pop-up box matches the glass theme at 70% opacity and stays inside the screen.
  assert.match(screen, /chooser:\{position:"absolute",left:"20%",right:"20%",top:"7%",bottom:"7%"[^}]*backgroundColor:"rgba\(30,12,60,0\.70\)"/);
  // Picking a playlist goes straight on to that playlist's groups.
  assert.match(screen, /setSourceFilter\(key\); setGroupFilter\("all"\);[\s\S]{0,120}setChooser\("group"\)/);
  // Back closes the pop-up before the picker.
  assert.match(screen, /if \(chooser\) \{ setChooserReturn\(chooser\); setChooser\(null\); \}/);
});
