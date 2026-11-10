# Charming MediaLab — change-impact audit (2026-11-10)

**Scope:** Build 378 follow-up, VOD `container=0x0` rendering failure, retained-tab focus/decoder ownership, and the CI/native warning cleanup in draft PR #61.

**Baseline:** PR #60 (VOD cache-first startup). This audit branch is stacked above #60 (which is stacked above #59). **Do not merge this branch independently into main** before reviewing its stacked ancestry.

**Evidence standard:** Passing a static check or compiling an APK **does not demonstrate** that a device-specific navigation or rendering failure is resolved. Never report this incident closed without the on-device matrix at the end.

## Required repeat-until-clean workflow for subsequent fixes

1. **Inventory** every edited function, class, resource ID, event, and state owner, including lifecycle hooks and their callers.
2. **Map both directions:** incoming callers / React props / D-pad events; outgoing native/JS actions / fragments / Media3 decoders / Room, caches, and cleanup.
3. **Enumerate competing owners:** active vs inactive Expo tabs, React and Android focus guides, live-vs-VOD decoders, dialogs, foreground vs background maintenance, Android API 24+.
4. **Patch the smallest affected owner** without renaming signatures unnecessarily or editing source protected by `preserved-source-sha256.json`.
5. **Rescan the map** and run the relevant executable contracts, all frontend tests, TypeScript/lint, native Android compile, RAM/EPG compile, no-retired-player scan, source-integrity check, and signing/update compatibility validation.
6. **Repeat steps 1–5** if a check reports an actionable regression. For checks not reproducible in CI, record the missing runtime evidence and leave the issue open rather than calling it solved.
7. **Only after green CI and representative physical-device tests** approve a new signed, encrypted sideload APK. Build 378 predates these fixes.

### Changed-code impact map

| Updated owner / function | Incoming consumers | Outgoing dependencies / state affected | Regression contract |
|---|---|---|---|
| `app/(tabs)/vod.tsx`: `VideoOnDemandScreen` | Expo Router `(tabs)/_layout.tsx`, `PurpleTvShell`, calibration and native focus | `CharmVodSurface` native prop `screenActive`; first-positive-layout latch; `DeviceEventEmitter` subscriptions; async Live TV stop | Nonzero first mount; temporary hidden `0x0` does not destroy a mounted NavHost; event listeners cleaned; no startup network gate |
| `CharmVodSurfaceManager.Surface`: `onLayout`, `mountIfReady`, `screenActive` | RN Fabric native view manager; active tab prop | `FragmentContainerView` exact-sized Android measure/layout; `MainActivity.supportFragmentManager`; `VodRootFragment`; host key-routing callbacks | Do not mount at `0x0`/inactive; fragment inserted after layout receives real dimensions; host callbacks detached on dispose |
| `VodRootFragment`: `setHostActive`, `notifyWhenDrawn`, `onDestroyView` | `CharmVodSurfaceManager`; nested NavHost and XML layout | `VodFocusCoordinator`, nav graph, `HomeTvFragment` dashboard, `PlayerTvFragment`, owner readiness/error callbacks | Hidden tab does not consume render-timeout budget; player leaves on tab blur; callback ownership survives view recreation; readiness has measured visible destination |
| `MainActivity`: `nativeVodOwnsFocus`, `routeShellBoundary` | Android D-pad and Back events, RN TV shell/rail | `CharmVodSurfaceManager.Surface`, `VodRootFragment.navigateBack`, native focus restoration | Only active/visible VOD can consume remote keys; RIGHT enters VOD; LEFT opens rail at real boundary; Back returns previous VOD content |
| `VodFocusCoordinator`: `setHostActive`, `destinationListener`, `attemptRestore`, `onKey` | `VodRootFragment`, native NavController, global layout/focus events | `VodFocusMemory`, `VodGlassActionBar`, home/movie/series/player focus | Disarm pending focus restoration on tab blur **before** navigating away from player; never steal focus from Live/Guide; preserve bookmarks |
| `vodZeroSizedSurface.test.mjs` and `vodCrossLayerInteraction.test.mjs` | `npm test`, Frontend CI, Android CI | Kotlin/TS source invariants across route/bridge/layout/graph/focus/player/cache | Fail CI when previously documented ownership edges are removed or broken |
| Existing `PlayerTvFragment.onDestroyView` and `NovaPlayback.onStop` (not edited) | NavController navigation to/from player | Media3/FFmpeg AVOS decoders, playback position, player view | Player teardown must precede hidden-tab Live/Guide decoder creation |
| Existing `src/core/playbackSession.ts` (not edited) | `VideoOnDemandScreen.useFocusEffect` | Preview -> fullscreen serial stop; separate React Native Live TV decoder owner | Native VOD view does not await Live decoder release before first paint, but inactive VOD player is popped before the new decoder takes foreground |
| Existing `activity_main_tv.xml` and `nav_main_graph_tv.xml` (not edited) | `VodRootFragment`, generated binding, native action bar | NavHost uses `0dp` constrained fill below VOD action bar; Home start; detail/player branches | Root size greater than zero must yield nonzero NavHost size; no second Activity, process, or duplicate VOD rail |
| Existing `HomeTvFragment`, `HomeViewModel`, `HomeCacheStore`, `VodHomePrewarm` (cache-first work) | NavHost Home, Android app startup | Real provider data, first-screen posters, bounded caches, async refresh | No blocking network gate, no fallback/mock catalog, do not clear Live TV/EPG cache while invalidating VOD |
| Existing `VodPlatformsFragment`, `VodPlatformCatalog` (not edited) | Native top bar, Home dashboard, platform shortcuts | TMDB/provider discovery and platform-specific navigation | Platforms remain focusable with bounded IO; not coupled to Fragment first-measure timing |

### Cross-cutting warnings cleanup (PR #61)

- **Actions:** upgraded SHA-pinned Checkout, Setup Node, Setup Java, Setup Gradle actions to avoid Node 20/old Java action annotations. All three workflows must run successfully.
- **Room KSP:** removed app KAPT compiler and ignored processor arguments. Must validate generated Room classes via native compile.
- **RN/Expo:** modern Guide events and compatibility annotations for legacy React Native TV 0.81 packages; do not remove package or owner registration.
- **Media3:** modern artwork call, Android API 24/25 fallback for multiview audio focus; verify player compile and Android 7 native compatibility.
- **VOD code:** nullable unpacker, Home and navigation type simplification, removed WebSQL, etc. Preserve the byte-exact upstream files covered by the source-integrity manifest.
- **Third-party deprecations:** do not force incompatible dependency overrides merely to achieve zero warning count. Record which warnings remain and whether actionable.

### Automated checks and limits

- `frontend/tests/vodZeroSizedSurface.test.mjs`: first-positive-size latch, exact-size Fragment layout, visible-root readiness and stale callback cleanup.
- `frontend/tests/vodCrossLayerInteraction.test.mjs`: eight cross-file dependency contracts for registration, layout, NavHost, events, focus, tab blur, playback handoff and Back.
- Existing `frontend/tests/vodEmbeddedSafety.test.mjs`, `vodGuideNavigationReturn.test.mjs`, `vodIntegration.test.mjs`: source integrity, playback, focus, provider, and one-MainActivity contracts.
- GitHub `Frontend CI`, `Android Native Compile`, `RAM EPG Experiment Validation`: compile and test gates; **do not interpret green tests as a physical device pass**.
- Full graph coverage cannot be proven from regex/source inspection alone; concurrency, actual Fabric measure behavior, network/provider quality, and TV remote variants require device testing.

### Mandatory device verification before closing VOD startup incident

1. Android TV and Fire TV (including Android 7/8 when available): cold launch and open VOD; no `container=0x0` error and no black-screen hang.
2. Switch VOD -> Live -> VOD 20+ times; return to previous VOD browse/detail position; no duplicate Fragment/Activity, stuck focus, or memory growth.
3. Navigate all VOD top actions; use Left/Right/Up/Down/Back, press/hot keys, and main icon rail boundaries; focus must be visible and return naturally.
4. Start a real VOD title; return with Back and confirm correct prior page. Start a second title; switch to Live and verify previous VOD decoder was released and Live starts without conflict.
5. Test platform shortcuts/search, valid provider catalog, posters and artwork with slow/offline data; no fake catalog and no 0x0 readiness failure during delayed provider responses.
6. Reopen after app background/foreground, display-size change, low-memory trim, and network loss/recovery; verify callbacks and focus ownership.
7. Verify signed update installation identity and owner key, then release **one** encrypted sideload build only from the validated combined commit.

## Current outcome / open evidence

- A source-level first-render and dependency fix is committed to **draft PR #61**. Build 378 was created before this fix.
- Existing frontend tests covered earlier stages; check the latest PR #61 commit's GitHub Actions result for definitive green/red status. The combined source remains unverified on a physical TV.
- Never mark a retained-route/decoder issue as fully resolved solely because the relevant static contract passed. If any device scenario fails, capture logs, add the reproducer to this map, patch its actual owning code, and repeat the upstream/downstream scan.
