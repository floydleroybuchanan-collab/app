# Charming MediaLab RC9

RC9 updates RC8 (`ef28fbe7ccdc9d254b27b358731d49db546cef28`) with the Charming MediaLab identity and direct Real-Debrid source selection. It retains package `com.charmiptv.app.purple.next.vodtest1.sideload`, the protected signing configuration and persisted account, guide, favorites and device settings. Version code increases from 15 to 16.

## Playback

Selecting a source now resolves it without a second preparation dialog. The source list uses the current visible window, wraps release names, retains D-pad selection when results arrive, and dismisses/cancels observers when the fragment stops. A torrent can still require preparation on Real-Debrid; this is not presented as instantly cached.

Media3 HTTP 404/410 errors on a debrid source receive one fresh resolution per user selection. A missing Real-Debrid cloud record (service error 7, or a bare HTTP 404) can be recreated once. Unavailable/blocked file codes 24, 28 and 35 are not treated as missing cloud records. Account changes still invalidate work and cached cloud IDs; POST requests are not blindly retried. Existing playback position is retained while resolution runs. Provider/extractor implementations are unchanged in RC9; the three reviewed player hashes cover only the bounded recovery addition.

Real-Debrid reference: https://api.real-debrid.com/ (service error codes).

## Branding and compatibility

- Shared transparent circle, wordmark, banner and rail artwork; no painted checkerboard.
- The Android circle launcher has a separately padded adaptive foreground. The actual launcher mask is controlled by Android/the device launcher: https://developer.android.com/develop/ui/compose/system/icon_design_adaptive
- The eight-second startup sequence retains cache, guide database, M3U and EPG milestones. Background imports continue independently.
- The separate VOD entrance uses a bounded bitmap with inexpensive moving glints, ends after 2.6 seconds, supports skip and reduced motion, and releases its animation listeners on detach.
- Login, Live TV and return-from-VOD use the shared artwork. TV Guide retains its guide title.
- Only old managed playlist default names change to Playlist 1–4. User names and catalog identifiers are retained.
- New backup/export filenames use the new brand; readers still recognize old backup prefixes and sort by timestamp across both names.
- Bot display content is normalized on read, including saved D1 messages. Original saved revision history and URLs/Telegram handles are preserved. No D1 schema migration is needed.
- Cloudflare Worker names, account URLs, Telegram bot handle, internal package/class names and persisted keys retain their existing identifiers to preserve compatibility.

## Validation

Frontend tests, type checking, lint, native configuration/guide checks, account/bot tests and repository interaction scans are required. The protected APK workflow additionally compiles Kotlin/Java, runs native unit tests, checks Android API compatibility, builds the FFmpeg extension and verifies signing and APK alignment. Actual streaming outcomes depend on the source, Real-Debrid account and device decoders; compilation is not hardware playback validation.
