import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');

test('VOD retains upstream implementations except exact reviewed player changes',()=>{
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
test('VOD navigation uses a transparent proportional Charming MediaLab header mark',()=>{
  const activity=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/activities/main/MainTvActivity.kt');
  const header=read('android/vod/app/src/main/res/layout/content_header_menu_main_tv.xml');
  assert.match(activity,/R\.drawable\.medialab_launcher/);
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

test('both VOD community controls resolve the panel link without embedding a room invitation',()=>{
  const base='android/vod/app/src/main/';
  for(const layout of ['Tv','Mobile']) {
    assert.match(read(base+`java/com/streamflixreborn/streamflix/fragments/settings/Settings${layout}Fragment.kt`),/CharmCommunityAccess\.open\(/);
  }
  const strings=read(base+'res/values/charm_vod_strings.xml');
  assert.doesNotMatch(strings,/https:\/\/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)/);
  const api=read('src/auth/accountApi.ts').match(/ACCOUNT_API_BASE_URL = "([^"]+)"/)[1];
  assert.ok(strings.includes(api));
  const community=read(base+'java/com/streamflixreborn/streamflix/charm/CharmCommunityAccess.kt');
  assert.match(community,/\/auth\/community/);
  assert.match(community,/"community_url"/);
  assert.match(community,/QrUtils\.generate\(/);
});
