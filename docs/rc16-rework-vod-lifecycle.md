# Native VOD lifecycle review

This is a source review with targeted native regressions, not proof that every remote service or device has been tested.

## Defects corrected

- **Source picker:** filtered results previously retriggered the first-debrid arrival on every filter/retry cycle, requesting focus away from controls. A per-dialog latch now reveals the first arriving debrid batch at the top once. Later updates preserve source identity; asynchronous arrivals never request toolbar focus. A native test covers ordering, toolbar focus, remove/reinsert, filtering and cancellation after dismissal.
- **Home requests:** fragment refreshes and provider-change notifications could overlap independently. HomeViewModel now owns one replaceable home request and one replaceable history refresh. Cancellation is propagated and checked before publishing fetched data. The current provider is checked before publishing history. Cache-first rendering remains.
- **History enrichment:** cancellation could be swallowed by runCatching; enrichment now uses the cancellation-preserving helper. Lookup keys include the provider name, and caches clear on provider changes. Reloadable show/season enrichment caches clear at a 128-entry threshold; saved history/favorites are not deleted. Remote enrichment is limited to four concurrent operations.
- **Search pagination:** providers returning the same nonempty page could trigger endless subsequent requests. Duplicate-only pages now terminate pagination while retaining existing results. Three tests cover repeat pages, mixed media with the same ID, and empty pages.
- **Global search:** all configured targets remain included, but at most four provider searches run concurrently. Cancelling/replacing the query cancels queued semaphore waiters and cooperative requests.
- **Imported provider requests:** direct OkHttp calls use cancellation-aware dispatch and response closure, direct response reads have bounds, and total timeouts apply. Filmo's reloadable cookie list is bounded. See the provider report for compatibility limits.

## Existing ownership traced

- SourcePicker collectors are owned by the fragment lifecycle scope and explicitly cancelled at dialog dismissal. Dismissal also closes Details, removes the layout listener and unregisters the lifecycle observer. Activity stop dismisses the dialog.
- Search cancels both search and pagination jobs on a new query. Work belongs to viewModelScope; result projections use transformLatest for database observations. Failed later pages retain existing results.
- Home TV carousel removes its scheduled handler callbacks on stop and replaces its schedule before starting a new one. Home/search UI collectors run in viewLifecycleOwner scopes and bindings are cleared on view destruction.
- Player lifecycle changes were reviewed separately with the playback agent: view-bound episode work is cancelled with the view, repeated progress-handler starts remove the previous timer, and shared playback ownership releases the prior player. History persistence is intentionally not indiscriminately cancelled with visual callbacks.

## Evidence and remaining limits

Coordinated native validation confirmed ProviderCancellationTest3/3, SearchPaginationTest3/3, BoundedProviderCacheTest4/4 and SourcePickerLayoutTest4/4 passing, with production/test compilation passing. A subsequent imported-provider diagnostic-only redaction requires one final incremental Kotlin compile; no claim of live-provider or device-soak coverage follows from these unit/UI tests.

The follow-up inventory in rc16-provider-cache-hotspots.md distinguishes growing retained maps from finite dictionaries, request-local maps and replaced catalog snapshots. It led to bounded synchronized DOM caches for SeriesTurcas/AnimeOnlineNinja and a bounded Vavoo name-lookup cache. This pass does not establish a measured total-memory ceiling for all adapters, artwork/decoder/native allocations, all catalog sizes or all malformed responses. Existing blocking operations inside older providers may not stop until their own networking timeout, even when a coroutine is cancelled. Retrofit-converted bodies were not all given new size budgets. Remaining cookie jars, full catalog snapshots and hardware memory/soak measurements should be tracked, not represented as universally verified.

No saved library was truncated. Reloadable enrichment-cache eviction can cause a later metadata refetch; it is separate from persisted history/favorites. Live authentication, provider challenges, device playback, search completeness and rapid remote navigation still need runtime checks on target hardware.
