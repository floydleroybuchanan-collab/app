import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
test('VOD native child layout is coalesced, size-bound and cancelled on detach/dispose',()=>{
 const s=source('android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt');
 assert.match(s,/override fun requestLayout\(\)[\s\S]*?super.requestLayout\(\)[\s\S]*?scheduleNativeLayout\(\)/);
 assert.match(s,/layoutPosted \|\| layingOutChildren/);
 assert.match(s,/!disposed && isAttachedToWindow && width > 0 && height > 0/);
 assert.match(s,/measure\(View.MeasureSpec.makeMeasureSpec\(width, View.MeasureSpec.EXACTLY\)/);
 assert.match(s,/layout\(left, top, right, bottom\)/);
 assert.match(s,/override fun onDetachedFromWindow\(\)[\s\S]*?removeCallbacks\(layoutNativeChildren\)/);
 assert.match(s,/fun dispose\(\)[\s\S]*?removeCallbacks\(layoutNativeChildren\)/);
 assert.doesNotMatch(s,/postDelayed\(layoutNativeChildren/);
});
test('VOD replacement invalidates old fixed-id container and guards activity-wide cleanup',()=>{
 const s=source('android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt');
 assert.match(s,/activeSurfaces\[activity\]\?\.get\(\)\?\.takeIf \{ it !== this \}\?\.dispose\(\)/);
 assert.match(s,/findFragmentByTag\(HOST_TAG\)/);
 assert.match(s,/if \(activeSurfaces\[activity\]\?\.get\(\) === this\)/);
 assert.match(s,/container.id = View.NO_ID/);
});
test('VOD lifecycle decorators never restyle React Navigation text outside Yoga',()=>{
 const s=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmDesign.kt');
 for(const callback of ['onFragmentStarted','onFragmentViewCreated']) {
   const block=s.slice(s.indexOf('override fun '+callback));
   const guard=block.indexOf('if (!fragment.javaClass.name.startsWith("com.streamflixreborn.streamflix.")) return');
   assert.ok(guard>0 && guard<550);
 }
});

test('VOD initialization failures share cleanup and never remove an unadded fragment',()=>{
 const s=source('android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt');
 const mount=s.slice(s.indexOf('private fun mount()'),s.indexOf('private fun navigate'));
 assert.ok(mount.indexOf('try {') < mount.indexOf('AnimeOnlineNinjaProvider.init(activity)'));
 assert.match(mount,/catch \(error: Exception\)[\s\S]*dispose\(\)/);
 assert.match(s,/host\?\.takeIf \{ it.isAdded && !activity.supportFragmentManager.isDestroyed \}/);
});

test('embedded VOD initializes catalog defaults before graph creation and starts home without a provider chooser',()=>{
 const s=source('android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt');
 assert.ok(s.indexOf('CharmVodDefaults.apply()') < s.indexOf('val fragment = NavHostFragment()'));
 assert.match(s,/graph.setStartDestination\(if \(section in setOf\("settings", "accounts"\)\) VodR.id.settings else VodR.id.home\)/);
 assert.doesNotMatch(s,/NavHostFragment.create/);
 assert.match(s,/next == "sources" && !settingsSurface/);
 const defaults=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmVodDefaults.kt');
 assert.match(defaults,/TmdbProvider\("en"\)/);
});
test('shared VOD options remain reachable without duplicate native menu and donate chrome',()=>{
 const drawer=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmPageDrawer.kt');
 assert.match(drawer,/if \(!CharmHostSession.hasSurface\(activity\)\) \{\s*root.addView\(donate/);
 assert.match(drawer,/fun open\(activity: FragmentActivity\): Boolean/);
 const bridge=source('android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt');
 assert.match(bridge,/@ReactMethod fun surfaceMenu\(promise: Promise\)/);
 assert.match(bridge,/CharmPageDrawer.open\(activity\)/);
 const page=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmVodPageLayout.kt');
 assert.match(page,/val top = if \(unified\) root.dp\(8\)/);
});


test('catalog Up handoff respects nested first rows, native headers and player ownership',()=>{
 const s=source('android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt');
 const handoff=s.slice(s.indexOf('private fun handoffUpToToolbar'),s.indexOf('override fun dispatchKeyEvent'));
 assert.match(handoff,/currentDestination\?\.id == VodR.id.player/);
 assert.match(handoff,/!target.isShown \|\| !target.isFocusable/);
 assert.match(handoff,/while \(parent is View && parent !== this\)/);
 assert.match(handoff,/manager.findViewByPosition\(0\)/);
 assert.match(handoff,/recycler.canScrollVertically\(-1\)/);
 assert.match(handoff,/to.centerY\(\) < from.centerY\(\)/);
 assert.match(handoff,/target.requestFocus\(View.FOCUS_UP\)/);
 assert.match(s,/@ReactProp\(name = "toolbarFocusTag"/);
});

test('host declares its RecyclerView focus API dependency explicitly',()=>{
 const gradle=source('android/app/build.gradle');
 assert.match(gradle,/implementation ['"]androidx.recyclerview:recyclerview:1\.3\.2['"]/);
 const vod=source('android/vod/app/build.gradle');
 assert.match(vod,/androidx.leanback:leanback:1\.2\.0/);
});
