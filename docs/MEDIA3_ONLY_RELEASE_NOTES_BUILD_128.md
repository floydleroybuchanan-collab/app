# 📺 CharmIPTV Phoenix — Test Build 128

## Media3-only streaming stability update · August 27, 2026

This candidate includes today's retained playback changes. Earlier VLC experiments have been superseded by the complete removal of VLC.

- 🎬 **Media3 / ExoPlayer only.** VLC, its fallback route, manual selector, settings and native libraries have been removed. Existing player preferences migrate automatically.
- 🔁 **Recovery without a lifetime strike limit.** Brief buffering does not count as a failed stream. Recoverable network interruptions and unexpected live-stream endings can continue reconnecting inside Media3 with paced retries.
- 🧩 **Damaged live-segment recovery.** Once a live stream has played, malformed segments can retry the known source without changing container handlers. Unsupported formats still produce an error.
- 🖤 **Black-screen prevention fixes.** Old source callbacks and late preview requests can no longer interfere with a newer channel or fullscreen session. A late frame cannot cancel a necessary reconnect after an error.
- ⏸️ **Pause stays paused.** Delayed recovery and video-surface rebinding respect Pause. Stop and Back cancel pending work.
- 📡 **Better provider compatibility.** Exact stream URLs, signed tokens and playlist headers are preserved. Cookies from playlist responses and redirects now reach the native player.
- 🔑 **Expired-link recovery.** Playback can obtain a fresh channel URL without waiting for a Guide/EPG refresh or rewriting its cache.
- ⚡ **Improved extensionless-stream startup.** Media3 can try the appropriate container handlers without modifying the URL or opening a separate media probe.
- 📝 **Stream learning without a restart.** Saving a detected container type no longer feeds back into the active player and prepares the channel again.
- 📺 **Safer preview/fullscreen transitions.** Playback preparation, controls and teardown share one ordered ownership path. Temporary focus/overlay changes keep the fullscreen video surface mounted.
- 🔊 **Audio and subtitle continuity.** FFmpeg audio support remains alongside hardware MediaCodec video. Track controls and diagnostic snapshots stay tied to the current channel; the old silence-based restart heuristic remains removed.
- 🖼️ **Display and buffer controls retained.** Aspect-ratio settings reach the native surface. Small, Medium and Large buffers remain available with TV memory safeguards; this update does not shrink Large to an unverified TiviMate value.
- 🗓️ **Today's Guide matching improvements retained.** Provider prefixes and common quality/source suffixes are handled more consistently when matching playlist entries to programme data.
- 🛡️ **Clear unsupported-stream errors.** Protocols unavailable in this build report an error without silently switching engines or repeatedly restarting preview.
- 📦 **Build protection.** The build uses only the M3U_URL and EPG_URL source secrets, with no old provider-variable fallback. Owner downloads are encrypted, obsolete repair jobs are disabled, and the APK gate checks for absent VLC and present Media3/FFmpeg components.

🧪 **Please prioritize repeated-stall testing.** Watch the channel that previously froze through at least ten brief interruptions. Report any permanent black screen, silent audio, unexpected restart, or recovery after the second/third interruption.

⚠️ This is a test candidate. Invalid credentials, unsupported formats and persistent decoder/security failures still produce errors. Provider bandwidth and device codecs still affect playback. No claim is made that the reported TV freeze has already been reproduced and eliminated on hardware.

Build source: e0c7e04aabde97d03b52d7e2dbd1961162cc64c9.
