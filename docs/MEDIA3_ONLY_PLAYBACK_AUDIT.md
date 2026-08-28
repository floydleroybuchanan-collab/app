# Media3-only playback audit

Date: 2026-08-27

Baseline commit: `049c8fd8e26007cbb0f8fdc70ffb083906ff4c01` on `fix/tivimate-m3u-epg-ci-align`.

Scope: CharmIPTV stream selection, Guide preview, fullscreen ownership, native bridges, HTTP identity, Media3 source routing and buffering, decoders, recovery, pause/background behavior, and related settings/build integration. This is a source audit, not a recording of the reported failure on the user's TV. Implementation and final verification evidence are recorded separately below.

## Finding that matches the reported second interruption

The baseline `NativePlaybackManager` has `MAX_ERROR_RECOVERIES = 1`. Its `recoverOnce` increments a tune-wide counter; successful playback does not reset that counter. A second player error or end-of-stream event reaches `finishWithError`, releases the decoder, and emits a final error. The baseline React adapter then tries VLC when automatic mode permits it.

This is a concrete path consistent with "recovers once, freezes after the next interruption." Without the device's error events it is not proof that both visible pauses reached that path. A simple `STATE_BUFFERING` event by itself does not consume the counter.

There is no repeating healthy-playback watchdog in this baseline manager. Startup has a deadline; a separate one-shot task confirms a detected container. Neither a 5-second buffer watchdog nor a 2-strike frozen-clock detector should be added to fix this problem.

## Evidence boundaries: Charm values are not verified TiviMate values

The values in this report come from the inspected Charm source and vendored open-source Media3 audio extension. They are not measurements of TiviMate. The public [TiVIMate Analysis repository](https://github.com/Eliminater74/TiVIMate_Analysis/tree/eab124bb2cf19d0512fa729c30e3328177db434c) is a collection of reports at the reviewed revision; the underlying decompiled implementation referenced by many reports is not in that checkout.

Its 500/1,000/2,500 ms buffer claims and 5,000 ms timeout/watchdog claims are not sufficient evidence to install those values across Charm. They also do not establish the menu mappings for Small, Medium, and Large. Reducing Large to a 2.5-second maximum would remove headroom useful for the user's periodically slow provider.

Keep three categories separate:

- **Explicit Charm override:** the application supplies the value shown below.
- **Vendored library setting:** the supplied Media3 FFmpeg audio code contains the value, with any runtime override noted.
- **Inherited or dynamic:** Charm does not override the value; it comes from pinned Media3, the Android device, or the actual stream. No guessed TiviMate number is substituted.

Media3 is pinned to **1.8.0**. FFmpeg's audio build is pinned to upstream **n6.0**, commit `ea3d24bbe3c58b171e55fe2151fc7ffaca3ab3d2`. A default found in another version, another HTTP stack, or a third-party article is not an observed setting of either this app or TiviMate.

## Numeric inventory: media buffers

Source: `NativePlaybackManager.ensurePlayer` and the `media3BufferDurationsMs` helper. These are Charm configuration values, not verified TiviMate settings.

| Profile | Minimum | Maximum | Start playback | Resume after rebuffer |
| --- | ---: | ---: | ---: | ---: |
| Small / `low_latency` | 1,000 ms | 5,000 ms | 500 ms | 1,000 ms |
| Medium / `balanced` | 3,000 ms | 15,000 ms | 1,000 ms | 2,000 ms |
| Large / `stable` (default) | 10,000 ms | 30,000 ms | 1,500 ms | 3,000 ms |

| Setting | Explicit value | Meaning / limitation |
| --- | --- | --- |
| Low-RAM maximum buffered duration | `min(profile maximum, 15,000 ms)` | Large is reduced to 15 seconds; its other three thresholds are unchanged. |
| Normal allocator target | 48 × 1,024 × 1,024 = **50,331,648 bytes** | 48 MiB; a LoadControl target, not a hard cap on the whole process or all decoder memory. |
| Low-RAM allocator target | 16 × 1,024 × 1,024 = **16,777,216 bytes** | 16 MiB, separate from guide/logo/decoder memory. |
| Prioritize time over byte threshold | `false` | Time and size thresholds both matter; requested time may not fit at every bitrate. |
| Back buffer | No explicit override in the baseline | Inherits Media3's configuration; do not describe this as zero total buffering. |
| Buffer profile application | At player construction | A deliberate profile change releases/reconstructs the player; it is not a periodic recovery trigger. |

The four duration thresholds are buffered media time, not four wall-clock delays. Maximum capacity does not mean every channel waits for that much media before starting. Buffering cannot compensate indefinitely for average throughput below the stream's bitrate.

## Numeric inventory: HTTP and source routing

Source: `CharmHttpClients`, `NativePlaybackManager`, and `nativeEpg`.

| Setting | Explicit value / behavior | Scope |
| --- | --- | --- |
| Media connect timeout | **20 seconds** | OkHttp media connection establishment. |
| Media read timeout | **20 seconds** | Blocking read inactivity, not a total live-session deadline. |
| Media write timeout | **0 seconds** | Timeout disabled for writes. |
| Media total call timeout | **0 seconds** | Explicitly disabled; no whole-stream deadline. |
| Idle connection pool | **6 idle connections**, **5 minutes** keep-alive | Maximum idle count; not a cap of six stream requests in flight. |
| Connection failure retry | `true` | OkHttp transport behavior, distinct from Media3 load policy and app recovery. |
| Redirects / SSL redirects | Both `true` | Existing panel/provider behavior retained. |
| Shared session cookies | One CookieManager | Playlist/panel responses can establish cookies used by media GETs. Explicit Cookie headers are preserved. |
| Default User-Agent | `TiviMate/5.1.6 (Linux; Android TV)` | Existing compatibility identity; not proof of a TiviMate engine or its timer values. Provider-supplied User-Agent wins. |
| Default Accept | `*/*` | Added only if absent. |
| Native playlist-client connect | **15 seconds** | Retained native parser path, not the active JS M3U fetch or media. |
| Native playlist-client read | **45 seconds** | Retained native parser path; native whole-call limit is 90 seconds. |
| Active JS playlist deadline | **45,000 ms** | AbortController. Despite its name, fetchNativePlaylist currently uses JS fetch/parser, not the native streaming parser. |
| Native match sync wait | **8,000 ms** | Metadata synchronization wait, not video playback timeout. |
| Opaque source cache | **256 entries** | Bounded in-memory/persisted container hints. |
| Opaque attempt order | First learned/hinted candidate, then progressive → HLS → DASH, deduplicated | Only the source factory changes. The exact provider URL is preserved. A first transport hint can add a transport candidate. |
| Opaque confirmation | **5,000 ms** after first output | One-shot cache confirmation if READY; does not stop playback. |

RTSP uses `RtspMediaSource`, not the OkHttp media client. Only User-Agent is supported through the existing custom-header path. The app inherits the pinned Media3 1.8.0 RTSP default of 8,000 ms; see the final audit's upstream source link. Native HTTP defaults from `DefaultHttpDataSource` cannot be substituted for Charm's explicitly configured OkHttp client.

## Numeric inventory: startup and recovery baseline

These rows describe the defective baseline, not the intended final recovery policy.

| Setting | Baseline | Audit finding |
| --- | ---: | --- |
| First-frame startup deadline | **30,000 ms** | Armed before output; removed after first video frame or accepted audio-only readiness. |
| First opaque candidate deadline | **12,000 ms** | Lets another container factory try an extensionless URL. Later candidate deadlines use the normal startup budget. |
| Source refresh deadline | **15,000 ms** | Existing authentication/source-refresh bridge wait. |
| Delayed recovery | **1,000 ms** | Event-driven app recovery delay. |
| Automatic recovery budget | **1 per tune** | Not reset by successful playback; causes the second-failure final-stop path. |
| HTTP authentication codes | **401 / 403** | Request a fresh provider source; cannot be treated as endless generic network retry. |
| Diagnostic HTTP cause walk | Up to **12** causes | Search depth for an HTTP response exception, not retries. |
| Diagnostic cause list | Up to **8** exception types | Diagnostic bound, not playback timing. |

Required repair: ordinary BUFFERING must retain the current player and source. Recoverable network errors, a live-window error, and an unexpectedly ended live feed should retry through the native Media3 path without a lifetime strike limit. Delays should be bounded to avoid tight loops; no UI timer should compete with native recovery. Authentication failures should have a bounded refresh opportunity. Unsupported protocols/formats, persistent decoder startup faults, invalid certificates, and other permanent errors must remain visible rather than causing endless reconnects.

## Decoder, codec, demuxer, and clock audit

| Setting | Value / observed implementation | Classification |
| --- | --- | --- |
| Media3 renderer extension mode | `EXTENSION_RENDERER_MODE_PREFER` | Charm override: bundled FFmpeg audio is preferred where it supports the format. |
| Hardware decoder fallback | `true` | Charm override; selects another MediaCodec decoder when possible, not VLC. |
| MediaCodec asynchronous queueing | Forced disabled | Charm override retained for the known TV hardware path. |
| Wake mode | `WAKE_MODE_NETWORK` | Charm override; not a request/retry timeout. |
| Video surface | TextureView, one active PlayerView | PlayerView handoff binds the replacement before retiring the old target. |
| Normal / muted volume | **1.0 / 0.0** | Fullscreen clears inherited preview mute. Muting does not mean a decoder has been released. |
| Audio focus | Fullscreen requests media/movie audio focus; preview does not | Must not be confused with buffering or failure detection. |
| TS payload flags | `ALLOW_NON_IDR_KEYFRAMES` + `DETECT_ACCESS_UNITS` | Used for direct TS and opaque progressive TS routing. |
| HLS extractor flags | Same TS flags; expose caption formats `true` | No custom segment reload timer configured. |
| FFmpeg input buffer count | **16** | Vendored `FfmpegAudioRenderer`. |
| FFmpeg output buffer count | **16** | Vendored `FfmpegAudioRenderer`. |
| FFmpeg initial input buffer | **960 × 6 = 5,760 bytes** | Used only when the stream format does not provide `maxInputSize`. |
| FFmpeg initial PCM16 output buffer | **65,535 bytes** | Can grow dynamically. |
| FFmpeg initial float32 output buffer | **131,070 bytes** | Can grow dynamically. |
| FFmpeg output precision | **16-bit PCM** or **32-bit float PCM** | Selected from stream/sink support; AC-3 prefers 16-bit. |
| FFmpeg invalid-data result | **-1** | Malformed packet is skipped nonfatally, allowing subsequent packets to decode. |
| FFmpeg other decode-error result | **-2** | Decoder error is returned to Media3. |
| FFmpeg error text buffer | **256 bytes** | Diagnostic formatting only. |
| FFmpeg timestamps | Input `timeUs` copied to output buffer timestamp | Presentation timestamps remain owned by the media pipeline. |
| FFmpeg reset | TrueHD context recreated; other codecs flushed | Existing defensive TrueHD behavior retained, not a periodic stream reset. |
| FFmpeg Android native API | **26** by default | Build setting, not stream timing. |
| Native ABIs | **4:** armeabi-v7a, arm64-v8a, x86, x86_64 | Build targets; final artifact contents require APK verification. |

The FFmpeg build enables audio decoders for AAC, AC-3, E-AC-3, DTS (`dca`), TrueHD, MLP, MP3, Opus, Vorbis, FLAC, ALAC, AMR-NB, AMR-WB, mu-law PCM and A-law PCM. Video remains on MediaCodec; the audio extension is not VLC and removing VLC must not remove it.

These important controls are **not explicitly overridden by Charm** in the audited pipeline:

- Master media clock, audio timestamp polling/smoothing, A/V drift tolerances, live playback speed correction, vsync timing, and late-frame/drop thresholds.
- AudioTrack device buffer sizing, actual sample rate/channel count, passthrough/offload/tunneling decisions, and platform decoder queue capacities.
- MediaCodec input/output dequeue, drain, flush, and release deadlines; codec-specific vendor workarounds.
- Allocator block size, adaptive bitrate bandwidth estimation/hysteresis, HLS/DASH playlist reload/segment/part timing, and load-error policy defaults.
- TS sniff/PAT/PMT/PES limits, timestamp wrap/discontinuity handling, PCR search sizes, MP4 seek tolerances, subtitle parser pool limits, and cue timing.

Those values must be traced in the pinned public Media3 source or observed on the target device before any change. Changing them indiscriminately to numbers attributed to a different application can break synchronization, hardware compatibility, or VOD handling. No claim is made that this source audit enumerates every constant inside Android drivers or upstream codec libraries.

## Related memory and UI numbers

These can affect perceived startup or memory pressure, but they are not media clocks or stall watchdogs.

| Setting | Value | Effect |
| --- | --- | --- |
| Low-RAM detection | Android low-RAM flag OR memory class **<192 MiB** | Memory class is the process heap class, not installed physical RAM. |
| Minimum accepted memory class | **64 MiB** | Input normalization in memory-budget calculation. |
| EPG budget | `min(24 MiB low / 64 MiB normal, memoryClassBytes / 6)` | Metadata only. |
| Logo budget | `min(12 MiB low / 32 MiB normal, memoryClassBytes / 10)` | Image cache only. |
| Coordinator player-cache budget | `min(16 MiB low / 48 MiB normal, memoryClassBytes / 8)` | Separate budget field; Media3 currently uses the explicit allocator targets listed above. |
| Coordinator VOD-cache budget | `min(12 MiB low / 64 MiB normal, memoryClassBytes / 8)` | Budget metadata; not evidence that a VOD disk cache exists. |
| Startup memory-trim grace | **15,000 ms** | Defers noncritical cache trimming; critical pressure can still trim. Does not stop/restart playback. |
| Recent-history qualification | **5,000 ms** playing | Adds channel to history; not a stream failure detector. |
| Fullscreen/Guide wall-clock refresh | **30,000 ms** | EPG/clock labels, not video presentation timestamps. |
| Fullscreen notice timeout | **1,800 ms** | Hides channel-switch notice. |
| Controls auto-hide choices | **8,000 / 15,000 / 30,000 / 60,000 ms**, default **8,000** | Hides controls only. |
| Sleep choices | **0 / 15 / 30 / 60 / 90 minutes**, default **0** | Intentional user-controlled playback shutdown. |
| Sleep expiry poll | **15,000 ms** | This timer intentionally stops playback only when a selected sleep duration expires. |
| Source scheduler initial delay / check | **30,000 ms / 10 minutes** | Checks playlist/EPG refresh, not media liveness. |
| EPG progress stall marker | **45,000 ms** | Shows saved Guide/error when metadata refresh stalls; no player-stop call. |
| Failed-channel registry | **80 entries** | Health/smart-group bookkeeping; no circuit breaker in the inspected code. |
| Guide rapid-focus detection | **240 ms** | Preview scheduling during remote surfing only. |
| Rapid-surf surface retirement | **48 ms** | Retires preview during rapid navigation, not during a stationary stream's BUFFERING event. |
| Recent-group transition window | **1,800 ms** | Chooses preview delay after changing groups. |
| Preview focus preference | **320 ms** | Remote focus UI hint. |

| Power profile | Preview on | Delayed preview | Extra surf settle | Rapid surf hold |
| --- | ---: | ---: | ---: | ---: |
| Normal | 1,200 ms | 1,700 ms | 300 ms | 600 ms |
| Compatibility | 2,000 ms | 2,600 ms | 650 ms | 900 ms |
| Max preview | 850 ms | 1,250 ms | 160 ms | 400 ms |

Guide surf mode adds another 100 ms to its extra settle amount; rapid preview scheduling also requires at least `rapidSurfHoldMs + 80`. These delays are navigation tuning, not settings to copy into a playing fullscreen stream.

## Full pipeline findings and required safeguards

1. **Select and classify.** Preserve the provider URL and pipe headers. Unsupported transport is a permanent capability result for this build, not a reason to spin or change engines. Existing URI/hint classification is shared by Guide and the adapter.
2. **Reserve ownership.** Keep the serialized coordinator for preview/fullscreen commands and release acknowledgements. Removing VLC must not remove protection against late preview releases or overlapping decoders.
3. **Bridge identity.** The baseline module stamps state/track events with its latest identity. A retired player's callback can therefore look current to JS. A preview request rejected because fullscreen owns playback must not overwrite the active fullscreen identity.
4. **Construct source.** Preserve cookies/headers and one connection path. Opaque container classification can rotate source factories without inventing alternate URLs or spawning a parallel decoder.
5. **Load and buffer.** Ordinary buffering should let Media3 refill the existing player. Keep the Large buffer headroom and the low-RAM targets. Do not rebuild on every small position pause.
6. **Decode and render.** Retain the FFmpeg audio extension and hardware video. Reset/release work must not race a replacement surface or a replacement source.
7. **Recover.** The one-recovery lifetime counter is the primary source defect. Network recovery should rebuild the source, with bounded retry delays; full decoder reconstruction should be reserved for decoder/startup faults where appropriate.
8. **Ignore stale work.** Player object checks alone do not cover channel changes that reuse the same ExoPlayer. Bind callbacks to a source/tune revision, and invalidate delayed work during stop, retune, replacement, and final error.
9. **Honor pause/background.** Baseline pause does not cancel delayed recovery/startup work, while source rebuilding and surface rebinding set `playWhenReady=true`. A paused user can therefore be resumed by old recovery. Preserve user pause and defer reconnection until resume.
10. **Differentiate EOF.** The baseline retries every `STATE_ENDED`, including finite files. Recover only an unexpected end of a live source; do not loop a completed VOD or recording.
11. **Refresh authorization carefully.** Keep a bounded token/source refresh for 401/403. Respect a newer tune when a refresh reply arrives. Do not retry invalid credentials or certificate failures forever.
12. **UI recovery ownership.** Fullscreen currently reports final errors and updates the failed-channel group; it has no competing automatic retry timer. Guide status also has no stall watchdog. Keep recovery inside native Media3.
13. **Teardown.** A failed decoder release must not be acknowledged as success. Pending surface waits and retry callbacks must be canceled on exit so returning to Guide does not restart the departed stream.

## Unsupported-protocol UI changes completed in this audit

- Fullscreen displays “Unsupported stream protocol” and explains that a provider can supply an HTTP(S) HLS, DASH, or MPEG-TS URL.
- That error does not offer Retry Now, and the restart callback rejects the same nonretryable error. Back remains available.
- Guide checks the currently selected/updated provider URL before mounting or scheduling a preview. Unsupported protocols show a message inside the preview area without taking remote focus.
- Guide re-evaluates the current source rather than permanently blacklisting a channel ID; a later supported URL can play.

## Verification performed for the UI changes

- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test ./tests/playerOwnershipRecovery.test.mjs`: **6 passed**, including two new unsupported-protocol regression checks.
- ESLint for `app/player.tsx` and `app/(tabs)/guide.tsx`: **passed**.
- `git diff --check` for those UI files and their test: **passed**.
- Typecheck during concurrent VLC removal reported the in-progress settings import of the removed VLC preferences module. Final whole-project typecheck must be run after all changes settle.

These are source and unit checks. No claim of provider playback, APK installation, TV focus rendering, hardware decoder behavior, or repeated live stall reproduction is made by these checks.

## Device and integration test matrix

| Scenario | Expected result | Evidence to capture |
| --- | --- | --- |
| Repeated brief provider stalls, at least 10 cycles | Same source/player during ordinary BUFFERING; resumes each time; no VLC/final-error after the second cycle | State/recovery events, decoder identity, screen/audio recording. |
| Connection reset, timeout, and temporary HTTP 5xx across more than two incidents | Bounded delays, continued native source recovery, responsive Back/retune | Recovery action/attempt/delay and HTTP error code, with provider secrets redacted. |
| Recovery while paused or backgrounded | Does not spontaneously play; resume recovers the intended source | playWhenReady/pause intent and callback timing. |
| Tune another channel while retry or auth refresh is pending | Old reply/callback cannot stop, relabel, or restart the new channel | Tune/source revision and owner/generation IDs. |
| 401/403 with expired token, then valid refresh | One bounded refresh opportunity succeeds | Redacted refresh request/result and playback state. |
| Permanent 401/403, unsupported format/protocol, TLS certificate error | Clear final error; no endless request storm | Terminal error and zero subsequent unintended requests. |
| No first frame / missing surface / decoder initialization fault | Bounded startup/decoder handling; explicit error if unrecoverable | Startup deadline, source candidate, surface state, decoder error. |
| Normal finite VOD/recording EOF vs unexpected live EOF | Finite media stays ended; live source reconnects | Source live flag, duration/timeline, EOF decision. |
| Audio-only, AAC, AC-3/E-AC-3/DTS/TrueHD channels | Appropriate audio renderer, radio does not wait for video, no track resets on each rebuffer | Track/renderer diagnostics and actual audible output. |
| Preview → fullscreen → Guide repeated while source is slow | Exactly one owner/decoder; no old surface or release callback steals playback | Ownership/source IDs and decoder lifecycle. |
| Low-RAM TV with Large buffer and EPG refresh | Bounded configured targets and responsive navigation; no process kill | Heap/device class, allocator diagnostics, logs, target-device behavior. |
| Unsupported Guide channel followed by a supported channel or updated supported URL | Warning does not mount/retry unsupported native media; supported source still starts | Preview mount count, focus behavior, playback state. |

## Implementation and final verification

The finalized recovery policy, second audit, actual JS playlist/cookie path and test results are in [Final Media3 playback audit](MEDIA3_ONLY_FINAL_AUDIT.md). Baseline findings above are retained for traceability, not descriptions of the new recovery policy.
