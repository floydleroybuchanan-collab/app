# Device verification required before performance claims

Use an update installed over an existing test installation, preserving login and library data. Record the actual APK version, device model, OS, display refresh rate and channel format. Do not record usable provider URLs, tokens or passwords.

## Functional cycle

1. Open Live TV. Confirm recent channels and VOD history appear in separate consecutive rows; open a history poster and return.
2. Open the guide, expand/collapse both drawers, change groups and visit the final channel. Check that no divider extends into nonexistent rows. Hold D-pad Up/Down, release and confirm focus remains responsive.
3. Open fullscreen TV, reveal/dismiss the transparent guide, change channels, return to preview and repeat. Confirm video layering, audio and focus survive each handoff.
4. Open VOD Browse, Movies, Series, Search and My List. Open a title with Trailer available and one without. Verify distinct uniform buttons and return destinations.
5. Open Sources; keep focus on a filter while debrid results arrive. Confirm results appear at the top once without stealing control focus. Change filters, retry and dismiss while requests are running.
6. Start VOD, reveal controls, select Stop and return. Confirm controls (including title and Stop) hide together during playback. Reopen the title and verify progress/history.
7. Visit every VOD settings category, scroll to every row, open a nested setting, then Back. Confirm no clipped window and correct nested navigation.
8. Start a provider catalog load, leave immediately, then return. Change providers/kinds during loading. Confirm no late result replaces the current source and cancelled pagination does not continue.
9. Background/foreground during playback, catalog loading and guide import. Confirm no duplicate sound, second active decoder, orphan progress state or frozen focus. Confirm cancellation preserves the existing saved guide.

## Soak and measurement

Repeat the cycle on a weak Fire TV and a second Android TV. Capture baseline and post-cycle Java/native/graphics memory, codec instances, file descriptors, cache bytes and dropped-frame diagnostics after comparable idle periods. Track trends across multiple rounds rather than comparing a single warm-cache value to cold startup. A cache warming then stabilizing is different from monotonic retained growth.

Use the app's source-FPS/display-Hz/playback-speed/surface diagnostics to distinguish cadence mismatch from dropped decoder frames or rebuffering. Keep TextureView for this rework. Network sources and unsupported codecs can still limit quality independently of navigation or cache cleanup.

These checks have not been represented as completed by the source audit. Emulator screenshots or unit-test layout bounds cannot substitute for hardware remote feel, actual refresh behavior or long-session heap stability.
