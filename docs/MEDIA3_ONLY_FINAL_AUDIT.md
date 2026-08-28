# Final Media3 playback audit

Date: 2026-08-27. Feature branch: fix/tivimate-m3u-epg-ci-align.
Repair-entry commit: 049c8fd8e26007cbb0f8fdc70ffb083906ff4c01.

This is the second source/test audit after VLC removal and recovery fixes.
It does not substitute for reproducing the reported freeze on the user's TV.

## TiviMate reference recheck before this audit

A fresh clone and a second fetch of [TiVIMate Analysis](https://github.com/Eliminater74/TiVIMate_Analysis/tree/eab124bb2cf19d0512fa729c30e3328177db434c)
both resolved to eab124bb2cf19d0512fa729c30e3328177db434c: 53 Markdown files,
not the underlying application source or APK. Buffer, network, freeze, controls,
subtitle and memory reports were revisited.

The reports do not establish every buffer-menu mapping or decoder clock value.
No 5-second buffering watchdog, provider HEAD clock request, second media probe,
or guessed A/V tolerance was adopted. Current Charm buffer headroom is retained.

The actual pinned [Media3 1.8.0 load policy](https://github.com/androidx/media/blob/1.8.0/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/upstream/DefaultLoadErrorHandlingPolicy.java)
uses minimum retry counts of 3 normally and 6 for progressive live loading, with
linear delays from 0 to a 5,000 ms cap. These are loader decisions, not a lifetime
three-strike limit on a channel. Charm's new final-error recovery sits outside
that loader and can continue after recoverable network errors.

The pinned [RTSP factory](https://github.com/androidx/media/blob/1.8.0/libraries/exoplayer_rtsp/src/main/java/androidx/media3/exoplayer/rtsp/RtspMediaSource.java)
defaults to an 8,000 ms RTP inactivity timeout. This is not the timeout of
Charm's OkHttp media client. There is no TLS RTSP socket factory in this build:
RTSPS now reports unsupported protocol rather than being treated as RTSP or
downgraded to plaintext.

## Findings repaired

1. **Tune-wide failure limit:** the old one-recovery counter was never reset by
   successful playback. Later errors could release Media3 and invoke VLC.
   Transient network/live-window/live-end recovery now has no lifetime cutoff.
2. **Late callbacks:** retired-source events could affect the next tune on the
   reused player. Listener bindings and delayed work now carry a source revision.
   A queued frame after a player error cannot cancel the required reconnect.
3. **Pause intent:** delayed recovery and surface binding could resume a paused
   stream. Pause cancels scheduled recovery/startup work; resume owns restarting.
4. **Preview identity:** rejecting late preview no longer overwrites the native
   fullscreen bridge identity. Rejection is emitted for the rejected request.
5. **Expired URL refresh:** the player allowed 15 seconds for a path that could
   wait on EPG work, a 45-second playlist request and database writes. Playback
   refresh now coalesces catalog downloads, returns the requested channel only,
   and performs no Guide emission or cache write. Native reply deadline: 60 seconds.
6. **Actual cookie path:** fetchNativePlaylist currently uses JS fetch/parser,
   not the retained native streaming parser. The private native cookie jar did
   not automatically receive JS playlist cookies. A network-response interceptor
   now mirrors cookies from JS responses and redirects into Media3's jar before
   playback, without replacing React Native's CookieJarContainer.
7. **VLC remnants:** native implementation, JS bridge, fallback/manual selection,
   settings and Gradle dependency removed. Old preferences and source confirmations
   migrate to Media3. Unsupported channels cannot repeatedly mount preview decoders.
8. **Automation:** 37 obsolete player/build workflows are disabled at every job and
   17 old scripts stop before executable patch code. APK gates reject VLC
   libraries, DEX classes and JS bridges.
9. **Malformed live segments:** after live playback has been established, a
   malformed container or manifest is eligible for paced source recovery.
   A damaged segment cannot rotate the known source to another container
   factory. Unproven sources, finite media and unsupported formats still
   report persistent parsing failures instead of looping indefinitely.
10. **Learned-metadata feedback:** subscribing to detected-container changes
    could change React prepare-effect inputs after a successful frame. Routing
    now snapshots learned metadata for the selected source identity. Saving a
    confirmation cannot restart an active tune; later explicit tunes can use it.
11. **Alternate publishers:** nine older APK workflows with plaintext upload
    paths are retired. RAM/Guide validation keeps its tests/native compile
    but no longer accepts provider credentials or publishes an APK. Active
    validation inputs no longer fall back to old provider variables, and
    release guards reject unreviewed artifact uploaders or plaintext paths.

The source-refresh repair initially tripped the exact-transport gate. It now
recognizes only the exact reviewed helper replacement. Tests ensure changed
URLs, injected timers and unrelated transport modifications remain visible.
There is no broad exemption for EPG acquisition, parsing, ownership or secrets.

## Final recovery behavior

| Event/control | Behavior |
| --- | --- |
| Ordinary BUFFERING | Status only; no failure count, player switch, source rebuild or stall timer. |
| Network/read errors; HTTP 408/429/5xx | Reopen source on the same ExoPlayer. App delays 1/2/3/4/5 seconds, capped at 5 seconds, with no lifetime cutoff. |
| Malformed container/manifest after established live playback | Reprepare the known source using the same paced recovery. Do not change container factories. Unsupported-format errors remain terminal. |
| Behind live window / unexpected live EOF | Reprepare live source; known finite-media EOF does not auto-loop. |
| Healthy reset | 10 seconds uninterrupted playback, evaluated on the next event; no polling task. |
| HTTP 401/403 | One source refresh per outage, then explicit failure if authorization remains invalid. |
| Decoder/startup fault | One player rebuild per outage; persistent unsupported/decoder/security errors remain visible. |
| Startup | 30-second first-output deadline; first opaque candidate 12 seconds. Established BUFFERING is not killed by this timer. |
| Container confirmation | One 5-second READY check after output; records type, never stops playback. |
| HTTP media | 20-second connect/read inactivity; total-call deadline explicitly disabled (0). |
| Source refresh | 45-second JS request; 60-second native reply deadline. No EPG/database wait or Guide refresh. |
| Stop/new tune/release | Invalidates source revision and cancels pending work. User sleep/Stop remain intentional stop controls. |

A source reprepare can still cause Media3 to flush or initialize codecs when
required. Retaining ExoPlayer is not a promise that every hardware decoder
survives every source fault. No player can display new frames a provider has
not delivered.

## Entire application-path review

| Stage | Result |
| --- | --- |
| Playlist/identity | Configured M3U, size/record limits, stable IDs, exact URLs/query tokens/pipe headers reviewed; no media probe or provider URL rewrite. |
| Metadata/EPG | Cache, native SQLite, matching, scheduler and progress timers remain separate. Playback recovery no longer waits for or emits their updates. |
| Cookies/headers | Provider User-Agent/Referer/Cookie/Authorization preserved. Tests cover redirect capture, literal plus signs, explicit Cookie precedence, Secure/path/domain restrictions. |
| Source routing | HLS, DASH, progressive/TS, opaque candidates and RTSP remain inside Media3. No alternate player is packaged. |
| Demux/parsers/remux | Media3 extractors handle supported containers. No app remux/transcode stage exists here; FFmpeg is the audio decoder extension. |
| Buffers/memory | Small/Medium/Large unchanged; 48 MiB normal/16 MiB low-RAM allocator targets retained. Low-RAM max buffered duration: 15 seconds. Not whole-process caps. |
| Decoders/codecs | MediaCodec video, FFmpeg audio where supported, native decoder fallback and existing async-queue compatibility choice retained. Decoder fallback is not a player switch. |
| Clocks/timestamps | Stream timestamps, audio sync, vsync and live-speed control stay with pinned Media3/Android. EPG wall clocks do not control video timestamps. |
| Surfaces/layers | One active PlayerView, TextureView and transparent shutter. New target binds before old detaches. Fullscreen surface stays mounted through loading/focus blips. |
| Ownership/events | Serialized prepare/stop/control queue; owner/channel/generation/revision guards; late preview cannot steal fullscreen identity. |
| Settings/buttons | Play/Pause/Stop/Retry, channel changes, aspect ratio, audio/subtitles, preview mute/hide, buffers, sleep, diagnostics and Back reviewed. |
| UI/failure history | Loading does not add failed channels; playing clears failure history. No error overlay on ordinary loading and no Guide buffering watchdog. |
| Teardown | Failed release blocks replacement allocation. Departed-session callbacks cannot resume old playback. |
| Web | StreamPlayer is a placeholder; no browser playback or codec capability is claimed. |
| CI/backend | Servers serve metadata, not native stream bytes. On this feature branch, only the approved owner builder publishes artifacts, uses M3U_URL and EPG_URL secrets with dotenv disabled, and encrypts before upload. Other branches/main were not changed. |

The [numeric inventory](MEDIA3_ONLY_PLAYBACK_AUDIT.md) records explicit buffer,
HTTP, FFmpeg, memory and UI values. Android driver internals and every upstream
constant are not claimed to be measured TiviMate settings.

The [pinned Media3 timing reference](MEDIA3_1_8_TIMING_REFERENCE.md) additionally
traces library load control, live-speed correction, late-frame thresholds,
vsync, AudioTrack clocks/buffers, manifest reloads, TS parsing and timestamp
wraparound to AndroidX Media 1.8.0 commit
b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9. Those inherited values were inspected,
not copied from unverified TiviMate reports or replaced with guessed values.

## Verification

- Frontend: **288 tests passed**, no failures or skipped tests.
- TypeScript, Expo lint, native configuration and native Guide checks: **passed**.
- Android debug Kotlin compilation/JVM tests: **passed**; **10** recovery-policy
  tests and **5** real local HTTP/cookie tests.
- Release-gate/transport-contract tests: **21 passed** after final publisher
  hardening (**16** at Build 128). Synthetic APK fixtures
  test gate decisions; they are not installable-build evidence.
- Cloudflare builder/Worker: **17 tests passed**.
- Second whole-repository scan: **221 files**, **1,265 function declarations**,
  **72 timer sites**, **36 listener sites**, **18 fetch sites**, **zero candidate
  critical findings**. Counts are a source census, not all possible executions.
- The scanner also prints two reference-only heuristic flags for origin/main;
  these are not current-branch critical findings or proof of two reproduced
  failures on main. Main was not edited, merged or pushed.
- Recovery tests include 100 successive network decisions without cutoff.
  These are policy tests, not 100 induced outages on a TV.

Not performed: connected-TV installation, actual provider-stall injection,
hardware decoder/layer observation, or the legacy remote FastAPI integration
suite (which issues refresh mutations). The exact visible freeze still needs
the device matrix in the numeric audit.

## Remaining security and infrastructure findings

A fresh production-dependency audit reports **9 high-severity entries** in
the existing Expo/Metro dependency graph and no critical entries. This change
does not upgrade that graph; a compatible framework/dependency upgrade and
its own regression run remain necessary. The app is not declared security-clean.

GitHub secret names and update metadata were checked: sideload builds consume
only M3U_URL and EPG_URL with dotenv disabled. GitHub does not expose the stored
values, so metadata and workflow wiring cannot prove that their contents are
the owner's intended current URLs. No secret was printed, replaced or uploaded.

GitHub reports deprecation notices for pinned Node 20-era actions (forced to
Node 24 by the runner) and setup-java v4. These were warnings on the successful
Builds 126 and 128, not playback failures; action-version maintenance remains separate.

## APK verification

**Build 128 passed**: [sideload workflow run 33135657276](https://github.com/floydleroybuchanan-collab/app/actions/runs/33135657276).
Its exact application source is e0c7e04aabde97d03b52d7e2dbd1961162cc64c9.
Later documentation and CI-hardening commits do not modify this verified APK
or its application source.

| Artifact property | Verified result |
| --- | --- |
| File | CharmIPTV-Media3-Sideload-128.apk |
| Size | 59,741,159 bytes (59.7 MB; 57.0 MiB) |
| SHA-256 | fe10e648d008042f926af50d4706e887b15e1d40a3e78681d70ac44e78352431 |
| Package | com.charmiptv.app.purple.next.sideload |
| Android version | 2.1.0-rc.5-sideload; versionCode 8 |
| Android API levels | Minimum 26 (Android 8.0); target 36 |
| Engines | Media3/RTSP and FFmpeg audio present; VLC libraries, classes and JS bridges absent |
| Native libraries | 23 for ARM32 and 23 for ARM64 |
| Signature and ZIP alignment | Passed local Android-tool verification; 16 KiB ZIP alignment |
| ARM64 ELF load segments | All 23 libraries independently passed 16 KiB alignment/congruence checks |
| Signing continuity | Same certificate as Build 125 |

Certificate SHA-256: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c.
The APK is non-debuggable but uses the existing Android debug/test certificate;
this is an owner sideload test candidate, not a production-store signing claim.
The package version has not been bumped per workflow run; identify this binary
by Build 128's filename, source and checksum.

The encrypted artifact is **CharmIPTV-Media3-Sideload-Encrypted-128**, GitHub
artifact ID 9672232932. It was downloaded and authenticated with the owner's
existing local key, without printing or uploading that key. Local inspection
matches the embedded CI report, checksum file and build metadata. Plaintext
provider-bearing APKs were not uploaded to a public release.

Also passed for this source: [native push check](https://github.com/floydleroybuchanan-collab/app/actions/runs/33135657323),
[native PR check](https://github.com/floydleroybuchanan-collab/app/actions/runs/33135659238),
[frontend CI](https://github.com/floydleroybuchanan-collab/app/actions/runs/33135659210),
and [Guide/RAM validation](https://github.com/floydleroybuchanan-collab/app/actions/runs/33135659248).
Six obsolete repair jobs were intentionally skipped. Build 127 was superseded
and automatically canceled when the final metadata-feedback fix was pushed.

Owner files include the APK, SHA256SUMS.txt, BUILD_INFO.txt,
APK_VERIFICATION.json, LOCAL_APK_VERIFICATION.json and DELIVERY_VERIFICATION.json.
The [release notes](MEDIA3_ONLY_RELEASE_NOTES_BUILD_128.md) and
[25-item tester guide](MEDIA3_ONLY_TESTERS_GUIDE_BUILD_128.md) are ready to copy.
No connected-TV installation or actual provider-stall reproduction is claimed.
