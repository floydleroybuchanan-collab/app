# Provider cache inventory and narrow corrections

After this inventory, the three accumulating lookup caches below were corrected with a shared synchronized LRU/expiry helper: SeriesTurcas and AnimeOnlineNinja retain at most24 DOM entries for two minutes, and Vavoo retains at most1024 name lookups for thirty minutes. Expired entries are bulk-swept at most once per second on access/write; each lookup independently checks its own expiry and capacity remains bounded while idle. Eviction drops references without modifying Documents already returned to callers. Vavoo search/list/genre results still come from the complete current network response; evicted name lookups use its existing resolver fallback. No saved data or published result list is trimmed. Four targeted tests cover caller retention, expiry/reload, between-sweep expiry and concurrent bounds; final run status is recorded separately.

Files below are under `frontend/android/vod/app/src/main/java/com/streamflixreborn/streamflix/providers/`. Registered singleton objects and registry-held provider instances normally live for the application process. A reuse TTL does not itself release memory at expiry.

| File / field | Ownership and observed bound | Actionable follow-up |
|---|---|---|
| `SeriesTurcasProvider.kt:57` detailPageCache | Singleton, URL to parsed Document. Two-minute reuse TTL at lines 297-304; expired entries are replaced only when that URL is fetched again. No count/byte cap or general eviction found. | Add bounded DOM cache, sweep expired entries, release on memory pressure/provider retirement. Test many unique detail pages and stale refetch. |
| `AnimeOnlineNinjaProvider.kt:58` documentCache | Singleton, URL to parsed Document. Two-minute TTL. Access removes an expired requested entry (1305-1307), but untouched expired documents remain. `reload()` clears all (69). No size cap. | Add size/byte-aware eviction and expiry sweep; wire explicit memory-pressure cleanup without discarding required challenge cookies. |
| `VavooProvider.kt:46` searchCache | Registry-held language instance, ID to channel-name strings. Inserts from search, listing, genre and resolve (175,186,213,238). No TTL/cap/clear found. | Bound reloadable name lookup and keep resolver fallback for evicted names; test details after eviction. |
| `VavooProvider.kt:42-43` homeCache/cacheTimestamps | Keys limited by configured primaryGroups (one or two per language); values are full group channel lists. Thirty-minute reuse TTL, replacement on refresh, no active expiry release. | Count is naturally small; measure list size and clear on pressure. Do not describe this as unlimited growth by number of requests. |
| `AniWorldProvider.kt:458` seriesCache | Singleton full database catalog. Refresh clears then replaces; explicit invalidateCache (501) is called by AniWorldUpdateTvShowWorker. Chunk size25 controls presentation, not retained catalog size. | Profile full catalog, consider paged Room queries. Do not truncate stored catalog. `providerScope` at75 and preloadJob at74 intentionally outlive screens; define cancellation on provider retirement while retaining required worker behavior. |
| `StreamingCommunityProvider.kt:44` totalCounts | Per registry language instance. Genre ID to integer total, populated on first genre page (501-511). Small values and normally finite genre IDs; no expiry/synchronization/cap. | Primarily stale-pagination/thread-safety risk rather than dominant RAM use. Reset with catalog/provider revision and synchronize access. |
| `euroStreamingProvider.kt:117` knownHosts | New singleton host-name set, grows on registered/redirected hosts; no cap/expiry. Used for cookie clearing, URL rewriting and navigation checks. | Keep small trusted-domain history; review host trust and pruning together, not a generic cache clear that changes navigation behavior. |

## Full-list and cookie owners

The same host-keyed cookie-map pattern occurs in these ten files:

- `CineCityProvider.kt:27`
- `IptvOrgProvider.kt:31`
- `IptvSpainProvider.kt:31`
- `PlutoTvArProvider.kt:25`
- `PlutoTvDeProvider.kt:25`
- `PlutoTvEsProvider.kt:25`
- `PlutoTvFrProvider.kt:25`
- `PlutoTvItProvider.kt:25`
- `PlutoTvMxProvider.kt:25`
- `PlutoTvUsProvider.kt:25`

Each cookie map belongs to its singleton HTTP client. Responses replace the host's list, so repeated responses from one host do not append indefinitely. Unique hosts can accumulate, expired cookies are not filtered, and mutable-map access is not synchronized. A shared bounded, expiry-aware CookieJar would address these together, with per-provider isolation and login/redirect regressions.

These same ten providers each hold one `cachedChannels` list (CineCity line43, IPTV Org/Spain line47, Pluto variants line42), replaced on successful refresh with a thirty-minute reuse TTL. They do not append catalogs on every load, but hold their last entire list after leaving the screen and after TTL expiry until replacement/process death. Measure total lists across visited providers and release reloadable lists on memory pressure. `TvporinternetHDProvider.kt:32` similarly keeps one replaced list, with a two-hour TTL and old-list fallback on failed refresh.

## Not persistent-growing caches

- `FrembedProvider.kt:68` genres is a fixed genre-ID dictionary.
- `Provider.kt` registry and Vavoo LANG_CONFIG are fixed configuration maps.
- AnimeSaturn episode extras, AnimeUnity thumbnail maps, FrenchManga server counts, KinoGer foundSeasons, PelotaLibreTvHd class-to-image map, and CineCity videoHeaders are request-local parsing/output maps. Their peak size follows the response, but they are not accumulated global caches.
- KellerKino/KinoGer cachedService + base URL each hold one current service configuration; Filmo cachedCsrf is one string. Filmo's session cookies now have an explicit 128-entry cap with expiry cleanup.

The table records the original findings; the first three map-growth issues are addressed by the narrow correction above. Other single snapshots, cookie jars and finite maps were not broadly refactored. These are source findings, not measured leak sizes or claims that each provider was exercised.
