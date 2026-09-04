import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');

test('VOD retains every upstream provider, extractor, player and data implementation',()=>{
  execFileSync(process.execPath,['scripts/verify-vod-source.mjs']);
});
test('VOD enters through the host after Live TV releases its decoders',()=>{
  const shell=read('src/components/PurpleTvShell.tsx');
  assert.match(shell,/label: "TV Guide"[^\n]+\n\s*\{ route: "\/vod", label: "Video OnDemand"/);
  const route=read('app/(tabs)/vod.tsx');
  assert.ok(route.indexOf('await stopAllPlaybackSessions(')<route.indexOf('await NativeModules.CharmVod.open()'));
  assert.match(route,/if \(launching.current\) return/);
  const manifest=read('android/vod/app/src/main/embedded/AndroidManifest.xml');
  assert.match(manifest,/MainTvActivity" android:exported="false" android:process=":vod"/);
  assert.doesNotMatch(manifest,/category.LAUNCHER|category.LEANBACK_LAUNCHER/);
});
test('VOD navigation uses a transparent proportional CharmIPTV header mark',()=>{
  const activity=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/activities/main/MainTvActivity.kt');
  const header=read('android/vod/app/src/main/res/layout/content_header_menu_main_tv.xml');
  assert.match(activity,/R\.drawable\.charm_vod_brand_header/);
  assert.match(header,/android:adjustViewBounds="true"/);
  assert.match(header,/android:scaleType="fitCenter"/);
});
test('default provider is selected once and embedded VOD never offers upstream APK updates',()=>{
  const defaults=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmVodDefaults.kt');
  assert.match(defaults,/if \(UserPreferences.currentProvider == null\)/);
  assert.match(defaults,/TmdbProvider\("en"\)/);
  const updater=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/utils/InAppUpdater.kt');
  assert.match(updater,/CHARM_VOD_EMBEDDED\) return null/);
  assert.match(updater,/CHARM_VOD_EMBEDDED\) return emptyList\(\)/);
});
