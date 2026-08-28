# Final Media3 playback audit

Date: 2026-08-27. Feature branch: fix/tivimate-m3u-epg-ci-align.
Repair-entry commit: 049c8fd8e26007cbb0f8fdc70ffb083906ff4c01.

This is the second source/test audit after VLC removal and recovery fixes.
It does not substitute for reproducing the reported freeze on the user's TV.

## TiviMate reference recheck before this audit

A fresh clone and a second fetch of [TiVIMate Analysis](https://github.com/Eliminater74/TiVIMate_Analysis/tree/eab124bb2cf19d0512fa729c30e3328177db434c)
both resolved to eab124bb2cf19d0512fa729c30e3328177db434c: 53 Markdown reports,
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
8. **Automation:** 28 obsolete player workflows are disabled at every job and
   17 old scripts stop before executable patch code. APK gates reject VLC
   libraries, DEX classes and JS bridges.

The source-refresh repair initially tripped the exact-transport gate. It now
recognizes only the exact reviewed helper replacement. Tests ensure changed
URLs, injected timers and unrelated transport modifications remain visible.
There is no broad exemption for EPG acquisition, parsing, ownership or secrets.

## Final recovery behavior

| Event/control | Behavior |
| --- | --- |
| Ordinary BUFFERING | Status only; no failure count, player switch, source rebuild or stall timer. |
| Network/read errors; HTTP 408/429/5xx | Reopen source on the same ExoPlayer. App delays 1/2/3/4/5 seconds, capped at 5 seconds, with no lifetime cutoff. |
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
| CI/backend | Servers serve metadata, not native stream bytes. Only M3U_URL and EPG_URL secrets feed sideload builds with dotenv disabled. Public artifacts remain encrypted. |

The [numeric inventory](MEDIA3_ONLY_PLAYBACK_AUDIT.md) records explicit buffer,
HTTP, FFmpeg, memory and UI values. Android driver internals and every upstream
constant are not claimed to be measured TiviMate settings.

## Verification

- Frontend: **286 tests passed**, no failures or skipped tests.
- TypeScript, Expo lint, native configuration and native Guide checks: **passed**.
- Android debug Kotlin compilation/JVM tests: **passed**; **9** recovery-policy
  tests and **5** real local HTTP/cookie tests.
- Release-gate/transport-contract tests: **16 passed**. Synthetic APK fixtures
  test gate decisions; they are not installable-build evidence.
- Cloudflare builder/Worker: **17 tests passed**.
- Second whole-repository scan: **221 files**, **1,262 function declarations**,
  **72 timer sites**, **36 listener sites**, **18 fetch sites**, **zero candidate
  critical findings**. Counts are a source census, not all possible executions.
- The two origin/main reference findings remain outside this feature branch.
  Main was not edited, merged or pushed.
- Recovery tests include 100 successive network decisions without cutoff.
  These are policy tests, not 100 induced outages on a TV.

Not performed: connected-TV installation, actual provider-stall injection,
hardware decoder/layer observation, or the legacy remote FastAPI integration
suite (which issues refresh mutations). The exact visible freeze still needs
the device matrix in the numeric audit.

## APK verification

The new encrypted sideload build and real-artifact checks are the next step.
Record the actual run, source commit and checksum here before claiming delivery.
