# Media3 1.8.0 timing and parser reference

Verified on August 27, 2026 against AndroidX Media tag 1.8.0, commit
b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9. These are **Media3 source constants**,
not measured TiviMate settings or measured behavior of a particular TV.

Charm's explicit overrides, UI timers, memory budgets and FFmpeg audio buffers
are in [the application numeric inventory](MEDIA3_ONLY_PLAYBACK_AUDIT.md).
The [final audit](MEDIA3_ONLY_FINAL_AUDIT.md) explains the repaired recovery path.
This addendum traces relevant inherited library values; it is not an exhaustive
list of every constant in Android, a vendor decoder, or FFmpeg.

## Load control and allocator

Charm overrides the first four thresholds and the total allocator target.
The unmodified upstream defaults are shown for comparison, not as Charm's
active buffer profile. These values come from
[DefaultLoadControl](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/DefaultLoadControl.java).

| Property | Upstream value | Charm use |
| --- | ---: | --- |
| Minimum / maximum media buffer | 50,000 / 50,000 ms | Replaced by Small/Medium/Large profiles. |
| Initial playback / rebuffer threshold | 1,000 / 2,000 ms | Replaced by the selected profile. |
| Back buffer / retain from keyframe | 0 ms / false | Inherited. This does not disable forward buffering. |
| Size threshold preference | false | Explicitly retained. |
| Minimum loading-duration floor | 500,000 microseconds = 500 ms | Internal loading decision, not a failure deadline. |
| Live start threshold adjustment | At most half the target live offset | Applies when the source supplies a target. |
| Default automatic video/audio targets | 2,000 / 200 allocator segments | Replaced by Charm's explicit total target. |
| Text/metadata/camera-motion targets | 2 / 2 / 2 segments | Part of automatic sizing, not separate app limits. |
| Image target | 400 segments | Not the active live-video target. |

Each allocator segment is **65,536 bytes (64 KiB)**. Time sentinels are
-9,223,372,036,854,775,807 for unset and -9,223,372,036,854,775,808 for end of
source; these are markers, not negative playback durations.
[Media3 constants](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/common/src/main/java/androidx/media3/common/C.java).

## Live clock and playback-speed correction

The controller uses these defaults only when an applicable live configuration
supplies a target offset. Stream configuration can override the speed range;
without a target, adjustment returns 1.0.
[DefaultLivePlaybackSpeedControl](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/DefaultLivePlaybackSpeedControl.java).

| Property | Value |
| --- | ---: |
| Fallback speed range | 0.97–1.03 |
| Minimum speed-update interval | 1,000 ms |
| Proportional factor | 0.1 per second of offset error |
| Offset-error region using normal speed | Less than 20 ms |
| Target live-offset increase after rebuffer | 500 ms, bounded by configured maximum |
| Minimum-offset smoothing factor | 0.999 |

These adjustments change pacing/live latency. They do not choose VLC, count
failed channels or authorize an app-level teardown.

## Video decoder and frame scheduling

The renderer may skip late output or catch up to a keyframe while continuing
the same session. Its default tests use **30 ms late**, **500 ms very late**,
and force-render eligibility when late with **more than 100 ms** since the
last rendered frame. Last-buffer and renderer-state exceptions apply.
[MediaCodecVideoRenderer](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/video/MediaCodecVideoRenderer.java).

| Property | Value | Meaning |
| --- | ---: | --- |
| Video joining allowance | 5,000 ms | Renderer readiness allowance while joining. |
| Dropped-frame notification count | 50 frames | Analytics reporting threshold, not a stop counter. |

Both come from
[DefaultRenderersFactory](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/DefaultRenderersFactory.java).
The common codec renderer also has a **1,000 ms** codec-hotswap readiness
allowance; this is not a universal MediaCodec release deadline.
[MediaCodecRenderer](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/mediacodec/MediaCodecRenderer.java).

Output more than **50 ms early** can be deferred for another render iteration;
the decision also depends on startup, surfaces and joining.
[VideoFrameReleaseControl](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/video/VideoFrameReleaseControl.java).

| Display-timing property | Value |
| --- | ---: |
| Vsync sampling interval | 500 ms |
| Maximum non-vsync release-time adjustment | 20,000,000 ns = 20 ms |
| Release offset before selected vsync | 80% of a display period |
| Frame-rate estimate high-confidence duration | 5,000,000,000 ns = 5 seconds |
| Frame-rate change needed to update surface hint | 0.02 fps at high confidence; 1 fps at low confidence |
| Unsynchronized frames before clearing surface-rate hint | 30 |

These are display scheduling and estimation values from
[VideoFrameReleaseHelper](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/video/VideoFrameReleaseHelper.java).
Frame-rate estimation uses **15** matching frame durations with **1,000,000 ns
(1 ms)** maximum matching difference.
[FixedFrameRateEstimator](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/video/FixedFrameRateEstimator.java).

## Audio output, clocks and buffers

AudioTrack buffering is separate from the compressed network/media buffer.
Actual allocation respects platform minimums, format, output mode and speed.
[DefaultAudioTrackBufferSizeProvider](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/audio/DefaultAudioTrackBufferSizeProvider.java).

| Property | Default |
| --- | ---: |
| PCM duration bounds | 250,000–750,000 microseconds = 250–750 ms |
| PCM platform-buffer multiplier | 4 |
| Passthrough duration | 250 ms |
| Offload duration | 50 seconds; relevant only if offload is selected |
| AC-3 / DTS-HD multipliers | 2 / 4 |

Timestamp polling changes cadence according to confidence in the platform clock.
A timestamp-check error is not itself a command to stop the stream.
[AudioTimestampPoller](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/audio/AudioTimestampPoller.java).

| Timestamp property | Value |
| --- | ---: |
| Initial / advancing-check polling | 10,000 microseconds = 10 ms |
| Established / unavailable timestamp polling | 10,000,000 microseconds = 10 seconds |
| Error-state polling | 500 ms |
| Minimum initialization period without timestamps | 500 ms |
| Wait for correctly advancing timestamps | 2 seconds |
| Position-drift acceptance between timestamps | 1,000 microseconds = 1 ms |
| Maximum timestamp offset from system clock | 5 seconds |

Playback-head tracking additionally uses these values.
[AudioTrackPositionTracker](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/audio/AudioTrackPositionTracker.java).

| Position-tracking property | Value |
| --- | ---: |
| Raw playback-head update interval | 5 ms |
| Playhead-offset sample interval / count | 30 ms / 10 samples |
| Latency sample interval / maximum accepted latency | 500 ms / 5 seconds |
| Maximum position drift eligible for smoothing | 1 second |
| Maximum smoothing speed change | 10% |
| Platform forced-reset workaround interval | 200 ms |

The audio sink detects a presentation-timestamp discontinuity beyond **200 ms**.
Failed AudioTrack operations have **200 ms** retry duration and **50 ms**
minimum spacing once pending track releases finish. These address real audio
device operations, not normal network buffering. Volume ramp time is **20 ms**;
initialization can retry with a **1,000,000-byte** smaller buffer.
[DefaultAudioSink](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/audio/DefaultAudioSink.java).

The decoder-based audio renderer keeps at most **10** pending output-stream
offsets. FFmpeg's separate 16 input/16 output buffers are documented in the
application inventory.
[DecoderAudioRenderer](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/audio/DecoderAudioRenderer.java).

## Loader retries and manifest timing

Default minimum retry counts are **3**, or **6 for progressive live loading**.
Eligible load failures use linear delays of **0/1/2/3/4/5 seconds**, capped at
5 seconds. Parser, missing-file, cleartext-policy, unexpected-loader and
out-of-range failures can bypass those retries. Alternate track/location
exclusion defaults are **60 seconds / 5 minutes** where supported; these
refer to media renditions/locations, not alternate player engines.
[DefaultLoadErrorHandlingPolicy](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/upstream/DefaultLoadErrorHandlingPolicy.java).

Charm's final-error recovery is a separate layer: recoverable network/live
errors use 1–5-second paced retries without a lifetime cutoff. Thus the
library's number three does not impose a three-interruption channel limit.

HLS detects an unchanged live playlist after **3.5 × its target duration**.
Nonblocking reloads normally wait one target duration after a changed snapshot,
or half after an unchanged snapshot, accounting for load time. An unchanged
blocking-reload response also gets a half-part/target-duration delay to avoid a
request loop. End-tag and server-control behavior matter; no universal fixed
five-second HLS stall value applies.
[DefaultHlsPlaylistTracker](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer_hls/src/main/java/androidx/media3/exoplayer/hls/playlist/DefaultHlsPlaylistTracker.java).

DASH has a **30-second fallback target live offset**, a **5-second** minimum
default start-position constant, and a **5-second** minimum refresh period
when a manifest explicitly supplies zero. Manifest availability, segment
timing and service-description values can change the result.
[DashMediaSource](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer_dash/src/main/java/androidx/media3/exoplayer/dash/DashMediaSource.java).

RTSP inherits an **8,000 ms RTP inactivity timeout**, as recorded with its
source link in the final audit. Charm's HTTP media connect/read settings are
instead 20 seconds, with no total-call deadline.

## Transport-stream parsing and timestamp conversion

| TS extractor property | Value |
| --- | ---: |
| Transport packet size | 188 bytes |
| Packet-read buffer | 50 packets = 9,400 bytes |
| Sniffing packet count | 5 packets = 940 bytes |
| Default timestamp-search extent | 600 packets = 112,800 bytes |
| PID address space | 8,192 entries |

These are parser/search bounds, not playback-buffer capacities or retry limits.
[TsExtractor](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/extractor/src/main/java/androidx/media3/extractor/ts/TsExtractor.java).

MPEG presentation timestamps use a **90,000 Hz** clock with **33-bit**
wraparound (8,589,934,592 ticks). Media3 converts them to microseconds and
adjusts wrap/discontinuities. This clock is unrelated to EPG wall time.
[TimestampAdjuster](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/common/src/main/java/androidx/media3/common/util/TimestampAdjuster.java).

## What remains device or stream dependent

Actual codec queues, operating rate, supported profiles/levels, video resolution,
bitrate, frame rate, audio sample rate/channels, keyframe spacing, segment/part
duration, decoder workarounds and display refresh behavior depend on the media
and TV. There is no separate app remux/transcode stage in this native path.
Changing numeric thresholds cannot supply missing provider bytes or add a codec
the device lacks.

No additional app teardown timer was added for any library clock above.
Repeated buffering, ordinary frame dropping, metadata confirmations and normal
audio timestamp checking must not be converted into a lifetime failure count.
