# CharmIPTV playback audit handoff

> Current owner direction (2026-08-27): VLC is removed; Media3 performs continuous, paced recovery for transient network errors. See [MEDIA3_ONLY_PLAYBACK_AUDIT.md](MEDIA3_ONLY_PLAYBACK_AUDIT.md) and [MEDIA3_ONLY_CI_BACKEND_AUDIT.md](MEDIA3_ONLY_CI_BACKEND_AUDIT.md). The historical fallback requirements below are superseded.

> Continuation evidence and remaining limitations are recorded in [PLAYBACK_AUDIT_RESULTS.md](PLAYBACK_AUDIT_RESULTS.md). The original checkpoint history below is preserved; it is not a claim of device validation.

## Repository state

- Repository: `https://github.com/floydleroybuchanan-collab/app.git`
- Working branch: `fix/tivimate-m3u-epg-ci-align`
- Baseline before this checkpoint: `cd3c6bb2b60713674d997070b135c4a8902633ff`
- Do not merge or push to `main` unless the owner explicitly changes that instruction.
- This is a work-in-progress checkpoint so the audit can continue on another machine. It is not yet a device-validated release.

## Owner requirements

1. Audit the complete app playback path without guessing.
2. Media3/ExoPlayer is the default, hardware-first Android `MediaCodec` video path.
3. VLC is a fallback and must never own playback at the same time as Media3.
4. Preserve provider URLs and playlist-supplied headers/cookies exactly.
5. Support live IPTV transports and containers from playlist URL through decoder/rendering.
6. Eliminate periodic stall/retry timers that caused freezes near one minute and a retry button after four cycles.
7. Trace every changed playback contract through guide preview, fullscreen, quick actions, settings, native bridges, parsers, diagnostics, tests, and CI.
8. Finish by producing and validating a sideload APK.

## Confirmed causes found in the original branch

- The stored player default was VLC, so the intended Media3-first path was unreachable for a normal install.
- JavaScript and both native managers independently stopped the opposite engine. Multiple stop layers could race, release a newly attached surface, and produce audio-only or a black frame.
- Media3 used a 50-second stall watchdog, three-second polling, a 60-second startup timeout, four automatic recovery attempts, and 0/1/3/6-second backoffs. That exactly matches the reported roughly one-minute freeze/retry cycle and final retry UI.
- The guide separately remounted failed preview playback after 1.5 seconds, while an error boundary reset after 700 ms. Those retries competed with native recovery.
- Opaque IPTV URLs were mutated by appending `.ts`, `.m3u8`, or `.mp4`, and an unused probe opened a second GET. Tokenized provider URLs and one-connection panels can fail under both behaviors.
- VLC hardware acceleration defaulted off, putting HD/4K video on a software path.
- VLC also used a four-attempt suffix ladder, 20-second network cache, disabled clock sync/jitter, and invalid audio-output-device values.
- Media3 buffers were oversized for live playback and could delay start/recovery.
- A four-second "silent audio" timer destroyed and rebuilt valid streams based on a false-positive heuristic.
- Header parsing admitted invalid CR/LF/NUL/name data, which can make OkHttp reject a request before a decoder is reached.
- Native M3U parsing used Java form encoding (`+` for spaces), while the JS decoder only decoded `%20`; provider user agents containing spaces could be changed.
- RTP, UDP, SRT, and RIST schemes were not consistently classified even though VLC can handle those transport families.
- Fit/Fill/Zoom/Stretch settings were not applied consistently; Zoom silently became Fit and VLC ignored non-Fit choices.
- Production audio-decoder diagnostics existed but were not connected to actual native events.

## Changes included in this checkpoint

- Added `frontend/src/core/nativePlaybackCoordinator.ts` as the single serialized owner of `{engine, role}`.
- Engine handoff stops/releases the old engine before starting the new one. Stale guide-preview cleanup cannot stop fullscreen playback.
- Changed player preference to `auto | media3 | vlc`, with `auto` as the migrated default.
- Automatic mode starts Media3 and allows one event-driven fallback to VLC after a final Media3 failure.
- Removed cross-engine stop calls from both native managers and direct parallel engine stops from React code.
- Removed the healthy-playback periodic stall watchdog and silent-audio destruction timer.
- Reduced native recovery to one event-driven attempt and shortened bounded startup/source/type-confirmation timeouts.
- Kept exact provider URLs; removed suffix mutation and deleted `NativeOpaqueStreamProbe.kt`.
- Added Media3 RTSP support and transport classification for RTSP/RTSPS, RTP, UDP, RTMP, SRT, and RIST.
- Hardened pipe-header parsing and repaired `+` decoding for native playlist metadata.
- Media3 is configured hardware-first for video through platform `MediaCodec`, with decoder fallback allowed for device/codec compatibility. FFmpeg is an optional audio extension, not a software-video renderer.
- VLC hardware acceleration now defaults on but is not forced, allowing compatibility fallback.
- Live buffer profiles were reduced and retain the repository's 48 MB maximum allocation rule.
- VLC uses the exact URL, smaller live caches, normal clock behavior, valid stereo/passthrough media options, and real scale modes.
- Guide and error-boundary timed remount loops were removed.
- Wired native track/decoder events into audio diagnostics without storing URL leaves or tokens.
- Updated settings, quick actions, session teardown, native bridges, parsers, tests, and CI invariants for the new contracts.
- Changed `npm test` to run every `tests/*.test.mjs`; the former custom runner skipped historical tests and could hide failures.

## Verification completed before this checkpoint

- Whole-repository player-interaction scanner inspected 217 source files, 1,307 functions, 76 timer sites, 40 listener sites, and 18 network-fetch sites, with zero critical candidates in the working tree at that point.
- The expanded frontend suite passed 246/246 tests before the final audio-diagnostic and `+`-decoding edits.
- `npm run typecheck`, `npm run lint`, native-config verification, native-guide verification, and `git diff --check` passed before those final edits.
- `git diff --check` passed again immediately before this handoff file was added.

## Work that remains mandatory

1. Rerun `npm test`, `npm run typecheck`, `npm run lint`, `npm run verify:native-config`, and `npm run verify:native-guide` after the latest edits.
2. Rerun `python3 ci/tivimate-whole-repo-player-interaction-scan.py` and inspect every candidate rather than trusting only its count.
3. Complete Kotlin/Java compilation. Gradle dependency access requires deriving the active proxy inside the same command because the proxy port can change between shell invocations.
4. The last native compile got through Gradle/Expo/React-Native plugin compilation, installed Android NDK `27.1.12297006`, and configured the app. It was manually stopped for this handoff before the app player Kotlin sources completed.
5. Build the Media3 FFmpeg audio native libraries with `frontend/scripts/build-media3-ffmpeg-audio.sh`; configuration reported them absent, so AC-3/E-AC-3/DTS are not yet available through that extension.
6. Recompile all native sources after FFmpeg packaging. Fix actual compiler errors; do not weaken tests or patch `node_modules` to hide failures.
7. Audit backend, Cloudflare worker, and every GitHub workflow for related call sites. The Android app currently uses direct playlist streams; document which server paths do and do not carry media bytes.
8. Build the sideload variant, verify its signature/package/manifest/native libraries with Android build tools, compute SHA-256, and ideally install and exercise it on the target Android TV device and real provider playlist.
9. Only after all checks pass, push a final verified commit to this same feature branch. Do not merge it into `main`.

## Local build environment notes

- A machine-local Android SDK was installed at repository-root `.android-sdk/`; it is intentionally not committed.
- Gradle 8.14.3 was placed in the normal wrapper cache.
- Required SDK packages observed: platform/build-tools 36 and NDK 27.1.12297006.
- Never commit `.android-sdk`, Gradle caches, `node_modules`, credentials, provider URLs, playlist tokens, or generated intermediate objects.

## Suggested continuation commands

```bash
git fetch origin
git switch fix/tivimate-m3u-epg-ci-align
git pull --ff-only origin fix/tivimate-m3u-epg-ci-align
cd frontend
npm test
npm run typecheck
npm run lint
npm run verify:native-config
npm run verify:native-guide
cd ..
python3 ci/tivimate-whole-repo-player-interaction-scan.py
```

For Gradle, first install/configure the Android SDK on the laptop, then use the repository's `frontend/android/gradlew`. Do not blindly reuse the transient workspace proxy command; use the laptop's normal network configuration.

## Clean-room constraint

The public TiviMate analysis repository was inspected only to understand behavior. It has decompiled material and no usable repository license was found. Do not copy its source, resources, identifiers, or proprietary implementation. Continue using documented Media3, Android, and LibVLC APIs to implement equivalent playback behavior cleanly.
