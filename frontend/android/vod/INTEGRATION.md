# CharmIPTV VOD test 1

Host baseline: build 133, run 33324653017, commit
`1c9dc344ecae45ca4582a8096e20b729660ca67a` from
`fix/tivimate-m3u-epg-ci-align`. Work belongs only to `vod/charmiptv-test-1`.

## One APK

The drawer adds **Video OnDemand** below **TV Guide**. The `/vod` route first
awaits release of Live TV's playback sessions, then opens a non-exported native
activity in the same APK and task. Back follows the VOD screen's existing
navigation and eventually returns to the host route. There is no second app
installation or launcher icon. The experiment uses
`com.charmiptv.app.purple.next.vodtest1.sideload` to protect the baseline install.

The native page runs in the internal `:vod` process so its image network client,
TLS compatibility setup, player, and caches do not replace Live TV's runtime
configuration. React Native is not started in that process. WorkManager is
initialized on demand with the main process responsible for scheduling. Both
processes initialize the upstream preferences/data prerequisites for workers.

## Retained implementation

`preserved-source-sha256.json` records 190 upstream provider, extractor, player,
model, and database files. `node frontend/scripts/verify-vod-source.mjs` checks
each byte before CI builds. No source resolution, endpoint selection, scraping,
subtitle extraction, server fallback, or player algorithm is replaced.

Integration changes are outside those preserved files: library build metadata,
application lifecycle and worker initialization, the internal Android manifest,
cache/process boundaries, host launch bridge, default provider, and presentation.
Upstream's separate APK updater is suppressed in this embedded build. This is
necessary because installing an upstream APK cannot update the combined host.

The default theme uses CharmIPTV's actual palette. Upstream logo bitmaps are
removed; the existing CharmIPTV logo is reused. Source namespaces, native JNI
symbols, attribution, protocol identifiers, and licenses remain intact for
compatibility. Optional upstream themes and provider settings remain available.

## Service configuration

The public upstream does not contain its private service configuration. Supply
`TMDB_API_KEY`, `SUBDL_API_KEY`, `RABBITSTREAM_SOURCE_API`, `UPROT_MSFI_API_BASE`,
`UPROT_MSE_API_BASE`, and `UPROT_API_KEY` as applicable using ignored
`frontend/android/vod.properties` or CI secrets. Missing values stay empty, not
fabricated. TMDb English is selected automatically, but its online catalog
requires a valid TMDb key. It may also be entered through the retained settings.
Preserving provider code cannot guarantee availability of third-party services.

## Validation and build

From `frontend`: run `npm ci --legacy-peer-deps`, `npm test`, `npm run typecheck`,
`npm run lint`, `npm run verify:native-config`, and `npm run verify:native-guide`.
Android needs SDK 36, NDK 27.1.12297006, CMake 3.22.1, and the original pinned
FFmpeg build. The existing protected `build-media3-sideload-now.yml` workflow on this branch builds both ARM ABIs,
checks the APK, signs it for sideloading, and encrypts the provider-bearing
artifact for the experiment owner. It does not modify main or publish plaintext
provider credentials. Shared Kotlin, Glide, Room, and navigation dependencies
must resolve together; compilation and regression tests are required after
upstream updates.

Device acceptance still needs fresh-launch, D-pad, Home/Movies/Series/Search,
favorites/history, authorized playback, subtitle/server selection, Back to the
host, Live TV resumption, background recovery, and low-memory testing. Compilation
and static preservation checks are not substitutes for those runtime checks.
