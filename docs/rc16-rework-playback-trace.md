# Playback trace for the RC16 rework

## Confirmed changes

Live TV and both native VOD players now use `CharmPlaybackCore` in the existing VOD Android library. The dependency remains host app -> VOD library; the VOD library does not import the host app.

The core supplies common player construction, renderer fallback/audio-extension policy, bounded buffer policy, seamless surface frame-rate signaling, identity-checked ownership, and release. Live transport recovery and preview/fullscreen handoff remain in NativePlaybackManager; VOD seeking, source resolution, progress, subtitles, and episode controls remain in their fragments. This is a shared engine policy and ownership layer, not a single control screen or reuse of a released ExoPlayer instance.

A new owner invokes the previous route's cleanup before taking ownership. Failed release blocks takeover. Releasing an obsolete instance cannot clear the current owner. Live's existing decoder-release failure handling remains in place. Multi-view's intentionally separate players are outside this single-main-player lease and retain their existing coordinator.

VOD extra buffering previously bypassed the shared preference buffer cap and requested a 300-second window. It now always applies a 48 MiB normal / 16 MiB low-RAM allocation target, prioritizes that target over duration, and bounds the extra window to 120 seconds / 30 seconds. These are allocator targets, not whole-process RAM ceilings. Live's original profile timings remain unchanged.

Stop is in the native TV and mobile controller alongside Sources and Settings. TV uses matching 48dp-high styling and explicit left/right focus links. It pauses (allowing the existing progress listener to save), then navigates back. Its visibility follows the same controller as other controls. The stop button is not a floating React overlay.

## Supplied reference and choppy playback

The supplied decompiled `p000/C6102.java:m11954` changes the window's preferred display mode or preferred refresh rate, using a same-resolution path for selected device conditions. `p000/AbstractC5869.java:m11327` calls `Surface.setFrameRate` and catches platform exceptions. These are static observations, not runtime proof of the reference's chosen mode on this TV.

Our existing Media3 renderer already implements frame-rate signaling. The new explicit ONLY_IF_SEAMLESS setting documents and shares that policy; it is not evidence of a new frame-pacing optimization. The app does not yet implement the reference's full display-mode selection/restoration policy. Copying that obfuscated device-specific branch without identifying its conditions would risk black-screen mode switches.

Live uses hardware MediaCodec video with decoder fallback. Its existing synchronous-queue workaround is preserved for the reported Amlogic issue. VOD's prior queueing choice is preserved. Both already preferred the FFmpeg audio extension; this does not introduce software video decoding.

No forced highest-bitrate setting was added: adaptive selection can select the highest sustainable supported rendition, while forcing an unsustainable variant can increase stutter. A direct channel URL may expose only one rendition. The existing live health sampler records source FPS, display refresh rate and dropped frames. A trace from an affected channel/device is still required to distinguish cadence judder, decoder drops, network rebuffering and source-side defects.

## Validation scope

Native tests cover bounded live profiles, allocation targets, owner handoff, failed cleanup, stale releases and controller visibility/focus. Native compilation and test results must be recorded after the final combined edits. Hardware playback, actual refresh switches, source quality and long-session smoothness remain unverified until exercised on the affected device.

Single-channel Live TV has no explicit maximum FPS, resolution or bitrate cap, and no application playback-speed override. The health snapshot now also reports actual playback speed and surface type. Both live surfaces currently use TextureView; the supplied reference's default player surface is SurfaceView. TextureView composition is a possible contributor, not a measured cause. The existing Fabric clipping workaround makes changing surface type without preview/fullscreen/overlay device validation unsafe, so this patch preserves it. Multi-view retains its separate existing resolution budget.

## Follow-up lifecycle audit

Live `stopInternal` cancels startup/recovery/source-refresh/opaque-confirmation callbacks, stops the bounded health sampler, clears media items, detaches both surfaces, resets EPG playback pressure and diagnostics. Background suspension calls full release. Soft stop deliberately retains the player for route handoff, while full release clears activity/listener/surface references. A decoder-release exception retains the owner and blocks a second allocation rather than falsely reporting success.

VOD pauses on TV pause/mobile stop, cancels its progress timer, releases MediaSession and player when the view is destroyed, cancels next-episode prefetch, and clears bindings. The audit corrected two risks: progress timer startup now cancels any previous scheduled timer before replacing its handle; episode-navigation and prefetch jobs that access UI now use the view lifecycle, preventing a delayed IO result from accessing a destroyed binding. Watch-history persistence remains separate so leaving playback does not intentionally discard the final save.

Remaining behavior to validate on hardware: backgrounded VOD with its view retained keeps a paused decoder/buffer until view destruction or another main player claims ownership. Changing this safely requires coordinated source/resume/PiP restoration and is not silently changed in this patch. TextureView preview/fullscreen transitions, actual decoder release under vendor failures, and sustained playback memory require device tests; unit tests do not prove these.

Validation on 2026-11-07: latest VOD production/test Kotlin compilation passed. CharmPlaybackCoreTest (2) and PlayerControlRevealTest (4) all passed, including ownership handoff, failed-release blocking, stale release safety, Stop focus/hiding and first-press control reveal. Host compilation and all 37 host unit tests passed. The broader VOD batch initially had 25 passing tests and 4 HomeCache test-application initialization failures. The isolated application harness was corrected without changing production cache behavior; the subsequent cache-only run passed all 5 cache tests. The combined result is 29 unique targeted VOD tests passing (24 non-cache plus 5 cache), and 37 host tests passing. No APK or device smoothness validation was performed.

