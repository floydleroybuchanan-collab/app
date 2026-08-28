# Media3-only CI and backend audit

Date: 2026-08-27. This documents working-tree changes, not a published or device-tested release.

## Scope and findings

The audit searched CI scripts, all GitHub workflow definitions, build validation,
the FastAPI backend, the Cloudflare builder and Worker, and current build docs.
Frontend/native runtime removal and recovery behavior are covered by the separate
player changes and their regression tests.

- The current sideload workflow previously required VLC classes, both ARM VLC
  libraries, the removed fallback menu, and a one-recovery lifetime limit.
  Those checks could force the old behavior back into the app.
- Twenty-eight historical player repair/validation/build workflows are now
  disabled at every job with a literal false condition. Seventeen old mutation
  or validation scripts now exit before any imports or writes can execute.
  Their original bodies remain as history. The exact inventory is
  `ci/retired-player-automation.json`; the new guard verifies the job conditions
  and the first executable Python statement. Old VLC/watchdog patches must not
  be run to repair a failing current test.
- `ci/verify-media3-only.py` scans runtime source, Android/config plugins, patches,
  dependency manifests and lockfile for the removed runtime. Negative test
  fixtures and historical docs are not treated as shipped engines.
- `ci/verify-android-apk.py` rejects VLC libraries in any packaged ABI, VLC Java
  classes and native bridges in every DEX file, and VLC bridge names in the
  JavaScript/Hermes bundle. It still requires both ARM ABIs, Media3, RTSP and
  FFmpeg audio support, validates ELF architecture, checks the real signature
  and ZIP alignment with Android tools, and records SHA-256.

## Provider metadata must remain

`#EXTVLCOPT` is also an M3U metadata syntax. Removing the VLC engine must not
remove its supported HTTP metadata. The builder continues carrying exact
User-Agent, Referer and Cookie values to the player, preserving the original
stream URL. It ignores player-only options such as `network-caching` and
`clock-jitter`; these cannot reconfigure Media3.

A new builder regression checks all three headers, literal `+` characters,
percent-encoded query values and ignored VLC options together.

## What the servers can and cannot affect

- Android playback opens provider streams directly in the native player. The
  Cloudflare Worker serves prebuilt channel/EPG/config JSON from KV; it does not
  decode, proxy or restart the selected video stream.
- The GitHub refresh job downloads and parses playlist/EPG metadata and uploads
  snapshots. Its schedule and retries are not playback watchdogs.
- The legacy FastAPI `/api/proxy` is a bounded web-preview/source-fetch helper,
  with HTTP(S), destination allowlist, private-address and redirect checks.
  It is not in the shipped native video path. Its 45-second request timeout
  therefore is not the Android player's stream timeout.
- No backend retry, CORS, destination validation, source-refresh schedule or
  secret value was changed for this playback removal.

## Current release path and secrets

Use **Android Native Compile** and **Build CharmIPTV Media3 Sideload APK** on
`fix/tivimate-m3u-epg-ci-align`. The latter produces a
`CharmIPTV-Media3-Sideload-<run>.apk` inside the encrypted owner artifact.
Both gates run the new source/retirement checks and their unit tests.

The sideload builder still uses only `secrets.M3U_URL` and `secrets.EPG_URL`, with
`EXPO_NO_DOTENV=1`. It has no fallback to old provider variables. Missing inputs
fail the build. Provider-bearing artifacts are still encrypted before upload;
the public key and encryption procedure were not changed. Secret values were
not read, printed or modified during this audit.

## Verification and limits

- Release-gate/transport-contract unit tests: 16 passed, using deliberately synthetic ZIP/DEX/ELF
  fixtures to verify accept/reject decisions. These are not APK builds.
- Cloudflare builder and Worker tests: 17 passed, including provider-header
  preservation and existing CORS/error redaction regressions.
- All workflow files parsed with the installed YAML parser without errors.
- The legacy FastAPI integration suite was not executed: it targets a remote
  service and includes refresh mutations. No deployment or provider request was
  needed for these changes.
- A fresh real APK, TV installation and repeated provider-stall playback test
  remain necessary before claiming the device freeze is fixed. Static scans
  cannot prove runtime decoder or network behavior.

Final recovery, cookie-path and full source review: [Final Media3 playback audit](MEDIA3_ONLY_FINAL_AUDIT.md).
