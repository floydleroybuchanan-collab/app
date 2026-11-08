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

test('VOD handoff rejects uncertain decoder ownership before applying shared settings',()=>{
 const s=source('android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt');
 const config=s.slice(s.indexOf('@ReactMethod fun configureSurface'),s.indexOf('@ReactMethod fun surfaceMenu'));
 assert.match(config,/context.runOnUiQueueThread/);
 assert.match(config,/hasReleaseFailure\(\) \|\| NativeMultiview.active \|\| NativePlaybackManager.currentOwner\(\) != NativePlaybackManager.Owner.NONE/);
 assert.ok(config.indexOf('promise.reject(')<config.indexOf('CharmSharedPlayback.configure(settings)'));
 assert.match(s,/context.addActivityEventListener\(activityListener\)/);
 assert.match(s,/override fun invalidate\(\)[\s\S]*context.removeActivityEventListener\(activityListener\)/);
});
test('VOD Back preserves inner TV/mobile player and settings layers before popping a screen',()=>{
 const s=source('android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt');
 for(const type of ['PlayerTvFragment','PlayerMobileFragment','SettingsTvFragment','SettingsMobileFragment']) assert.ok(s.includes('is com.streamflixreborn.streamflix.fragments.'+(type.startsWith('Player')?'player.':'settings.')+type));
 assert.match(s,/if \(page\?\.view == null\) false/);
 assert.match(s,/promise.resolve\(handled \|\| host\?\.navController\?\.popBackStack\(\) == true\)/);
});
test('embedded VOD integrates Stop into the auto-hiding native TV player controls',()=>{
 const route=source('src/components/MediaLabVodContent.tsx');
 const controller=source('android/vod/app/src/main/res/layout/content_exo_controller_tv.xml');
 const player=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/player/PlayerTvFragment.kt');
 assert.doesNotMatch(route,/vod-stop-and-exit|Stop &amp; Exit|surfaceStop\(\)/);
 assert.match(controller,/android:id="@\+id\/btn_exo_stop"/);
 assert.match(controller,/android:text="Stop"/);
 assert.ok(controller.indexOf('@+id/btn_exo_sources') < controller.indexOf('@+id/btn_exo_stop'));
 assert.ok(controller.indexOf('@+id/btn_exo_stop') < controller.indexOf('android:id="@id/exo_settings"'));
 assert.match(controller,/btn_exo_sources[\s\S]*nextFocusRight="@id\/btn_exo_stop"/);
 assert.match(controller,/btn_exo_stop[\s\S]*nextFocusLeft="@id\/btn_exo_sources"[\s\S]*nextFocusRight="@id\/exo_settings"/);
 assert.match(player,/btnExoStop\.setOnClickListener[\s\S]*player\.pause\(\)[\s\S]*findNavController\(\)\.navigateUp\(\)/);
});
test('VOD settings grid measures the host width and uses fixed safe-area padding',()=>{
 const s=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/CharmSettingsLayout.kt');
 assert.match(s,/clipToPadding = true/);
 assert.match(s,/val leftInset = dp\(if \(embedded\) 76 else 24\)/);
 assert.match(s,/root.width.takeIf \{ it > 0 \} \?: return/);
 assert.match(s,/coerceIn\(1, 4\)/);
 assert.match(s,/root.addOnLayoutChangeListener/);
 assert.doesNotMatch(s,/root\.width\*\.135f/);
 assert.doesNotMatch(s,/row\.addView\(sections/);
 assert.match(s,/sections\.visibility = View\.GONE/);
});
test('VOD detail pages expose only the unified action row on TV',()=>{
 const movie=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/adapters/viewholders/MovieViewHolder.kt');
 const show=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/adapters/viewholders/TvShowViewHolder.kt');
 assert.match(movie,/btnMovieTrailer\.visibility = View\.GONE[\s\S]*btnMovieFavorite\.visibility = View\.GONE[\s\S]*charmDetailMyList\.setOnClickListener/);
 assert.match(show,/btnTvShowTrailer\.visibility = View\.GONE[\s\S]*btnTvShowFavorite\.visibility = View\.GONE[\s\S]*charmDetailMyList\.setOnClickListener/);
});
test('Live home places the refreshable VOD history shelf after recent channels',()=>{
 const home=source('app/(tabs)/index.tsx');
 const shelf=source('src/components/MediaLibraryShelf.tsx');
 assert.ok(home.indexOf('Recently Watched Channels') < home.indexOf('<MediaLibraryShelf />'));
 assert.match(shelf,/useIsFocused\(\)/);
 assert.match(shelf,/AppState\.addEventListener\("change"[\s\S]*state === "active"[\s\S]*setRevision/);
 assert.match(shelf,/Recently Watched Video On Demand/);
});
test('home shelf combines resumable progress with immediate recent playback records',()=>{
 const s=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmLibraryProvider.kt');
 assert.match(s,/getWatchingShelf\(30\)/);
 assert.match(s,/movieDao\(\)\.getRecentlyWatched\(\)\.first\(\)/);
 assert.match(s,/tvShowDao\(\)\.getRecentlyWatched\(\)\.first\(\)/);
 assert.match(s,/distinctBy/);
 assert.match(s,/lastPlayedAtMillis/);
});
test('shared-activity VOD presence follows the attached surface instead of the activity name alone',()=>{
 const s=source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmUsageReporter.kt');
 const report=s.slice(s.indexOf('private fun report()'));
 assert.match(report,/if \(activity == null\) "idle" else if \(CharmHostSession.hasSurface\(activity\)/);
 assert.ok(report.indexOf('CharmHostSession.hasSurface')<report.indexOf('val active='));
});


test('host declares the settings Back dispatch superclass dependency explicitly',()=>{
 const host=source('android/app/build.gradle');
 const vod=source('android/vod/app/build.gradle');
 for(const gradle of [host,vod]) assert.match(gradle,/implementation ['"]androidx.preference:preference-ktx:1\.2\.1['"]/);
});
