# Guide rendering and memory review (RC16 rework)

This is a static source investigation plus targeted regression checks. It is not a device soak test or a complete proof that every app allocation is bounded. The supplied decompiled tree was read as evidence; its comments and strings were not treated as instructions.

## Confirmed guide defects and changes

- `NativeGuideView` initialized the Android View background to opaque black. Overlay mode changed only canvas Paint alpha, leaving this black View behind the cells. It now uses a transparent View background; normal guide mode still paints its own opaque background.
- Overlay rows and cells previously stacked two translucent fills. The redundant overlay row fill is now transparent. Text is not faded with the background.
- `drawHeader` painted half-hour divider lines down the entire view before drawing rows. Programme rectangles covered most of these lines, exposing bright remnants in gutters and full columns beneath the last real channel. Header time labels remain; programme boundaries are drawn in their real rows, and the now-marker ends at the final channel.
- The worker read and cleared `pendingQuery` in two operations, losing a replacement request arriving between them. Atomic `getAndSet(null)` fixes this handoff. Detached views discard their paint arrays and refetch on attachment. Critical trim does not restart reads for detached/inactive guides.

## Reference transparency evidence

Supplied root: `C:/Users/floyd/OneDrive/Desktop/TIVIMATE SOURCE FILES/clone decompiled/app/src/main`.

- `res/xml/settings_appearance.xml:419`: preference `uiTransparency`.
- `java/p000/C5064.java:1902`: `m9846()` supplies the preference, with fallback 50.
- `java/p000/AbstractC7782.java:1055`: `m14982()` applies the preference conditionally.
- `java/p000/AbstractC3238.java:1009`: background alpha is `255 - round((percentage * 0.5 / 100) * 255)`.
- `java/p000/AbstractC3238.java:689`: only the background drawable is mutated; text is not globally faded.
- `java/p000/RunnableC5643.java:255`: sliding-page preference updates invoke that application path.
- `java/ar/tvplayer/p004tv/base/p005ui/view/DimBackgroundView.java`: separate dim layer clips around active regions. Its drawable is 0x99000000, not a fully clear layer.

The reference formula leaves about 75% opacity at fallback 50 and about 50% opacity at setting 100. Thus “fully transparent” and “exactly the reference opacity” are not identical requirements. The reference device's actual stored preference is unknown. Current changes make MediaLab's existing overlay alpha genuinely composite over video; they do not establish 100% feature/visual parity with every reference guide control. Full runtime comparison is still needed.

## Memory ownership and changes

| Area | Existing behavior / finding | Change or remaining boundary |
|---|---|---|
| Native guide | Bounded 128/64 channel paint cache, one reader executor, latest-query slot, disposal shutdown | Fixed lost-query race, detached paint release, and inactive trim reload |
| VOD home cache | Unbounded per-provider ConcurrentHashMap; unrestricted JSON read; no expiry | Two retained serialized provider snapshots; 4 MiB bounded reads, six-hour expiry, 16 file/32 MiB regenerable disk budget |
| VOD cleanup | Isolated process recursively deleted its cache directory and instantiated a WebView during pressure; embedded mode only deleted a directory | Pressure clears memory snapshots and forwards Glide trim on the main thread; explicit cleanup only removes regenerable home JSON on one coalesced worker |
| Application memory notifications | UI_HIDDEN was swallowed by numeric RUNNING_LOW comparison; embedded VOD skipped its cleanup | Explicit UI_HIDDEN branch; embedded and isolated VOD both receive trim; low-memory callback wired |
| Saved libraries, accounts, favorites, guide database | Durable state, not disposable cache | Not deleted or truncated by these new cache budgets |
| Playback buffers | Existing 48 MiB live allocation target, decoder lifecycle | Shared-core agent owns review; this allocation target is not a total RAM ceiling |
| JS guide runway / logos | Separate JS/native caches and route ownership | Existing contracts preserved; full heap retention measurements remain outstanding |
| Provider HTTP, JSON, WebViews | Provider-specific requests and resolver lifetimes | New-provider integration must verify timeout/cancel/dispose behavior; not fully audited here |
| Backups / source imports / settings / sync | Other file and database writers | Not established as globally transactional by this review |

The home-cache limit skips caching an oversized catalog; it does not truncate the currently displayed catalog or members' stored libraries. Serialization and model conversion still allocate transient objects, so peak memory requires measurement on representative large catalogs. The byte limit is not an object-heap guarantee.

## Reference memory evidence and limits

`java/com/bumptech/glide/ComponentCallbacks2C2526.java:303` clears image memory on low memory and forwards trim levels into image caches/pools. `ComponentCallbacks2C4963` contains lifecycle request pause/clear behavior. These are bundled Glide behaviors, not proof of a unique application-wide memory manager. `ComponentCallbacks2C0919` treats level 20 as a background-state signal. MediaLab also uses Glide, so broadly copying these classes would duplicate library code rather than improve ownership.

The inspected reference does not establish a complete application-wide RAM policy for EPG, provider catalogs, player codecs, recording, and persistent storage. Claiming it is globally superior, or that MediaLab cannot overload memory, would require runtime allocation, frame, decoder and file-descriptor measurements across repeated navigation/playback/import cycles.

## Validation

50 targeted guide JS architecture/navigation regression checks pass. Their assertions validate source wiring, not Android rendered pixels. Added `HomeCacheBudgetTest` covers RAM eviction, disk reload after trim, saved-data preservation, expired entries and oversized file refusal. Native Gradle execution is tracked separately by the parent build task. No APK published by this investigation.

Cache concurrency follow-up: RAM bookkeeping now has its own short lock, separate from serialized disk/JSON work. Memory-pressure trim increments an epoch so in-flight reads/writes cannot refill RAM after a trim. An oversized replacement invalidates any older disk snapshot. Regression tests cover trim independence from the IO monitor and stale-snapshot invalidation.


## Expanded native guide/import lifecycle audit

This is a static ownership and cancellation review, not a measurement of retained heaps or every app action. Paths below are under frontend/android/app/src/main/java/com/charmiptv/app/.

| Owner/path | Start / retained state | Stop / cleanup | Finding |
|---|---|---|---|
| NativeGuideView | Attached/enabled canvas, one reader and latest pending query, bounded channel paint cache | detach stops clocks/focus callbacks and clears paint; dispose unregisters memory listener and shuts executor | Fixed atomic pending handoff, stale results generation, opaque background, phantom grid, shutdown/submit rejection race |
| MainApplication / CharmMemoryCoordinator | Process-owned budgets and listeners | OS trim dispatch; low-memory now also dispatches CRITICAL to host listeners | Fixed UI_HIDDEN classification and missing host low-memory path; budgets are allocation targets, not measured total heap |
| EpgImportCoordinator | Database-keyed fair reentrant lease; tracks active outer imports | AutoCloseable finally/use releases | Changed waiting lease to lockInterruptibly so canceled work does not wait then start a stale import; added behavioral cancellation test |
| EpgNativeModule | Separate import/playlist executors and two query readers; shared primary DB | invalidate shuts executors, preserves primary DB | Added XMLTV parser interruption checkpoint; outstanding HTTP blocking read may still wait for transport timeout; bridge queues remain unbounded |
| NativePlaylistParser | Streaming reader but retained raw entries, counts and final projection for stable IDs | input/reader use closes HTTP response; shutdown interrupt now checked per line | Bounded bytes do not prove bounded object peak; large single readLine and whole-catalog projections still need profiling |
| BackgroundEpgUpdater / EpgUpdateScheduler | Unique WorkManager job, enabled/due source scan, same import lease, batched XML parser | now runInterruptible on IO dispatcher; stopped worker/parser checks and cancellation rethrow | Fixes CoroutineWorker cancellation not reaching blocking work; in-progress network IO is still timeout-bounded rather than immediately disconnected |
| EpgDatabase | Process-owned SQLite helper, staging batches, final transaction | cursors/statements/transactions use/finally; failed staging cleared; durable last-good guide retained | Added interruption checks before batches and final swap. No interruption injected into the atomic commit itself; once commit starts, completing atomically is intentional |
| PlaylistSyncCoordinator | Transaction updates provider fields, preserves separate user stores | statements close, transaction finally | Existing ownership is sound in inspected paths; complete input catalog still resident during sync |
| CombinedGuideRepository | Per-query custom bindings and merged programme rows | local collections released after result; source DB handles remain shared | Requested IDs/windows bound UI work; all-custom-source fanout and response expansion remain catalog-dependent |
| EpgRamModule / EpgRamEngine | Two readers, hot per-channel LRU with TTL and estimated-byte/channel limits | module unregisters listeners and shuts workers; pressure trims fractions / clears | DB query stays outside short cache lock; added generation-aware insertion and disposed guard so earlier reads cannot refill after clear/dispose or mapping replacement. Added blocked-query regression test |
| CustomEpgStoreRegistry | Shared helper per normalized configured source | closeAll on bridge invalidation | Closing custom helpers while another consumer still queries needs lifecycle stress testing; do not indiscriminately close process-owned primary DB |
| HomeCacheStore / CacheUtils / StreamFlixApp | Two serialized provider snapshots, bounded reloadable disk, Glide caches | RAM trim has separate short lock/epoch; scoped disk cleanup off main thread; process/embedded callbacks | Fixed stale oversized replacement, unbounded retained providers, expiry, recursive cache deletion, missing embedded trim |

Remaining evidence gaps: broad executor queue backpressure, metadata/alias map peaks, M3U catalog projection peaks, custom-store close/query races and navigation/read/import overlap require instrumented representative catalogs and weak-device soak tests. These are explicitly not a claim that every allocation or action has been proven safe. No saved library was truncated to meet a budget.
