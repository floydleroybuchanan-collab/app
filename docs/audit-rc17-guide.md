# RC17 build 224 guide audit

Baseline: `ed22cb45`. Scope: guide route, guide UI and native canvas, drawer ownership, preview playback, and the native guide read path.

## Files and interactions reviewed

| Area | Source reviewed | Contract |
| --- | --- | --- |
| Route and navigation | `frontend/app/(tabs)/guide.tsx`, `FocusedTabMount.tsx`, `guideSearchJump.ts`, `use-tv-back-to-guide.ts` | The focused TV guide owns its navigation subtree. Route entry restores a channel and time. Leaving relinquishes preview and releases off-screen runway data. |
| Drawers and modals | `PurpleTvShell.tsx`, `PurpleGuideGroupDrawer.tsx`, `GuideEpgAssignDrawer.tsx`, `TvQuickActionsOverlay.tsx`, `tvFocus.ts`, `tvRemote.ts`, `MainActivity.kt` | Main and source drawers claim remote ownership separately. Native entry retries are bounded. Quick Actions and PIN keep the inactive grid out of focus traversal. |
| Preview | `GuidePreviewRail.tsx`, `guidePreviewLayout.ts`, `guideUiPreferences.ts`, relevant `StreamPlayer.tsx` and `playbackSession.ts` transitions | Programme information follows logical focus. One native preview owner follows the settled channel. An invisible control strip cannot steal grid focus. |
| Native canvas and runway | `NativeGuideCanvas.tsx`, `NativeGuidePackage.kt`, `NativeGuideView.kt`, `CombinedGuideRepository.kt`, `guideSlidingCache.ts`, `guideSelectionStore.ts` | The canvas owns one logical cursor. Native reads use the current visible runway and respect source-qualified guide bindings. Painted rows cap at 128, or 64 in low-RAM mode. |
| Adjacent boundaries, read only | `source.native.ts`, `store.tsx`, `app/player.tsx` | Source imports and fullscreen playback are separate audit areas. This audit checked which guide events trigger those boundaries. |

## Findings and fixes

1. **A native read could lose the next runway request.** `NativeGuideView.loadPrograms` wrote `pendingQuery` on the UI thread while `scheduleQueryDrain` read it and then cleared it separately on the worker. A write between those operations was lost. The worker now takes the request atomically. A request with the same row IDs and window leaves the current result valid while it is pending or being delivered. An explicit reload, detach or memory trim invalidates the generation. A failed read releases its request marker and keeps last-good painted rows. The main handler delivers results without leaving them queued on a detached view, and executor rejection during disposal is handled.
2. **A channel-count change could stop playback while the guide remained focused.** The runway focus effect depended on `channels.length` and could execute its blur cleanup on a live catalog update. The focus callback is stable and reads current inputs through a ref. A real departure retains only one bounded ID runway, centered on focus, for the same playlist and group. A subsequent entry filters it against the current rows before rewarming. Programme arrays still use the existing cache owner.
3. **The initial native query could use a pre-layout height.** The first read can begin when the view is attached but its height is still zero. Native layout now queues a read when the height changes. Width-only drawer motion does not trigger that read.
4. **Window focus loss could strand held-key state.** Native focus loss now clears held navigation and Select state and cancels the pending settle callback. Window focus return emits a settled selection only when the focused native canvas still owns guide navigation.
5. **An empty guide could schedule a retry with every playlist disabled.** The route now verifies that it is focused and an enabled source exists before scheduling its retry. It counts the attempt only when the timer actually fires.
6. **Hidden or disabled preview could leave a pending tune armed.** The scheduler respects both settings. Changing either setting cancels pending preview and surf timers and clears the tuned ID.

## Verification and remaining limits

- 97 focused frontend tests passed for guide navigation, ownership, preview geometry, channel/cache structure and regression guards. These include source contracts for native thread handoff and React focus-effect lifetime. They do not execute Android UI or SQLite concurrency.
- Frontend TypeScript and targeted lint passed.
- No native rebuild or TV execution in this audit. Validate cold entry with a tall viewport, quick channel repeat, focus after overlays, route returns, and preview behavior during a real catalog refresh in the next signed build.

Optional follow-up: add native timing measurements for query latency and dropped frames during remote repeat. A separate change could give the native grid an Android accessibility virtual-node tree for individual cells. Neither was needed to correct the findings above.

## Remaining TV controls and calibrated layout

Additional sources reviewed: `app/(tabs)/index.tsx`, `channels.tsx`, `favorites.tsx`, `reminders.tsx`, `search.tsx`, `PurpleChannelCollection.tsx`, `ProgramModal.tsx`, `TvQuickActionsOverlay.tsx`, `TvCalibrationControls.tsx`, `tvCalibration.tsx`, `useAdaptiveStyles.ts`, `tvLayout.ts`, `iconRailPreferences.ts`, `iconRailPolicy.ts`, `use-tv-route-entry-focus.ts`, `use-tv-back-to-guide.ts` and the visible Settings entry actions.

- **Search could play the wrong channel across playlists.** Its previous map let an XMLTV alias overwrite an exact playlist ID, or stop the scan before finding the exact ID. The resolver prefers an exact ID, then an unambiguous matched XMLTV alias, then an unambiguous raw alias. Results are tagged with the query and cannot remain actionable during a debounce for different text. Catalog changes re-resolve current results without launching duplicate native searches. A suggestion's focus request is tied to its text and canceled when the user edits or leaves. Repeated suggestion presses can rearm focus, and retries resolve the mounted result ref.
- **One-column reminders could throw in React Native.** The screen always supplied `columnWrapperStyle`, which FlatList only accepts with multiple columns. The one-column case now omits it. The six-column TV target also reduces columns as the measured content frame narrows, including when a drawer or calibration insets reduce available space.
- **Long Select could target a Channels row after focus left it.** Channels stored the last focused ID in React state and never cleared it on blur. Both Channels and Favorites now clear the row by identity, so delayed blur from an old row cannot clear a newer row. Channels no longer re-renders the list and reattaches the listener to record every D-pad focus event.
- **Quick Actions could disappear while retaining modal ownership.** If a refresh removed the selected channel, the overlay rendered nothing while the guide was still disabled. It now closes and releases ownership. A Guide action without a selected channel also no longer falls back to a player channel.
- **Calibration could show Applied even if storage rejected the write.** Save commits and reports success only after persistence. Failure preserves the draft and reports that it was not saved. The separate provider player now receives the same four-edge calibration as the Live TV player. Existing shell and adaptive styles remain the owners of ordinary TV and handheld geometry.

Home playback, retry and recent tiles were traced into the shared playback handoff. Favorite folder edits and reminder cancellation retain their existing actions. Program Details and Quick Actions retain watch, replay, favorite and reminder routes. Native guide search returns exact IDs for explicitly bound custom sources and XMLTV IDs for primary results. The results resolver therefore does not guess between duplicate aliases. Icon rail persistence already serializes writes and reports failed storage. No changes to account, parental or backup Settings actions were made in this scope.

54 focused frontend checks passed, including three executable search identity fixtures, plus TypeScript and targeted ESLint. Emulator/TV traversal, calibrated visual dimensions, touch targets and notification behavior remain device checks. The old nested EPG picker branches in Quick Actions are unreachable from the visible guide action, which now opens the persistent Assign EPG drawer. Retiring those branches is a separate cleanup.

### Native compile feasibility

The local Android SDK has API 36, Build Tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1. A Temurin JDK 17 with `javac` is available. The current shell points at a JRE 21 and does not set `ANDROID_HOME`. The repository wrapper requires Gradle 8.14.3. The default wrapper cache contained 8.10.2 and 9.5.0 when checked, so offline compilation was not established. The checked-in non-APK CI tasks from `frontend/android` are `gradlew.bat :ffmpeg-audio:compileDebugJavaWithJavac :app:compileDebugKotlin :app:compileDebugJavaWithJavac :app:testDebugUnitTest --no-daemon --max-workers=1 --stacktrace`. No build was run during this review.
