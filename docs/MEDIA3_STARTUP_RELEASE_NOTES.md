# 📺 CharmIPTV Phoenix — Startup and playback update

## August 28, 2026 · Test candidate after Build 130

This update repairs reproduced startup and player-handoff defects while keeping
today's playback, memory and navigation improvements. Playback still needs
confirmation on the Onn 4K box, NVIDIA Shield and Fire TV Stick.

- 🎬 **Preview survives routine memory warnings.** Ordinary Android memory hints no longer cancel a channel that is starting or playing. Native and JavaScript cleanup now follow the same startup-grace decision.
- 🧠 **Critical memory pressure is explained.** If Android needs the preview stopped, the Guide keeps your channel selection and shows a message. A cache timer or EPG refresh cannot silently restart it.
- 🔄 **Late player release can recover.** A release timeout no longer blocks every later attempt after the old Media3 playback thread has ended. Play can request a fresh acknowledgement; unfinished or uncertain release still blocks a second player.
- 🚪 **Playback handoffs require a successful stop.** Fullscreen entry, channel-route replacement and crash Retry check the result before starting. Back can still leave after cleanup settles. The Guide shows a cleanup message instead of an unexplained empty preview.
- 🖼️ **The current video host owns the picture.** A view mounted during release is resolved against its current native host, avoiding an old detached target.
- 🏠 **Background/foreground keeps the session.** Fullscreen resumes its existing channel instead of preparing it again. Manual Pause stays paused until you press Play.
- 📝 **Metadata changes do not retune.** Updated stream-type hints no longer restart the same channel. Aspect ratio and preview mute do not send an unrelated Resume command.
- 🗓️ **Hidden Guide work is stopped or ignored.** Queued work is cancelled and stale results cannot revive a departed Guide. One running bridge read may finish within its existing bounds; returning preserves the selected neighborhood.
- 🧹 **Cache maintenance avoids the control queue.** Disk reports, pruning and codec enumeration use a bounded worker. Large programme copies no longer hold the shared cache lock.
- 🍪 **Provider cookies stay bounded.** Cookie expiry and size limits control retained data without periodic session resets. Valid authentication and explicit Cookie headers remain supported.
- 🎮 **Drawers and overlays release focus.** Closed menus cannot keep remote input trapped. Quick Actions discard stale EPG searches, match the current channel consistently and protect busy actions from duplicate presses.
- ⭐ **Saved choices stay intact.** Favorites, settings and stored guide data are not cleared as a playback-recovery tactic.
- 🌊 **Brief buffering stays within Media3.** No second/third-interruption cutoff or automatic player switch was added. Recoverable network failures retain paced recovery.
- 🔊 **Media3 audio and controls remain available.** FFmpeg audio support, available audio/subtitle tracks, buffer profiles, aspect controls and expired-link recovery are retained. VLC remains removed under the earlier requested change.

🧪 **Test first:** cold-launch the app; try a Guide preview and direct playback
from Favorites; watch the troublesome channel for at least 20 minutes; then
repeat Player → Favorites → Player and Home → reopen.

⚠️ Automated checks do not prove the reported TV problem is gone. No guessed
TiviMate timer or new playback watchdog was added. Persistent decoder faults,
invalid credentials and unsupported sources can still prevent playback. Keep
the owner-supplied APK private and report channel names, never private URLs.
