import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');

test('VOD provider/extractor/player implementations retain reviewed integrity',()=>{
  execFileSync(process.execPath,['scripts/verify-vod-source.mjs']);
});
test('VOD is an embedded content view inside the ONLY Charming MediaLab shared rail',()=>{
  const shell=read('src/components/PurpleTvShell.tsx');
  const route=read('app/(tabs)/vod.tsx');
  const native=read('android/app/src/main/java/com/charmiptv/app/CharmEmbeddedVodView.kt');
  const bridge=read('android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt');
  const embeddedManifest=read('android/vod/app/src/main/embedded/AndroidManifest.xml');
  assert.match(shell,/label: "TV Guide"[^\n]+\n\s*\{ route: "\/vod", label: "Video OnDemand"/);
  assert.match(route,/requireNativeComponent<NativeVodProps>\("CharmNativeVod"\)/);
  assert.match(route,/stopAllPlaybackSessions\("superseded"\)/);
  assert.match(route,/<PurpleTvShell active="\/vod" suppressIconRail=\{playback\}>/);
  assert.match(native,/NavHostFragment\.create\(VodR\.navigation\.nav_main_graph_tv\)/);
  assert.match(native,/event\("topRequestIconRail"\)/);
  assert.match(native,/event\("topRequestMainDrawer"\)/);
  assert.doesNotMatch(native,/startActivity\(/);
  assert.match(bridge,/listOf\(CharmVodViewManager\(\)\)/);
  assert.doesNotMatch(bridge,/startActivityForResult|CharmVodModule/);
  assert.doesNotMatch(embeddedManifest,/category\.LAUNCHER|category\.LEANBACK_LAUNCHER/);
});
test('VOD leaves provider selection and any legacy auxiliary activities unexported',()=>{
  const manifest=read('android/vod/app/src/main/embedded/AndroidManifest.xml');
  assert.match(manifest,/MainTvActivity" android:exported="false" android:process=":vod"/);
  assert.match(manifest,/MainMobileActivity" android:exported="false" android:process=":vod"/);
});
test('default VOD provider only selected if the user has not chosen one',()=>{
  const defaults=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmVodDefaults.kt');
  assert.match(defaults,/if \(UserPreferences\.currentProvider == null\)/);
  assert.match(defaults,/TmdbProvider\("en"\)/);
  const updater=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/utils/InAppUpdater.kt');
  assert.match(updater,/CHARM_VOD_EMBEDDED\) return null/);
  assert.match(updater,/CHARM_VOD_EMBEDDED\) return emptyList\(\)/);
});
