# 🧪 CharmIPTV Phoenix — Testers' Guide

## Media3-only Test Build 128 · August 27, 2026

### Before starting

Install the verified Build 128 APK supplied by the owner, not the earlier Media3+VLC Build 125. Start with the normal Large buffer setting and sleep timer Off. Use streams you are authorized to access. Note your TV/box model, Android/Fire OS version, Wi-Fi or Ethernet, and buffer choice.

Android 8.0/API 26 or newer is required. Android Settings may still show version 2.1.0-rc.5-sideload (code 8), as in earlier candidates. Identify this build by the Build 128 filename and supplied checksum. Its package and signing certificate match Build 125; use an update install to preserve existing data.

Tests below cover today's retained changes and important regressions. If a channel type or feature is unavailable, mark it Not tested. Do not change or share provider passwords to run a test.

### Playback and recovery

- 🎬 **Media3-only upgrade — removes player switching.** Test: upgrade an installation that previously used Auto or VLC, open Player settings, then play several channels and restart the app. Pass: Media3 is the only player; no VLC selector or fallback appears, and saved channels/preferences remain.

- 🔁 **Repeated brief jitter — keeps ordinary buffering from becoming a failure.** Test: watch the known problem channel for 30–60 minutes, through at least ten brief pauses if they occur. Count each pause, especially numbers two and three. Pass: picture/audio resume without a permanent black screen, error screen, or player switch.

- 📶 **Short connection interruptions — exercises transient recovery.** Test: on your own TV only, interrupt its network for 2–3 seconds, restore it, and wait for recovery; repeat ten times. Pass: recovery is automatic each time and Back/channel controls remain usable. A buffer may hide some very short interruptions.

- 🌐 **Longer outage — exercises actual reconnects.** Test: disconnect the TV's network for 30–60 seconds, restore it, and allow time for network timeouts/retries. Repeat at least three times. Pass: playback can recover without relaunching the app or exhausting a lifetime retry count. Record actual recovery time.

- ⏸️ **Pause during recovery — preserves user intent.** Test: pause during a stall, restore the network, and wait 30 seconds. Then press Play. Pass: playback does not resume by itself while paused; Play resumes or reconnects the selected channel.

- 🛑 **Stop/Back during recovery — cancels old work.** Test: while a stream is reconnecting, press Stop or return to Guide; then choose another channel. Pass: the old stream does not restart underneath the new screen and two audio streams never overlap.

- 🖤 **Late-event protection — prevents old errors from damaging a new tune.** Test: leave a slow/failing channel for a working one immediately, repeating several times. Pass: an old error, refresh result or frame cannot blank, relabel or restart the new channel.

- 🔑 **Expiring-link recovery — refreshes the chosen URL without rebuilding the Guide.** Test: if your provider rotates tokens, keep watching across a normal expiry; also try while a Guide update is pending. Pass: valid refreshed credentials restore playback without a Guide remount. If expiry cannot be reproduced, mark Not tested.

### Sources, decoding and timing

- 📡 **Headers, cookies and signed URLs — preserve provider access requirements.** Test: play channels that already require provider-specific login/session headers, after a cold app launch and a normal playlist refresh. Pass: valid channels start and remain accessible; no repeated authentication errors or altered URL behavior.

- 🧩 **Container/source routing — chooses Media3's appropriate parser.** Test: use available HLS, MPEG-TS, extensionless HTTP, DASH and RTSP channels. Switch between formats repeatedly. Pass: supported streams show video/audio without a player switch or permanent initial black screen.

- 🧩 **Damaged live segments — retries an established stream without changing parsers.** Test: use the authorized problem channel that occasionally stutters, or an existing test feed with known malformed segments. Keep watching through repeated incidents. Pass: a temporary damaged segment does not cause a permanent stop or a container/player switch. Do not modify a provider service to create faults; mark this Not tested if the condition is unavailable.

- 📝 **Stream-type learning — saves parser information without interrupting video.** Test: start an extensionless channel after a cold launch and watch for several minutes, especially the first 5–15 seconds; retune away and back. Pass: saving its detected type does not create an extra loading cycle, black screen or repeated audio.

- ⏱️ **Finite media versus live EOF — avoids looping finished programmes.** Test: if available, play a short finite file to its actual end and separately test a live source that reconnects after an interruption. Pass: finite media stays ended; live media can recover. Mark finite-media coverage Not tested if none is available.

- 🔊 **Audio codecs — retains the FFmpeg audio extension.** Test: use available AAC, AC-3/E-AC-3, DTS/TrueHD and other audio formats; include a radio/audio-only channel. Listen through rebuffering and channel changes. Pass: supported tracks remain audible without a silence-triggered restart; radio does not require a video frame.

- 🎚️ **Audio selection — keeps commands with the right channel.** Test: select another audio language/track, retune away and back, and repeat preview-to-fullscreen entry. Pass: the supported remembered choice is used and a background preview cannot change fullscreen audio.

- 💬 **Subtitles and A/V timing — preserves media timestamps.** Test: enable subtitles, switch languages if offered, disable them, then observe a dialogue-heavy channel before and after a stall. Pass: controls work, subtitles turn off, and audio/video do not develop persistent drift. Report the approximate offset and whether it grows.

- 🧯 **Permanent failures — distinguishes unsupported/bad input from jitter.** Test: choose an already-known unsupported format/protocol entry, then return to a working channel. Pass: a clear error is shown, no VLC starts, no rapid retry loop occurs, and navigation remains usable. A temporary network outage may keep reconnecting instead. Do not manufacture certificate or credential failures on someone else's service.

### Surfaces, controls, Guide and memory

- 📺 **Preview/fullscreen handoff — preserves one playback owner.** Test: enter fullscreen from Guide and return twenty times, including while a channel starts slowly. Pass: correct video and audio remain attached to the active screen; no overlapping audio or stale frame persists.

- 🪟 **Menus and focus — protect the fullscreen surface.** Test: open/close Quick Actions, channel and audio/subtitle panels; use D-pad navigation and a brief system overlay. Pass: returning focus does not leave black/silent playback. Backgrounding the app may intentionally pause it.

- 🖼️ **Aspect ratio — applies display choices natively.** Test: cycle Fit, Fill, Zoom and Stretch on widescreen and older 4:3 content, then retune. Pass: the selected display behavior applies without losing video; preview keeps its normal Fit behavior.

- 🧠 **Buffer profiles and memory — balance jitter tolerance and TV resources.** Test: compare Small/Medium/Large, then leave Large playing on your lower-memory TV while navigating the Guide. Pass: changing a profile applies once, not periodically; no crash, repeated decoder restart or progressive slowdown occurs. Record differences in startup and recovery.

- 🗓️ **EPG matching — retains today's programme-identity changes.** Test: inspect channels with provider prefixes, HD/UHD/VIP labels or source suffixes and compare the actual programme to the Guide. Pass: matching improves without assigning another channel's programme; unmatched/ambiguous entries do not silently become incorrect matches.

- 🎛️ **Remote controls and preview settings — keep the rest of watching usable.** Test: channel up/down, previous/recent channel, Play/Pause, mute/unmute preview, hide/show preview, Guide/Drawer return and quick actions. Pass: each command affects the intended screen/channel and focus remains visible.

- 🌙 **Sleep timer — remains an intentional stop.** Test: keep it Off during recovery tests; separately set 15 minutes and leave the app playing. Pass: no shutdown while Off; playback stops when the selected timer expires.

- 🩺 **Diagnostics — help identify a remaining failure.** Test: use Quick Actions → Diagnostics after a problem and inspect Settings → Health. Pass: current channel/audio information is available and does not show an unrelated previous decoder. Review reports before sharing; never include provider URLs, tokens, cookies or passwords.

### Copy-and-paste result

- 📦 Build: 128 / source e0c7e04
- 📺 Device and OS:
- 📶 Network: Wi-Fi / Ethernet
- 🧠 Buffer: Small / Medium / Large
- 🧪 Test name:
- ✅ Result: Pass / Fail / Not tested
- 📺 Channel name and format, if known:
- ⏱️ Watched for / interruption count / recovery time:
- 🖤 Black screen? Audio continued? Error text?
- 🎮 Did Back, Stop and changing channel still work?
- 📝 Exact steps, approximate time and sanitized diagnostics:

A short phone recording of the second/third interruption is useful. Do not film account credentials or publish the provider-bearing APK.
