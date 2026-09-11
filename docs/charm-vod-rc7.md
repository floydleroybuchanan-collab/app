# CharmIPTV RC.7 implementation and release checklist

Base: successful sideload workflow run 167, commit
`30e9d8ce3509452a63f08b498d41022637d33b4f`. Work branch:
`codex/vod-debrid-nova`. Preserve the existing sideload application ID and signing key.

## Approved scope

- Visible Sources control; manual source changes during working playback.
- Combined current-provider direct sources and Real-Debrid torrent matches, with
  red torrent titles, magnet icons, format hints and compatibility information.
- Quick Play remains the default; Choose Source First is optional.
- Real-Debrid account settings, encrypted local token storage, cloud availability
  verification, explicit torrent preparation and HTTPS link resolution.
- Optional embedded Nova/AVOS VOD playback alongside Media3; history, resume,
  audio/subtitle controls and bounded direct-source fallback.
- Xtream Codes live-TV account login, status, expiry, connection information,
  categories/channels, associated XMLTV guide and refresh through the existing
  playlist catalog. Preserve saved channel identities and customizations.
- Produce an owner-signed sideload APK for user testing.

The required device targets are **Android phones and Android TV**. The owner
removed Fire devices from the requirements on September 11, 2026. Existing live
playback memory limits remain useful and should not be increased merely because
Fire devices are no longer a test target.

The owner subsequently approved multiview, capped at four simultaneous channels
on one device. Implement multiple player ownership, a shared memory budget, audio
and caption selection, provider connection checks and device-specific validation.

## Review boundaries

Preserve Cloudflare/D1, bot and admin changes already present in the workspace;
do not include those unrelated changes in this app release commit. Keep the
existing scraper/provider implementations and source-integrity manifest. Record
only explicitly reviewed player exceptions in a separate integrity manifest.

Real-Debrid discovery must not send account tokens to indexers, add torrents merely
to check availability, delete existing cloud torrents, or label a torrent globally
cached based only on its filename. The public API no longer supplies the old
instantAvailability endpoint. A ready badge refers to the verified selected file
in the connected user's cloud; other results remain unverified.

Device codec reports and filename metadata are hints, not guarantees of smooth
4K/HDR/AV1/HEVC playback. Physical device testing is required before making those
claims. Compilation and unit tests alone do not establish playback compatibility.

## Release checks (pending until results are recorded)

- Frontend tests, type checking and lint.
- Android Java/Kotlin compilation and meaningful resolver/file-selection tests.
- Native dependency, ABI, licensing and JNI review.
- Existing guide, native configuration and preserved-source guards.
- Signed host sideload build and package/signature verification.
- Android phone and Android TV playback, source switching, lifecycle and controls.

Do not mark device checks passed without actual device or emulator results.
