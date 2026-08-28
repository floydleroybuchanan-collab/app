# Build 129 follow-up: playback, navigation and resource audit

Date: August 28, 2026. Branch: fix/tivimate-m3u-epg-ci-align.

## Report and evidence boundary

The owner identified Build 129 on an Onn 4K box, NVIDIA Shield and Fire TV Stick.
Reported behavior: a brief video pause every one or two minutes, a long
navigation lock after leaving playback, temporary improvement after minimizing,
and eventual persistent unresponsiveness. Adding a favorite worked.

The cadence alone does not identify a timer or buffer fault. No device logcat,
ANR trace, frame-timing trace or measured heap profile was available for this
audit. Automated tests reproduce specific code defects described below; they do
not prove that those defects explain every pause observed on the TVs.

## Reference recheck before the second review

The [TiviMate analysis repository](https://github.com/Eliminater74/TiVIMate_Analysis/tree/eab124bb2cf19d0512fa729c30e3328177db434c)
was checked again: main remains at eab124bb2cf19d0512fa729c30e3328177db434c.
Its tree contains 53 Markdown files and no source/resource subtrees, despite
broader source counts described in its README. Its numeric claims therefore
cannot independently establish all proprietary TiviMate settings.

No guessed five-second buffering watchdog, three-strike rule or reduced buffer
was added. Media3 remains pinned to 1.8.0. The separate
[timing reference](MEDIA3_1_8_TIMING_REFERENCE.md) records inherited Media3
constants; device/vendor decoder internals remain unmeasured.

## Repaired defects

| Area | Evidence and change |
| --- | --- |
| Same-source preparation | An executable harness running StreamPlayer's actual effects showed another prepare after a stream-type hint changed or after background/foreground. Source classification is now pinned per identity; fullscreen background/foreground uses pause/resume. |
| Unrelated Resume commands | Aspect/mute updates shared an effect with pause/resume. They now issue presentation controls separately so they cannot accidentally resume playback or advance a recovery delay. |
| Queued ownership work | Cancellation could occur while awaiting native ownership. Activation/release/pause now recheck the current generation at execution and after asynchronous owner lookup. Explicit player exit avoids duplicate unmount release. |
| Quick Actions exit | Fullscreen Guide/Settings actions previously navigated directly. They now delegate to the player's awaited exit owner. Late route/channel changes cancel obsolete navigation, while a same-route focus round trip does not strand a stopped player. |
| Native Guide reads | Inactive Guide state stopped its clock but did not stop queued/in-flight reads or stale publication. Reads now require enabled/attached/visible state; cancellation, atomic newest-request transfer and result guards preserve bounded paint data. |
| Store programme tiers | Clearing the pending queue did not invalidate tiers already captured by the worker. Generation checks stop further tiers and late Store publication after release. |
| JS programme cache | A completed native response could merge into the cache before Store rejected it; returning to the same window also defeated the old key-only guard. Cache generations now reject late joins/fallbacks/merges and prevent coalescing with a retired request, while keeping selected rows. |
| RAM cache locks | Programme copies and byte calculations held a lock also used by UI-thread memory callbacks and playback diagnostics. Immutable snapshots are now copied outside the lock. |
| EPG binding replacement | A mapping snapshot and its fill generation were captured at different times. They now travel together, so an old binding cannot refill under a newer generation. |
| Android memory levels | UI_HIDDEN=20 previously matched the RUNNING_LOW>=10 branch. Running pressure and background levels are now classified separately; the startup grace uses elapsed realtime. |
| Native maintenance queue | Explicit cache scans/pruning and vendor codec enumeration occupied the shared React Native method queue. They now use one worker with four queued slots and cancellation/rejection handling. |
| Cookie retention | The shared cookie jar lacked application bounds. The new jar bounds entries and estimated data, expires on access, preserves Secure/domain/path semantics and explicit Cookie precedence and rejects oversized replacement without deleting valid authentication. |
| Remote focus | Closed drawers retained focus traps; delayed modal cleanup could restore the departed route. Route/foreground guards, explicit non-Guide entry ownership and cancelled frame callbacks prevent stale focus owners. |
| Async overlay work | Closed/replaced Quick Actions could receive late EPG results. Generations discard those results and busy buttons retain focus while rejecting duplicate activation. Channel fingerprint matching is defensive consistency, not a proven prior favorite bug. |
| Decoder release | Media3 1.8 reports an internal release timeout through onPlayerError and can return normally. A temporary listener now captures it even after the normal source listener is retired. Failed release remains quarantined and cannot be cleared by a later no-op release. |

The [pinned Media3 release implementation](https://github.com/androidx/media/blob/1.8.0/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/ExoPlayerImpl.java)
supports the release finding. The guard preserves the application looper and
existing release deadline. It does not move ExoPlayer to an arbitrary worker or
pretend a timed-out decoder was released. Navigation cleanup and the rejected
stop Promise still complete; controls cannot reuse a quarantined player.
Force-stop/relaunch is required to clear that exceptional state.

The [Android memory callback definitions](https://developer.android.com/reference/android/content/ComponentCallbacks2)
support the distinction between hiding the UI and running memory pressure.
Disk-maintenance actions are explicit user actions, not a demonstrated
one/two-minute playback timer.

## Complete active-path review

| Stage | Result and limits |
| --- | --- |
| Playlist/configuration | Existing bounded M3U acquisition, IDs, exact signed URLs, headers and parser behavior retained. The cache-only source edit is recognized by exact reviewed text in the transport gate; unrelated changes still fail. |
| Cookies and HTTP | Playlist/redirect cookies still reach Media3. Cookie limits replace no network timeout or connection pool. No periodic cookie clear or mandatory retune was introduced. |
| EPG/Guide | Native Canvas work can be cancelled. JS-native bridge calls cannot all be cancelled: one already-running 12/24-ID tier may finish native conversion/RAM fill, within existing bounds; no further tiers or stale JS cache publication follow it. |
| Routing and demux | HLS, DASH, TS/progressive, opaque-source selection and supported RTSP stay within Media3. No app remux/transcode stage exists; FFmpeg is the audio extension. |
| Decode/render | MediaCodec video, FFmpeg audio support, track controls, TextureView ownership and paused intent retained. Release quarantine blocks allocation/rebinding when cleanup is uncertain. |
| Recovery | Established BUFFERING still does not trigger teardown or a player switch. Recoverable final errors use the existing paced same-player source recovery. Persistent authorization/unsupported/decoder errors remain visible. |
| Clocks | Media timestamps and A/V synchronization stay with Media3/Android. Ordinary UI clock renders passed a no-extra-prepare test before and after the fix. No periodic JS watchdog was established as the sole cause of the report. |
| Screens/overlays/settings | Guide/Favorites/collection foreground gates, preview, drawers, Program Details, Quick Actions, busy actions and deferred navigation reviewed. Hidden tab subtrees already unmount; the new changes also cover Activity background and queued callbacks. |
| Storage | Persistent favorites/settings and SQLite guide data are not cleared as a playback recovery strategy. Cache maintenance leaves provider data/settings intact. |
| CI/secrets/artifacts | Only the existing encrypted owner APK publisher remains active. M3U_URL and EPG_URL are the configured source secret names, with dotenv and old variable fallback disabled. Secret plaintext is not exposed or independently readable through GitHub metadata. |

## Retained values and new resource bounds

| Setting | Value / role |
| --- | --- |
| Small buffer: min / max / start / resume | 1,000 / 5,000 / 500 / 1,000 ms |
| Medium buffer | 3,000 / 15,000 / 1,000 / 2,000 ms |
| Large buffer | 10,000 / 30,000 / 1,500 / 3,000 ms |
| Media allocator targets | 48 MiB normal; 16 MiB low RAM; not whole-process limits |
| Low-RAM buffer duration | Maximum 15,000 ms |
| Media HTTP connect / read | 20,000 / 20,000 ms inactivity; total-call timeout disabled |
| Application recovery delay | 1/2/3/4/5 seconds, capped at 5; no lifetime network strike cutoff |
| Initial output / first opaque candidate | 30,000 / 12,000 ms, not established-playback stall timers |
| Playback source-URL refresh | 45,000 ms JS request; 60,000 ms native reply deadline; only on recovery demand |
| Memory startup grace | 15,000 ms, monotonic elapsed realtime, event-driven trim |
| Native Guide paint cache | 128 channels; 64 on the low-RAM profile |
| Native Guide read queue | One active read plus newest pending request |
| Native RAM programme cache | 320 channels normally / 128 on low RAM; coordinated bytes and 18% heap bound |
| Cookie jar | 512 entries; 64 per domain; 256 KiB estimated data; 16 KiB per cookie |
| Maintenance queue | One worker plus four queued requests; idle worker timeout 30 seconds |
| Display clocks | Player/Guide 30 seconds; Favorites/collections one minute when active; UI work only |
| User sleep timer | Off / 15 / 30 / 60 / 90 minutes, expiry check every 15 seconds |

Cookie byte accounting is an estimate of retained cookie data, not total JVM
object overhead. Buffer/cache targets do not bound total process RAM, hardware
decoder memory, GPU allocation or Hermes. Arbitrary deletion of clocks, cache
flushes or buffer shrinking was not used as a substitute for diagnosing the
resource lifecycle.

## Verification and remaining work

Regression coverage executes the actual StreamPlayer effects, Store tier
callbacks and source cache functions with controlled asynchronous dependencies.
Native JVM tests exercise cookie behavior, maintenance queue bounds, trim
classification, EPG-generation races, recovery policy and Media3 release
events. Source wiring checks supplement those tests; they are not Android TV
interaction tests.

Final test counts, CI run, APK checksum, signer and native-library results are
recorded in the delivery's BUILD verification document. The fresh native build
is checked independently after download. The main branch and public PR
description are not changed.

The owner still needs to run the [27-item guide](MEDIA3_LIFECYCLE_TESTERS_GUIDE.md),
especially sustained playback and repeated exits/minimize/resume on all three
devices. Existing Expo/Metro dependency advisories are outside this playback
change; this audit does not claim to resolve them.
