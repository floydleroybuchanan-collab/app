import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
test('VOD native child layout is coalesced, size-bound and cancelled on detach/dispose',()=>{
 const s=source('android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt');
 assert.match(s,/override fun requestLayout\(\)[\s\S]*?super.requestLayout\(\)[\s\S]*?scheduleNativeLayout\(\)/);
 assert.match(s,/layoutPosted \|\| layingOutChildren/);
 assert.match(s,/!disposed && isAttachedToWindow && width > 0 && height > 0/);
 assert.match(s,/root.measure\(View.MeasureSpec.makeMeasureSpec\(width, View.MeasureSpec.EXACTLY\)/);
 assert.match(s,/root.layout\(0, 0, width, height\)/);
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
