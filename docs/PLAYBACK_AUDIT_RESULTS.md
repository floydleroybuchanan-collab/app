# Playback audit continuation — 2026-08-27

## Scope and source control

Continued the remote checkpoint `ddabea81899fb390daee54a74f5a9577f575f473` on **`fix/tivimate-m3u-epg-ci-align`**. The pre-checkpoint baseline is `cd3c6bb2b60713674d997070b135c4a8902633ff`. The existing Windows checkout had unrelated changes and a different branch, so the audit used a separate worktree. No main commit, merge or push was performed. The read-only main reference inspected was `2a68d296894687e6168efe2e156339c77d706bcf`.

This continues, rather than replaces, [the original handoff](PLAYBACK_AUDIT_HANDOFF.md). Its 38 changed paths were reviewed alongside their callers and the continuation changes. The system is built from documented Media3/Android and LibVLC APIs; no proprietary decompiled implementation was used.

## Root causes and removed conflicts

The checkpoint removed the old VLC default, duplicate cross-engine stop layers, Media3's 50-second periodic stall watchdog/four retries, Guide/error-boundary remount timers, silent-audio teardown timer, URL suffix ladder, duplicate HTTP probe, forced software VLC default, oversized buffers, invalid audio-device options and conflicting scaling mappings. Those removals remain intact.

Further issues identified and corrected in this continuation:

| Cause | Correction and affected code |
| --- | --- |
| The ownership queue covered release but not prepare; stale work could prepare after a newer session. Stop errors were swallowed. | Extracted the testable `serializedPlaybackCoordinator.ts`; prepare and control commands run inside the same queue, guarded before and after awaited release. Failed release retains ownership and prevents a second engine. `nativePlaybackCoordinator.ts` is only the native adapter. |
| An awaited old same-role teardown could stop a new session. | `playbackSession.ts` rechecks its stopped generation after callbacks before releasing native ownership. |
| Background preview track handlers could apply audio/subtitles to fullscreen. | All mute/pause/scale/audio/subtitle commands use the role/engine/generation queue; state, track and diagnostic events reject stale identities in `StreamPlayer.tsx`. |
| A mounted preview listener could reject a valid fullscreen source-refresh request. Refreshed credentials were lost on fallback/rerender. | Only the matching session resolves a refresh. A source ref retains the refreshed URL/headers until the explicit tune key changes; VLC receives that ref. |
| Native bridge identity changed on the RN thread before queued Media3 work ran. Ownership reads raced main-thread writes. | Identity and preparation now run together on the main looper; both ownership reads are main-thread operations. |
| Native managers acknowledged failed releases and could allocate another decoder afterward. | Both managers retain failed decoder references; stop promises reject. Media3 rebuild/profile changes and VLC reconnect/tunes refuse replacement allocation after failed release. An uncertain native owner query also rejects. |
| Fabric surface delay left Media3 pending preparation without an effective timeout/owner and could keep an old source alive. | Pending preparation participates in ownership and cancellation, has a startup deadline, and retires the old source before waiting. Surface rebinding does not restart the Media3 deadline. |
| Opaque candidate changes reset the native recovery count. | Candidate routing retains the one-recovery tune budget. URL bytes are unchanged; no probe or suffix variant was added. |
| Explicit provider Cookie was overwritten by OkHttp's cookie jar; exported cookies could ignore scope. | A request-specific cookie policy preserves explicit Cookie while still saving response cookies; CookieManager selection applies secure/path/expiry scope. Two real MockWebServer/JVM tests cover these cases. |
| Java form encoding and JS decoding disagreed about spaces and literal `+`; duplicate case-insensitive headers and empty values changed requests. | Native metadata writes `%20` for spaces; JS percent-decodes without converting literal `+`. The last case-insensitive key wins, empty values survive, invalid OkHttp characters are rejected, and `__proto__` is handled as an ordinary own property. Both native bridges preserve empty values. |
| Stock LibVLC 3.7.5 silently ignores invented arbitrary `http-header`/`http-cookie` options. | Removed those options. HTTP custom headers or scoped cookies that cannot be represented fail explicitly before a VLC connection is opened. HTTP User-Agent/referrer are supported. This is a compatibility limitation, not a claim of full authenticated VLC support. |
| HTTP User-Agent settings do not configure RTSP's dedicated transport. | Media3 uses an explicit `RtspMediaSource.Factory` with the provider UA. HTTP defaults are no longer inserted into non-HTTP requests. Unsupported non-HTTP custom headers fail rather than being silently discarded by VLC. |
| Native HostResume could undo a fullscreen user pause. | Native lifecycle resume only resumes preview, matching native HostPause; fullscreen pause/resume remains JS-owned. |
| Scaling set before view creation was lost; time-priority buffering could exceed the configured byte target. | Native fullscreen scaling is retained for late surfaces, preview always uses Fit, and Media3 uses size-priority buffering with the existing 16/48 MiB targets. These are allocator targets, not a whole-process RAM limit. |
| Diagnostics could lose the current audio decoder or show a previous channel; a URL leaf could contain a token. | Retain decoder metadata only for the same stream/engine/role/MIME; filter Guide diagnostics to the current fingerprint; redact URL paths as well as query/userinfo. An explicit channel change resets the preview error boundary without a timer. |
| Native compile CI still required the deleted watchdog/four retries; APK CI wrote back to the branch and duplicated push/PR builds. | Updated invariant checks without bypassing failure gates, removed unrelated PR comments/branch writes, added JVM tests, exact-SHA artifact provenance and build-tools APK checks. See [all 158 workflows](PLAYBACK_WORKFLOW_AUDIT.md). |
| FFmpeg presence checks accepted an empty/incomplete directory; the source tag was mutable. | Pin n6.0 commit `ea3d24bbe3c58b171e55fe2151fc7ffaca3ab3d2`; require all three static libraries per ABI, key the cache to source/NDK/decoder/build inputs, refuse overwriting unknown source directories and reject APK packaging without the libraries. Shell files use LF. |

The Android decoder-capability query also now handles nullable `videoCapabilities`, removing the genuine Kotlin nullable-receiver warning in `TvRemoteModule.kt`.

A final recovery-path review also found that failure after constructing a replacement Media3 player passed the already-released old instance to fatal cleanup. Cleanup now releases the current replacement, preventing an unowned decoder after source construction fails.

The repository is **public**, so Actions uploads are not private. The existing workflow embeds provider sources in its APK. The unencrypted candidate build was canceled before upload; the revised workflow encrypts the complete artifact ZIP with AES-256-GCM and wraps the random key with RSA-OAEP-SHA256. Only the public key is committed. The private key remains on the owner's Windows machine outside the repository, with an account-only ACL. Authentication is verified before a decrypted file is published locally. Round-trip and tamper tests cover the helper. Older existing artifacts were not deleted and may still contain provider settings.

Canceled native CI runs also produced a misleading final-gate failure because the gate ran after cancellation and saw skipped prerequisites. The gate now runs whenever the job is not canceled; it still fails for actual failed/skipped required checks on an uncanceled run. The three queried `6000fba` runs (`33125410220`, `33125407941`, `33125407915`) were canceled during setup by newer runs, not rejected by the compiler/tests.

## Caller and ownership trace

- Guide selection/preview epoch -> `GuidePreviewRail` -> one `StreamPlayer` native surface. Guide owns layout/focus; it does not own recovery timers. Current-channel diagnostics and keyed error-boundary resets do not remount healthy playback.
- Fullscreen route -> `playbackSession` preview reservation -> the same StreamPlayer adapter and serialized coordinator. Preview/fullscreen handoff waits for old ownership acknowledgement. A role cleanup cannot stop the other active role.
- Quick Actions -> player commands/preferences -> the same component's queued controls. There is no second quick-actions engine selector or decoder.
- Settings -> engine/buffer/VLC/audio preferences. VLC-only preferences are inert for a healthy Media3 session; mute, pause, subtitle and scale changes do not create a decoder. Construction-only buffer/engine changes intentionally retune.
- Native view managers attach surfaces; neither creates an independent player. Media3 owns one ExoPlayer; VLC owns one MediaPlayer. The JS branch mounts only the selected engine surface. Releasing a failed native decoder is an acknowledged prerequisite to switching engines.
- Auto prefers Media3 for supported transports; one Media3-to-VLC compatibility transition follows definitive native failure. Native error recovery is bounded to one rebuild; the explicit user Retry starts a new tune. Protocol/engine absence and unrepresentable headers can fail immediately without opening an invalid request.
- A startup deadline and bounded opaque demuxer candidates remain; healthy playback has no application polling watchdog or silent-audio destruction heuristic. These source/queue checks are not device proof of simultaneous-decoder absence.

## Backend, playlist and EPG audit

| Path | Android playback impact |
| --- | --- |
| `frontend/src/source.native.ts` -> NativeEpg bridge -> `NativePlaylistParser` / native stores | Android's direct M3U/XMLTV path. `sourceUrl` preserves protocol; parsed channel URLs and pipe metadata flow to StreamPlayer. A Media3 401/403 can refresh only the M3U and resolve the current channel URL. |
| `frontend/src/core/sourceParsing.ts`, `CharmStreamUrls.kt`, `NativePlaylistParser.kt` | Classify transport/container and metadata without appending extensions. Java/JS percent encoding now agrees. Stored URL and identity/type classification are separate. |
| `CharmHttpClients.kt` | Separate metadata/media clients share cookies. The media connection is direct to the provider with bounded I/O waits; Cookie preservation and scope are tested on actual HTTP requests. |
| `frontend/src/source.ts` / `api.ts` | Non-native/web metadata path; may use Worker JSON and the web metadata CORS proxy. Metro selects `source.native.ts` for Android. It is not an Android video proxy. |
| `cloudflare-backend/scripts/build-and-upload.mjs` | Downloads/parses M3U/XMLTV, preserves channel stream URL and percent-encoded EXTVLCOPT headers, and writes compressed metadata to KV. Metadata download retries/UA choices do not probe media or control a decoder. |
| `cloudflare-backend/worker/src/index.js` | KV-backed config, channel, guide, per-channel and health JSON/gzip responses. No provider media request, decoder or stream reconnect loop. All 16 combined Worker/builder tests pass. |
| `backend/server.py` | Legacy FastAPI/Mongo settings/playlist/EPG cache and finite, allowlisted web CORS proxy. It is not selected by the Android source path. Its old M3U parser skips EXTVLCOPT comments, so it should not replace the native/Worker parser for header-authenticated providers. Live Mongo/external integration tests were not run and no backend deployment was made. |
| `.github/workflows/*` | Can alter shipped code/build inputs or refresh/deploy metadata, not control a running decoder. Every workflow is inventoried; historical branch-mutating jobs were not dispatched. |

## Scanner findings: manual disposition

The current candidate reports **0 candidate-critical findings**. The scanner also emits two notes against the read-only main reference, based on old JavaScript string patterns:

1. **Forced engine overridden by startup timeout:** the expected `fallbackUsed/forceVlc/forceMedia3` legacy string is absent. Manual inspection of main's native-adapter state listener shows it reports failure, not an engine override. This specific note is a stale heuristic, not reproduced evidence.
2. **Fatal Media3 error published before release:** the legacy JS `hardStop` string is also absent, but inspection of main's native `finishWithError` confirms it posts release to the main queue and publishes error immediately. The candidate releases synchronously before error publication and the coordinator requires successful release acknowledgement before another engine prepares.

The scanner is a structural check, not exhaustive runtime verification; backend/workflow review and behavioral/JVM tests were performed separately.

## Validation status

- `npm ci`: passed (1,006 installed packages).
- `npm test`: **269/269 passed**, including real dependency-injected coordinator races and generation tests, artifact encryption/tamper/CI-wiring tests and existing wiring/focus/guide regressions.
- `npm run typecheck`, `npm run lint`, `npm run verify:native-config`, `npm run verify:native-guide`: passed.
- `node --test cloudflare-backend/worker/test/index.test.mjs cloudflare-backend/scripts/build-and-upload.test.mjs`: **16/16 passed**.
- Whole-repository scan: 0 candidate-critical findings; both main notes manually reviewed above.
- `git diff --check`: passed. All 158 workflow YAML files parsed successfully.
- Local Java 17 / SDK-build-tools 36 / NDK 27.1.12297006: Kotlin + Java compilation and `:app:testSideloadUnitTest` passed; the two MockWebServer tests passed. Gradle still reports upstream deprecations/annotation-processor warnings; no compiler errors were suppressed.
- Negative packaging check: local `:app:assembleSideload --dry-run` with absent FFmpeg archives failed at configuration with the required missing-library error. This expected failure confirms the packaging guard; it is not counted as a successful APK build.
- Windows Git Bash could not fork, so the pinned FFmpeg build and final APK were built successfully in the repository's Linux CI. No generated dependencies were patched to bypass that local limitation.
- Linux Kotlin/Java/JVM compilation passed in 4m 39s; the actual `:app:assembleSideload` passed in 9m 27s. The pinned FFmpeg source commit appears in the successful build log, and both resulting ARM JNI libraries are present in the APK.
- `ci/verify-android-apk.py` passed on the revised APK in CI and again after authenticated local decryption. Both reports agree on package/version, nondebuggable TV manifest, signing, 16 KiB ZIP alignment, both ARM ABI library sets, required Media3/RTSP/FFmpeg/VLC classes, byte count and checksum.
- An additional local ELF inspection found no ARM64 load segment below 16 KiB alignment. FFmpeg JNI exports and AAC/AC-3/E-AC-3/DTS (`dca`)/TrueHD/MLP/MP3/Opus/Vorbis/FLAC/ALAC codec names are present in both libraries. Presence is packaging evidence, not a device decoding test.

## Verified build and artifact evidence

The APK was built from **`881ce7f48ce67375c23c540a9b500ce6a8c67268`**. The final follow-up commit changes audit documentation only; it does not change the APK's source. All five workflows for this APK source completed successfully:

| Check | Successful run |
| --- | --- |
| Pinned FFmpeg, native compilation/JVM tests, sideload assembly, APK verification and encrypted upload | [33126127406](https://github.com/floydleroybuchanan-collab/app/actions/runs/33126127406) |
| Native Compile — push | [33126127424](https://github.com/floydleroybuchanan-collab/app/actions/runs/33126127424) |
| Native Compile — PR | [33126128962](https://github.com/floydleroybuchanan-collab/app/actions/runs/33126128962) |
| Frontend CI | [33126128958](https://github.com/floydleroybuchanan-collab/app/actions/runs/33126128958) |
| RAM/EPG validation | [33126128960](https://github.com/floydleroybuchanan-collab/app/actions/runs/33126128960) |

| APK property | Verified result |
| --- | --- |
| File | `CharmIPTV-Media3-VLC-Sideload-125.apk` |
| Bytes | `146283455` |
| SHA-256 | `8fe6ba50a21358e3d8c1b8bc4705a5ef0e6a30d22df56f92c9e14d313f101b14` |
| Application ID | `com.charmiptv.app.purple.next.sideload` |
| Version | `2.1.0-rc.5-sideload`, code `8` |
| Android levels | Minimum `26`, target/compile `36` |
| Architectures | `armeabi-v7a`, `arm64-v8a`; 25 native libraries per ABI |
| Manifest | TV launcher, Internet permission, nondebuggable application, embedded JS/Hermes bundle |
| Signature | APK Signature Scheme v2, one RSA-2048 Android Debug signer; same certificate as the checkpoint sideload APK |
| Signer certificate SHA-256 | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| Installation / provider playback | **Not tested on a device** |

GitHub artifact `9668813695`, `CharmIPTV-Media3-VLC-Sideload-Encrypted-125`, contains only ciphertext and its envelope JSON. Its downloaded archive SHA-256 matches GitHub's digest: `5a26141868572bd65587fa51661c45d6f589386c24ca816cd54405c1c12afe7f`. Decryption authenticated successfully. The embedded `BUILD_INFO.txt` matches source `881ce7f` and run `33126127406`; the APK checksum matches both the embedded checksum file and the independent local verification.

The decrypted APK and both verification reports are saved on the owner's machine under `C:\Users\floyd\charm-audit-artifacts\release-881ce7f\verified\`. CI logs are retained separately beside that directory. This is a test candidate pending confirmation of the hidden provider source values and target-device playback, not a production-signed or device-validated release.

## Remaining limitations and device checklist

1. No Android TV device is connected. No provider channel was tuned, APK installed, sustained playback measured, decoder overlap observed, focus transition exercised, or audio passthrough verified on target hardware. Signing/manifest/ABI/zip checks cannot prove device installation or playback.
2. Stock LibVLC 3.7.5 cannot preserve arbitrary HTTP headers/cookies through its public media-option API. Those fallback cases deliberately report `request-headers-unsupported`; Media3 is the HTTP path that retains them. RTSP custom-header support is also limited. RTSPS, DRM, SRT/RIST and device-specific codec capabilities are not claimed as tested simply because a scheme is recognized.
3. Previously cached native playlist pipe metadata may contain old form-encoded spaces. Refresh the playlist once after installing this build; literal provider `+` must not be guessed into spaces. No destructive cache migration was added.
4. `npm audit --omit=dev` reports nine high-severity dependency entries (including transitive Expo/Metro/image-size and nanoid findings). No broad Expo major upgrade or dependency patch was made to force this playback build. Review and update that graph separately; this is not a clean security-audit claim.
5. The tester APK embeds repository-configured provider source settings. Treat it as credential-bearing; do not publish the decrypted APK in a public release. New CI artifacts are encrypted; earlier unencrypted artifacts may expose these settings and were left untouched. Review older downloads and rotate provider credentials if needed. The APK uses the existing sideload application ID/signing configuration, not a production-store release key.
6. On the target TV: refresh playlist, test opaque/TS/HLS channels and AC-3/E-AC-3/DTS audio; run more than two minutes; exercise preview/fullscreen/back and rapid channel switches; test manual pause across overlays, Fit/Fill/Zoom/Stretch, audio/subtitles, Retry after bounded failure, and unsupported-header fallback. Capture logcat/Health diagnostics without provider credentials. Check decoder/process memory during these transitions.

Primary API references consulted: [Media3 formats](https://developer.android.com/media/media3/exoplayer/supported-formats), [Media3 1.8 RTSP factory](https://github.com/androidx/media/blob/1.8.0/libraries/exoplayer_rtsp/src/main/java/androidx/media3/exoplayer/rtsp/RtspMediaSource.java), [VLC 3 HTTP access](https://github.com/videolan/vlc/blob/3.0.x/modules/access/http.c), and [VLC 3 RTSP access](https://github.com/videolan/vlc/blob/3.0.x/modules/access/live555.cpp). The installed LibVLC 3.7.5 AAR's public API/options were also inspected; no decompiled application code was used.

## Source secret verification

The repository Secrets API reports `M3U_URL` and `EPG_URL`, both last updated August 19, 2026. No Actions variables exist. These names match the README and native Android source wiring. Cloudflare credentials were updated August 25 but are used for metadata deployments/refreshes, not direct Android media playback. The audited sideload workflow now reads only the two source secrets, fails if missing and disables dotenv loading; it cannot silently select an old `EXPO_PUBLIC_*_URL` variable or local dotenv source.

GitHub does not return stored secret values through its Secrets UI/API. Their correctness against the owner's intended current playlist/EPG remains **unconfirmed pending the owner's reply**; existence and names alone do not prove the stored feeds are current. The metadata was checked again after the APK completed and the two August 19 timestamps were unchanged. No secrets were changed or printed by this audit. If the owner replaces either value, rebuild the APK because these source settings are embedded at build time.

## Encrypted artifact retrieval

Only `sideload.zip.enc` and its authenticated envelope JSON are uploaded. The public recipient key is `ci/sideload-artifact-public.pem`, fingerprint `dc4d53415cf474571c2a3a403767259246aca514529f75b20ffce77ed951f421`.

The corresponding private key is stored only at `C:\Users\floyd\charm-audit-artifacts\keys\sideload-artifact-private.pem`. Back it up privately; do not commit or upload it. After extracting a CI artifact beside its envelope JSON, decrypt locally with:

```text
node ci/protect-sideload-artifact.mjs decrypt <private-key.pem> <sideload.zip.enc> <sideload-private.zip>
```

Extract the decrypted ZIP to obtain the APK, checksum, build provenance and verification reports. The verified local APK is `C:\Users\floyd\charm-audit-artifacts\release-881ce7f\verified\CharmIPTV-Media3-VLC-Sideload-125.apk`. Keep the decrypted files private.

## Complete changed-path inventory

`A` = added, `M` = modified, `D` = removed. Checkpoint is the supplied baseline-to-ddabea8 diff; continuation is ddabea8 through the current audited source. Unrelated/generated build files are excluded.

| Path | Checkpoint | Continuation |
| --- | --- | --- |
| `.gitattributes` | — | M |
| `.github/workflows/android-native-ci.yml` | — | M |
| `.github/workflows/build-media3-sideload-now.yml` | M | M |
| `.github/workflows/ram-epg-test.yml` | — | M |
| `.gitignore` | — | M |
| `ci/protect-sideload-artifact.mjs` | — | A |
| `ci/sideload-artifact-public.pem` | — | A |
| `ci/verify-android-apk.py` | — | A |
| `docs/GITHUB_ACTIONS.md` | — | M |
| `docs/PLAYBACK_AUDIT_HANDOFF.md` | A | M |
| `docs/PLAYBACK_AUDIT_RESULTS.md` | — | A |
| `docs/PLAYBACK_WORKFLOW_AUDIT.md` | — | A |
| `frontend/android/app/build.gradle` | M | M |
| `frontend/android/app/src/main/java/com/charmiptv/app/CharmHttpClients.kt` | M | M |
| `frontend/android/app/src/main/java/com/charmiptv/app/CharmStreamUrls.kt` | M | — |
| `frontend/android/app/src/main/java/com/charmiptv/app/NativeOpaqueStreamProbe.kt` | D | — |
| `frontend/android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt` | M | M |
| `frontend/android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt` | M | M |
| `frontend/android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt` | M | M |
| `frontend/android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackManager.kt` | M | M |
| `frontend/android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackModule.kt` | — | M |
| `frontend/android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt` | — | M |
| `frontend/android/app/src/test/java/com/charmiptv/app/CharmHttpClientsTest.kt` | — | A |
| `frontend/android/ffmpeg-audio/build.gradle` | — | M |
| `frontend/app/(tabs)/guide.tsx` | M | — |
| `frontend/app/(tabs)/settings.tsx` | M | M |
| `frontend/app/player.tsx` | M | M |
| `frontend/package.json` | M | — |
| `frontend/scripts/build-media3-ffmpeg-audio.sh` | — | M |
| `frontend/src/components/GuidePreviewRail.tsx` | M | M |
| `frontend/src/components/StreamPlayer.tsx` | M | M |
| `frontend/src/components/TvQuickActionsOverlay.tsx` | M | — |
| `frontend/src/core/audioDiagnostics.ts` | M | M |
| `frontend/src/core/nativePlaybackCoordinator.ts` | A | M |
| `frontend/src/core/playbackSession.ts` | M | M |
| `frontend/src/core/serializedPlaybackCoordinator.ts` | — | A |
| `frontend/src/core/sourceParsing.ts` | M | — |
| `frontend/src/core/streamPolicy.ts` | M | M |
| `frontend/src/core/vlcPlaybackPreferences.ts` | M | — |
| `frontend/src/nativePlayback.ts` | M | — |
| `frontend/src/nativeVlcPlayback.ts` | M | — |
| `frontend/src/playerEnginePreference.ts` | M | — |
| `frontend/tests/groupTabsScreenFit.test.mjs` | M | M |
| `frontend/tests/manualVlcEngine.test.mjs` | M | M |
| `frontend/tests/media3Audio.test.mjs` | M | M |
| `frontend/tests/nativePlatformHardening.test.mjs` | M | — |
| `frontend/tests/opaqueStreamDetection.test.mjs` | M | M |
| `frontend/tests/playbackReliabilityRecovery.test.mjs` | M | M |
| `frontend/tests/playbackSession.test.mjs` | M | M |
| `frontend/tests/playerAndFocus.test.mjs` | M | M |
| `frontend/tests/playerFirstFrameStability.test.mjs` | M | — |
| `frontend/tests/playerLiveStability.test.mjs` | M | M |
| `frontend/tests/playerSettingsHotApply.test.mjs` | M | M |
| `frontend/tests/quickActionsEpgOwnership.test.mjs` | M | — |
| `frontend/tests/sideloadArtifact.test.mjs` | — | A |
