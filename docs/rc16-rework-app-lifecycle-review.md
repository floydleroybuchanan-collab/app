# MediaLab lifecycle review before packaging

This review covers the RC16-derived rework. The APK has not been packaged. TextureView remains the live playback surface, as requested. Source tracing and tests cannot establish that every button on every device is free of memory pressure or that all streams play without dropped frames.

## Findings corrected

- The guide overlay's Android View background remained black beneath translucent cells. The background and duplicate overlay fill are corrected; header dividers and the now-marker no longer extend into nonexistent channel rows.
- Native guide pending-query replacement, detach/dispose, and EPG cache clear/query races have explicit ownership or generation checks.
- VOD home caching now has expiry and RAM/disk limits for reloadable snapshots. Memory trim uses a short RAM lock rather than waiting behind parsing/disk work. In-flight work cannot refill RAM after trim. Oversized replacements remove stale disk snapshots.
- Import lease waits and blocking worker imports now cooperate with cancellation. Parser loops and the final pre-swap path check interruption.
- Live/VOD share engine policy and single-main-player ownership. Extra VOD buffering no longer bypasses the allocation target. Stop is inside the native controller and hides with it.
- Repeated VOD progress-timer starts cancel the previous timer. Episode UI work uses the view lifecycle; history persistence retains its separate ownership.
- Home/history refresh requests supersede their predecessors; enrichment has provider-scoped reloadable caches and bounded concurrency. Duplicate-only search pages stop pagination. Global provider search limits concurrent work without dropping configured targets.
- Two legacy provider DOM caches and Vavoo's channel-name lookup cache now have synchronized capacity/expiry limits. Eviction does not mutate returned pages or trim published channel results. Expiry sweeps are paced to avoid scanning the entire cache for every channel insertion.
- Real-Debrid arrival reveals the top results once; later updates preserve selection and do not steal toolbar focus.
- The host VOD activity-result listener now unregisters when its React module is invalidated, alongside coroutine cancellation.
- New provider diagnostics no longer include usable source/challenge URLs, response-body excerpts or propagated provider exception text; fixed messages and counts remain.
- Xtream/Stalker catalog and detail requests receive a screen-owned cancellation signal. Leaving/changing the browser cancels pending work, including Stalker authentication, rather than merely ignoring a late result. Hidden playlist-browser catalog state is released and reloaded on return, retaining the selected title identity for restoration after playback.
- Settings use one native scroller; nested Back stays inside settings before leaving. Trailer/My List keep separate adjacent constraints. The home VOD row includes recent viewing and refreshes on focus/resume.

## Ownership checked

| Area/actions | Start and stop behavior reviewed | Remaining boundary |
|---|---|---|
| Live home, channels, favorites, reminders | Their display clocks stop on route blur; focus listeners unsubscribe | Large catalogs and background OS scheduling need device profiling |
| Main drawer/icon rail | Focus-scoped native event subscriptions remove on cleanup; idle timeout clears and guards asynchronous replies | Rapid remote navigation needs a physical remote soak test |
| Guide/transparent guide | Bounded row caches, focus-centered retention, query generation, detach/dispose and critical trim | Metadata maps and query queues need representative catalog measurements |
| Playlist VOD catalog/details | Owner/kind/focus cleanup aborts requests; late state publication is guarded | JSON body conversion still has transient allocation peaks; not every transport is streaming |
| Native VOD browse/search/source dialogs | Replaceable jobs, cooperative cancellation, dialog dismissal cleanup, bounded concurrency | Legacy adapters may block until their own timeout; not all adapters have measured memory budgets |
| Live/fullscreen/VOD playback | Shared owner, release failure handling, surface detachment, timer cleanup and auto-hiding controls | VOD can retain a paused decoder while its view survives; total process RAM is not the buffer budget |
| Home VOD history/favorites | Route focus/resume refresh; native reads run off the UI thread; listeners remove on cleanup | Historical queries can project large lists before the shelf limit; retained saved data is not disposable cache |
| Account/announcements/source scheduling | Existing interval/subscription cleanup and foreground guards inspected | Intentional application-wide work outlives individual pages |
| Saved settings/libraries/backups | Kept separate from reloadable-cache cleanup | This pass does not make multi-store restore globally transactional |

## Validation and interpretation

The final whole-repository interaction scan inspected 784 files, 5,866 function declarations, 105 timer sites, 66 listener sites and 45 network-fetch sites at its recorded snapshot. It reported no candidate critical findings. Exact source guards were re-reviewed for catalog cancellation and the parser interruption checkpoint; they remain pinned to reviewed hashes. This is a static pattern scan, not a manual proof of each function or an execution of every action.

The Python guard suite passed 35 tests. The JavaScript suite passed 487 tests, TypeScript and lint passed, and the Android host compiled with 37 passing unit tests. Native VOD compilation passed; 29 unique targeted VOD tests passed across the final run and cache-harness rerun (24 non-cache tests plus five home-cache tests). The earlier four home-cache failures occurred during test application initialization and were resolved using an isolated test application; all five cache tests then executed and passed with zero skips. Native tests exercise import cancellation, cache races/budgets, player ownership, settings bounds, controller visibility, source-list behavior and pagination. These are debug/unit checks, not a signed release build or device soak test.

Still required for performance claims: weak-device and Android TV navigation/playback soak tests, before/after Java/native/JS heap measurements, codec/file-descriptor counts, dropped-frame and refresh-rate traces, and live compatibility checks for the provider additions. No percentage speedup, total-memory ceiling, zero-crash claim, or complete reference-app parity is established.

Detailed evidence: `rc16-rework-guide-memory-evidence.md`, `rc16-rework-vod-lifecycle.md`, `rc16-rework-playback-trace.md`, and `rc16-rework-providers.md`.
