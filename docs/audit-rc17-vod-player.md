# RC17 VOD and player audit

Audit baseline: RC17 build 224, HEAD ed22cb45. Scope: shared VOD integration, native and React playback ownership, VOD search/catalog controls, fullscreen controls, and Multiview. This is a source-path review plus automated checks, not a certification that every provider or device works.

## Reviewed paths and contracts

| Area | Reviewed call path / ownership | Evidence and limits |
|---|---|---|
| VOD entry | mediaLibrary.openMediaLibrary → /vod or /vod-settings → MediaLabVodContent → stopAllPlaybackSessions → CharmVod.configureSurface → CharmVodSurface | React cancellation prevents mounting after blur. Native handoff now rejects unresolved live/Multiview ownership. |
| Embedded host | CharmVodSurface mount / navigate / dispose; CharmHostSession; CharmDesign; CharmPageDrawer; CharmVodPageLayout | One surface per activity, stale fixed-ID container invalidation, coalesced native layout, canceled posted work, decorators exclude React fragments. Defaults applied before graph; home starts directly; provider chooser requires settings context. |
| Remote navigation | toolbar tag → CharmVodSurface.handoffUpToToolbar; surfaceMenu; surfaceBack | Up checks nested catalog first rows and higher native controls, excludes player. Inner player/settings Back is now restored before navigation pop. Physical remote behavior remains a device check. |
| Live/fullscreen | StreamPlayer → playbackSession → nativePlayback coordinator → NativePlaybackModule → NativePlaybackManager | Generation/channel/role guards on state, track and source refresh results; stale resolver completions rejected. Preview/fullscreen teardown serialized. Pause on foreground loss remains separate from final release. No retry or audio-silence deadline changed. |
| Recovery and stream type | NativePlaybackManager pending preparation, startup deadline, fresh-source timeout, opaque candidate routing, detected-type cache | Uses the Media3 connection for opaque routing; bounded candidate policy and capped detected-type cache retained. Diagnostics/recovery test suites passed. No authenticated stream/end-to-end codec test performed here. |
| Settings/tracks/timeline | player.tsx; StreamPlayer track effects; NativePlaybackModule timeline/seek; CharmSharedPlayback | Owner/channel/generation gates retained. Shared subtitle/audio/buffer choices enter VOD. Native stable buffer target stays 48 MB; this is an allocator target, not total RAM. |
| VOD player lifecycle | PlayerTvFragment onPause/onDestroyView/releasePlayer; mobile Back contract; NovaPlayback teardown/reporting references | TV pauses on pause, cancels episode prefetch, detaches surfaces and releases player/session on destroy. Mobile/Nova were targeted lifecycle/entry-point reads, not full line-by-line implementations. |
| VOD search | SearchViewModel search/loadMore/searchGlobal; SearchCatalog; CharmCatalogControls | Query/page jobs cancel on replacement; cancellation propagates; duplicates filtered by type/id; later-page error retains results. Global search fan-out now shares four permits across query replacements. |
| Library bridge | CharmVodModule libraryScope → private CharmLibraryProvider → provider/Room → JSON | Same-UID guard, 20 s timeout, 200-character query, 30 returned items. Shelf-specific SQL limits each input to 30 rows before merging; full saved-library queries remain unchanged. |
| Multiview | app/multiview.tsx → session stop registration → MultiviewModule → NativeMultiview | Token/revision guards, max 4 panes, 12 MB allocator target per pane (48 MB total), weak surface references, one audible pane; pause releases decoders, resume recreates; critical-memory handler releases panes; failed release blocks new session. Module unregisters lifecycle/memory callbacks. |
| Presence | CharmUsageReporter callbacks/tick → authenticated activity report | No titles or provider URLs in payload. Shared activity now uses attached-surface ownership for mode classification. Existing one in-flight request, 5 s connect/read timeout and 30 s tick retained. |

## Fixed findings

1. **VOD could proceed after a failed live/Multiview release.** playbackSession intentionally tolerates teardown errors, so awaiting it alone was not proof of decoder release. CharmVod.configureSurface now checks NativePlaybackManager release failure/current ownership and NativeMultiview.active on the UI thread, rejecting before configuring/mounting VOD.
2. **Module recreation retained an activity-result listener.** CharmVodModule installed an anonymous listener without removing it. The listener now has explicit ownership and is removed in invalidate; existing coroutine cancellation remains.
3. **Shared Back bypassed native player/settings sublayers.** surfaceBack popped the navigation stack directly, losing the original player controller/zoom/settings and nested settings Back behavior. It now calls public TV/mobile handlers first, then pops only if unhandled; missing fragment views are guarded.
4. **Embedded VOD presence was classified as live TV.** Activity class detection always saw the shared host. Each report now considers CharmHostSession.hasSurface before choosing vod/iptv, while preserving idle handling.

Changed implementation files: android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt; android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmUsageReporter.kt. Regression assertions added to tests/vodNativeSurface.test.mjs.

## Validation

- 110 tests passed across VOD native/integration/handoff/catalog, playback session/recovery/source refresh/opaque routing, fullscreen ownership/stability/preferences/focus.
- 22 tests passed after the final Multiview guard, covering Multiview picker/layout/policy/focus and VOD native contracts. These overlap the earlier run; counts are not additive.
- Existing VOD integration source-verification script passed in the 110-test run.
- New native assertions are source-contract checks, not executed Android lifecycle tests. Existing JS ownership/toolbar tests execute isolated code with mocked bridges.
- No APK build, push or device manipulation performed by this subagent. Parent native compilation reached the VOD Kotlin task and identified the Room auto-close opt-in; the narrow annotation was added. The parent is running the incremental native gate.

## Runtime unknowns / release checks

- Verify physical remote Up from every first-row column, Search header traversal, Options dismissal and exact focus restoration.
- Verify Back closes TV/mobile controller/settings/zoom before leaving playback, and nested VOD settings return one level.
- Inject a decoder-release failure and confirm VOD refuses to start; repeat after Multiview teardown failure.
- Repeat live→VOD→live and Multiview→VOD loops; check codec count, retained fragments and heap trend.
- Confirm authenticated VOD playback reports vod/playing while shared host is active, and idle after backgrounding.
- Exercise provider authentication, expired signed links, source switching, subtitle/audio tracks, seek/resume and long-running playback on actual hardware.

## Separate recommendations, not completed fixes

- Completed in the follow-up: global search shares four permits, preserving all-provider coverage and cancellation.
- Completed in the follow-up: shelf-only DAO queries now use LIMIT 30; full saved-library APIs remain unchanged.
- Profile catalog pagination retention and sorting copies during long sessions; RecyclerView virtualization alone does not bound retained result arrays.
- Add Android instrumentation for the host focus boundary and native Back hierarchy, plus injected failed-release tests.
- Audit vendor providers/resolvers individually with recorded fixtures and authorized live accounts. Broad name/search scans here do not establish correctness of every provider implementation, resolver, cache, or mobile player branch.


## Continued overload and lifecycle audit

### Additional fixes

- Global Search shares a four-permit semaphore across replacements; waiting coroutines remain cancellable. It still visits every target provider; no provider list or result list was truncated.
- New shelf-only DAO queries cap Movies/TV favorites and Movies/Episode continue previews at 30 rows per kind. The existing bridge still returns 30 items. SQL tests compare old/new merged preview ordering and prove stored rows remain intact. Exact reviewed hashes for the three DAO changes were added; upstream hashes remain unchanged.
- Reloadable Home snapshots retain only two providers in RAM; cache admission rejects catalogs over 2,000 items or 8 MiB serialized data without truncating the live response. Snapshot disk storage is limited to 32 MiB/eight files; writes use AtomicFile. Eviction touches only home-cache JSON snapshots.
- UserDataCache retains only two provider mirrors in RAM; every saved item remains on disk. Both home/user-data RAM mirrors clear through the process-lifetime shared memory coordinator. No Activity is captured.
- CacheUtils no longer recursively deletes live cache directories. Shared-host recovery clears only the current provider's reloadable Home snapshot; isolated VOD uses Glide's owner APIs. Disk cleanup runs off the UI thread and duplicate requests coalesce.
- Embedded provider chooser no longer restarts MainActivity with CLEAR_TASK. TV/mobile choices report a host route, and React replaces the Settings route with VOD Home, disposing the old provider-bound host. Standalone legacy activity behavior remains available only outside an embedded surface.

### Runtime start / stop / cleanup ledger

| Work | Start / owner | Stop / cancellation | Retained state / limit |
|---|---|---|---|
| Native VOD fragment graph | Mounted focused React surface | dispose removes fragment, drawer/session registration and pending layout/mount callbacks | One host per activity; no extra decoder before native release check |
| VOD layout | requestLayout, size, destination, reattach | Coalesced posted pass; canceled detach/dispose | Exact existing Yoga bounds; no polling loop |
| Catalog search | SearchViewModel viewModelScope | New query cancels query and page job; ViewModel clearing cancels scope | Four shared global-provider permits; all providers retained |
| Catalog paging | User scroll triggers loadMore | Page job canceled on new search | Lists still grow across deliberate pagination; UI virtualization is not a retained-data bound |
| Library previews | CharmVodModule IO scope | Module invalidate cancels scope; provider call has 20 s timeout | Shelf SQL 30/type; bridge 30 items; query 200 characters |
| Home snapshots | Home loading/writing | Memory coordinator drops RAM; atomic write succeeds or rolls back | Two RAM provider entries; 2,000 items/8 MiB admission; 32 MiB/eight disk snapshots |
| Saved-data mirrors | UserDataCache read/write helpers | Memory coordinator clears mirrors | Two RAM providers; saved files and full library remain intact |
| Cache recovery | Fragment Retry/cache action | Coalesced worker; no journal deletion | Owner-only Glide APIs in isolated process; shared Home snapshot only |
| VOD HTTP | VodHttp suspendCancellableCoroutine | Cancels underlying Call; canceled response closes | 15 s connect/25 s read/40 s call; 2 MB text-body limit |
| Debrid linking | Dialog-scoped DebridLinkViewModel | cancel/restart and viewModelScope; device-code elapsed-time deadline | 5 s minimum poll interval; maximum 30 minute code lifetime; session revision rejects stale credential acceptance |
| Debrid resolve | RealDebrid credentials + auth mutex | HTTP cancellation, 90 s resolve timeout, 20 bounded polling attempts | Owned-transfer map capped 100; generation changes on disconnect; no token logging |
| Debrid cloud transfer cleanup | Only a newly created transfer from exact play attempt | Cached-only not-ready branch deletes that new transfer | Existing user cloud records are not deleted; cancellation/timeout is not proof that every newly created remote transfer was removed |
| Native playback | Singleton live owner or separate embedded VOD player | Serialized release barriers; pause separate from teardown | Stable allocator target 48 MB, not whole-process RAM |
| Multiview | Session token + per-pane revision | Registered stop callback, suspend/end, low-memory release | Max 4 panes; 12 MB/pane allocator target; failed release blocks new starts |
| Presence | One process reporter, authenticated session | Token cleared disables sends; activity pause changes mode | One in-flight HTTP request; 30 s tick; no titles/provider URLs |

### Fixed cross-provider search/backstack ownership

Provider selection previously closed a singleton Room database retained by Search and catalog ViewModels. The new source-keyed registry reuses weakly held wrappers without closing another source's owner; Room closes idle connections after 15 seconds and reopens them on demand. Explicit destructive restore still closes all registered wrappers. Privately acquired databases used by sync/artwork remain separately owned and closeable. No saved rows, schema, migration, or provider URL behavior changed.

Catalog/search/detail ViewModels now resolve the provider belonging to their database. Home snapshot and saved-data reads/writes use that captured provider key. Result and saved-library rows receive source identity for existing adapter actions. A source key on each native navigation backstack entry restores the correct selected provider when returning from another provider's result; the Search query/results and detail navigation remain intact. This applies to the shared surface and standalone navigation setup. Global search retains its complete target list.

Refresh invalidations now broadcast with a one-event bounded SharedFlow instead of distributing each event to only one collector. Source-bound ViewModels ignore refreshes for other sources. Duplicate Home fragment initial/refresh requests were removed; the ViewModel owns that work. No graph reset or forced database closure is performed on ordinary selection.

Executed JVM tests cover A → B → A retaining original saved data and identity, concurrent acquisition sharing one wrapper, explicit restore closing all wrappers, and one refresh reaching both active collectors (4 passed). Node source contracts verify source ownership, cache keys, navigation hookup, idle timeout and single Home refresh ownership. Android runtime verification of process recreation, cross-provider Search → detail → Back, and Room idle close/reopen remains required; the JVM test does not simulate Room itself.

### Follow-up checks and compilation feasibility

- 26 targeted memory/VOD/integrity/handoff tests passed, including executed SQLite preview-equivalence checks. Four additional isolated Kotlin/JUnit ownership and broadcast tests passed.
- Extended memory/VOD run exposed an existing nativePlatformHardening source assertion expecting the trim enum in its former file after the parent's policy extraction; parent notified. TypeScript check passed.
- New tests cover semaphore placement, non-recursive cache clearing, RAM-only trim, and embedded chooser routing. These native checks are source contracts, not Android execution.
- Read-only local dependency check found RecyclerView 1.3.2 and Android SDK platforms 35/36/37. No Gradle 8.14.3 wrapper distribution was found in the standard local distribution cache; cached AGP directories were 8.6.1/9.3.3. Complete offline native compile feasibility is not established. No APK build was attempted.
- Not every vendor provider/network/cache implementation was read. No full download-manager implementation was established from the inspected VOD package; the reviewed debrid flow resolves remote playback/cloud transfers rather than downloading media files to local storage.
