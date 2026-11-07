import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');

test('Real-Debrid sources sort to the visible top and take focus when discovery finishes',()=>{
  const picker=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/vod/SourcePicker.kt');
  assert.match(picker,/SourceDetails\.Kind\.REAL_DEBRID && row\.details\?\.let\(SourceDiscovery::cached\) == true/);
  assert.match(picker,/row\.details\?\.isDebrid == true -> 1/);
  assert.match(picker,/val gainedDebrid = !hadDebrid/);
  assert.match(picker,/list\.setSelectionFromTop\(target, 0\)/);
  assert.match(picker,/if \(gainedDebrid \|\| !list\.hasFocus\(\)\) list\.requestFocus\(\)/);
  assert.ok(picker.indexOf('setSelectionFromTop(target, 0)') < picker.indexOf('list.requestFocus()', picker.indexOf('fun updateRows()')));
});

test('reviewed English Vavoo catalog reuses the existing provider implementation',()=>{
  const providers=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/providers/Provider.kt');
  assert.match(providers,/VavooProvider\("en"\) to ProviderSupport\(movies = false, tvShows = true\)/);
});
