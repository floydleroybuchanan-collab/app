import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');

test('VOD retains upstream implementations except reviewed player changes',()=>{
  execFileSync(process.execPath,['scripts/verify-vod-source.mjs']);
});
test('one activity, one process, one app: VOD is a native view in the host route',()=>{
  const shell=read('src/components/PurpleTvShell.tsx');
  const route=read('app/(tabs)/vod.tsx');
  const bridge=read('android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt');
  const viewManager=read('android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt');
  const fragment=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt');
  const manifest=read('android/vod/app/src/main/embedded/AndroidManifest.xml');
  const application=read('android/app/src/main/java/com/charmiptv/app/MainApplication.kt');
  assert.match(shell,/label: "TV Guide"[^\n]+\n\s*\{ route: "\/vod", label: "Video OnDemand"/);
  assert.ok(route.indexOf('await stopAllPlaybackSessions(')<route.indexOf('<NativeVod'));
  assert.match(route,/requireNativeComponent[\s\S]*?\("CharmVodSurface"\)/);
  assert.match(route,/immersiveContent=\{immersive\}/);
  assert.match(bridge,/createViewManagers[\s\S]*CharmVodSurfaceManager/);
  assert.doesNotMatch(bridge,/startActivity|openSettings|REQUEST_VOD/);
  assert.match(viewManager,/FragmentContainerView/);
  assert.match(viewManager,/host\.supportFragmentManager/);
  assert.match(fragment,/VodFocusCoordinator/);
  assert.match(fragment,/onHostBack/);
  assert.doesNotMatch(manifest,/android:process=":vod"|MainTvActivity/);
  assert.match(application,/extends not-a-class|class MainApplication : com\.streamflixreborn\.streamflix\.StreamFlixApp\(\)/);
  assert.doesNotMatch(application,/CharmVodProcess\.isVod/);
});
test('VOD navigation uses Charming branded glass bars without duplicate native rail',()=>{
  const fragment=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt');
  const layout=read('android/vod/app/src/main/res/layout/activity_main_tv.xml');
  assert.match(layout,/VodGlassActionBar/);
  assert.doesNotMatch(layout,/VodIconRail|CharmVodWelcomeView/);\n  assert.equal(layout.includes('android:id="@+id/nav_main"'),false);
  assert.doesNotMatch(fragment,/\bnavMain\b|ivSplashOverlay/);
  assert.match(fragment,/onHostIconRail/);
});
test('default provider remains selected and VOD does not install its own app updates',()=>{
  const defaults=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmVodDefaults.kt');
  assert.match(defaults,/if \(UserPreferences\.currentProvider == null\)/);
  assert.match(defaults,/TmdbProvider\("en"\)/);
  const updater=read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/utils/InAppUpdater.kt');
  assert.match(updater,/CHARM_VOD_EMBEDDED\) return null/);
  assert.match(updater,/CHARM_VOD_EMBEDDED\) return emptyList\(\)/);
});