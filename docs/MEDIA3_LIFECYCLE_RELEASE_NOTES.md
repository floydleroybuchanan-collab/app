# 📺 CharmIPTV Phoenix — Playback and navigation update

## August 28, 2026 · Test candidate after Build 129

This candidate targets brief recurring freezes and exit/navigation lockups. Automated checks cover the code changes; confirmation on the Onn 4K box, NVIDIA Shield and Fire TV Stick is still required.

- 🎬 **One playback session through background/foreground changes.** Returning to the app resumes the existing fullscreen session instead of preparing the same channel again. Manual Pause remains paused.
- 📝 **Metadata updates without a retune.** Updated stream-type hints no longer restart a channel that is already playing.
- 🎛️ **Independent display and audio controls.** Changing aspect ratio or preview mute no longer sends an unrelated Resume command or shortens a pending recovery delay.
- 🚪 **Safer exits and channel handoffs.** Back, Guide, Settings and fullscreen Quick Actions share an awaited cleanup path. Old queued cleanup cannot stop a newer session, and an explicit exit avoids duplicate decoder release on unmount.
- 🗓️ **Guide work stops when hidden.** Pending native reads, late Guide events and old programme-loading batches are cancelled or ignored after leaving/backgrounding the Guide. Returning restores the selected neighborhood.
- 🧠 **Less contention during memory cleanup.** Large programme copies happen outside the shared cache lock. Hiding the app is no longer mistaken for a running low-memory warning.
- 🍪 **Bounded cookies without periodic resets.** Provider cookies survive channel changes and navigation, with limits on retained entries and data. Secure/domain/path rules and explicit Cookie headers are preserved.
- 🧹 **Maintenance stays off the control queue.** Disk-cache reports, cache pruning and codec enumeration use a bounded worker queue so they do not hold up native playback commands.
- 🎮 **Favorites, drawers and overlays release focus.** Closed drawers no longer keep a focus trap. Stale modal callbacks cannot restore the departed screen's remote-button ownership.
- ⭐ **Quick Actions cleanup and consistent channel matching.** Channel lookup uses the shared stream-matching helper for consistency. Late EPG-search results are ignored after closing or leaving the menu.
- 🛡️ **Decoder-release failures are handled explicitly.** A Media3 release timeout is no longer mistaken for success. A failed decoder is not reused or overlapped by another decoder.

## Retained from the Media3-only update

- 🚫 VLC remains completely removed: no fallback, selector, native libraries or alternate player route.
- 🔁 Brief buffering does not count as a failed stream. Recoverable live/network errors use paced Media3 recovery without a lifetime three-strike limit.
- 🔊 FFmpeg audio support, audio/subtitle controls, exact provider URLs/headers and expired-link recovery remain available.
- 📦 Small/Medium/Large buffers and TV memory safeguards are retained. No unverified TiviMate watchdog values were copied into the app.

🧪 **Priority test:** watch the same troublesome channel for at least 20 minutes, then repeat Player → Favorites → Player and minimize/restore. Report any restart, black screen, lost sound or unresponsive navigation.

⚠️ This is a test candidate, not a claim that every provider/device problem is resolved. Invalid authorization, unsupported formats and persistent decoder faults still produce an error. If diagnostics confirm a decoder-release timeout, force-stop CharmIPTV in Android's app settings and reopen it; Home and reopen alone does not restart the process. Do not clear app data.
