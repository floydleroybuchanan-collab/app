# RC-6: repair of regressions reported in APK #163

Base: `331fdeb195fbf2711f0a99fc3d176fe25c5f69c2`, branch `feature/multiple-playlists-test-1`.
This follow-up supersedes the refresh/focus conclusions in `rc6-source-focus-audit.md` where noted below. It is a targeted repair, not proof that every device interaction is correct.

## Confirmed causes and changes

- **EPG Settings cannot scroll focus back to All Settings.** The fixed header was outside an inner focus guide that trapped Up. Removed that inner trap from EPG & Playlist, the supplied/custom EPG editors and the channel-group editor; the shell still contains the entire page. Scroll containers are not focus targets and do not detach clipped rows, allowing Android to scroll the requested control back into view.
- **Rail-to-page handoff can select an invisible target.** The installed React Native TV implementation exposes an auto-focus guide as a sentinel when focus is outside it. Its request can also redirect to a remembered, clipped descendant. Native handoff now walks the actual view children, excludes focus-guide/scroll sentinels, checks ancestor visibility and confirms a usable visible page control really acquired focus. A failed transfer restores the original rail control. Route-entry retries resolve the current ref on each attempt, including late-mounted controls.
- **Primary guide refresh fails while Guide/player owns input.** The separate primary XMLTV parser still threw the exact reported `EPG refresh deferred for active TV interaction` error every 512 programmes. The earlier custom-parser repair missed this path. Primary parsing now checks cancellation and yields without treating a screen change as a failed feed. Both import executors use Android background thread priority.
- **Automatic guides can wait ten minutes or restart their warmup.** The first scheduler check previously skipped due work when forced startup refresh was disabled; subsequent checks were ten minutes apart. Navigation recreated the scheduler and its initial delay. There is now one mount-lifetime owner, a 30-second initial warmup, and one-minute eligibility checks using each source's existing due clock. Idle Guide may update; rapid surfing/fullscreen still blocks starting automatic work. Accepted updates finish across navigation. A busy guard covers asynchronous setup as well as downloading.
- **Unnecessary catalog reloads add work.** The scheduler no longer refreshes playlists and then asks another function to repeat that same operation. It reloads a scheduled catalog only when a playlist revision actually changed. Additional EPGs keep their own due intervals instead of being forcibly downloaded for every primary retry.
- **Health and EPG directories wait behind XML downloads.** Custom-guide directory/search/health reads now use a bounded two-thread query pool instead of the serial import queue. Imports remain serial within their existing module. Android's SQLite helper explicitly enables WAL and imports use non-exclusive transactions, allowing read connections during staging. Last-good data, empty-feed rejection and the final transactional swap remain intact. Android documents this read/write configuration in [SQLiteOpenHelper](https://developer.android.com/reference/android/database/sqlite/SQLiteOpenHelper#setWriteAheadLoggingEnabled(boolean)) and [SQLiteDatabase](https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase#enableWriteAheadLogging()).
- **Completed independent sources are not published promptly.** Each completed additional source now rematches its bindings and invalidates guide ownership caches before waiting for the next feed.
- **Misleading errors and stale health state.** A progress timeout is now informational, not a persisted failure. Actual rejected imports still report errors. Refresh completion emits after clearing its in-flight state. EPG Settings polls health while updating, preserves its last observed values during a query failure and aggregates per-playlist coverage. Native-engine availability is no longer inferred from a provider failure. Historical failed attempts remain visible as history; they are not silently deleted.

## Scope preserved

No managed provider URL, Cloudflare Worker, HTTP/HTTPS transport, authentication, invite/account rule, VOD implementation, player decoder or guide paint-cache bound changed. Authenticated direct delivery remains in place; managed URLs are not embedded as build-time fallbacks. This does not conceal URLs from an authorized runtime device or encrypt HTTP provider traffic.

The APK workflow, owner certificate, package identity, universal ARMv7/ARM64 coverage and non-debug settings are unchanged. The agreed #160 profile remains: R8/minification and resource shrinking **off**, encrypted owner build artifacts and HTTPS account access retained. Exact transport fingerprints are updated only for the reviewed source scheduling and primary-parser changes; later unreviewed edits still fail that gate.

## Verification

Regression coverage includes actual scheduler execution with fake clocks, navigation without timer reset, slow asynchronous setup without duplicate work, per-source publication before a later pending feed, and late-mounted route-entry focus refs. Native unit tests cover physical target traversal, rejected false-success handoffs and restoring the rail after exhaustion. Wiring checks cover the installed TV focus behavior, primary and additional parser policy, query separation and SQLite transaction safety. Existing player, source, account and guide checks remain active.

Local checks: frontend tests, TypeScript, lint, native config/guide architecture checks, Python database/contract tests, Media3-only guard, repository interaction scan and byte-for-byte VOD integrity verification. Native Kotlin/Java compilation and Android unit tests require the GitHub Android build environment. Their result must be reported separately from local checks.

There is no attached TV or Android emulator here. Provider download speed and on-device D-pad behavior have not been measured. A successful APK build is not proof of those outcomes.

## Onn acceptance walkthrough

1. Install the replacement as an update, keeping saved settings. Open Settings → EPG. Confirm focus starts on All Settings.
2. Scroll to the bottom, then Up through CharmIPTV 2 EPG, Custom EPG and All Settings. Repeat in both individual EPG editors.
3. At several scroll positions, move Left to the icon rail, then tap Right once. Confirm a visible page control is selected. Repeat after leaving for Guide and returning to EPG Settings.
4. Run one guide refresh, then navigate to Guide and back while it runs. A screen change must not produce the active-TV-interaction failure. Source Health should remain responsive and leave the in-progress state when work completes.
5. Confirm both playlists show guide data, including after a restart. Note any genuine provider error, elapsed update time and affected source if a feed still fails. A missing/stale saved guide can still require a real provider download.
6. Test Live TV/Guide navigation during an import, settings editors, rail timeout/disabled behavior and fullscreen playback. Check retained HTTP and HTTPS sources without clearing all app data.
