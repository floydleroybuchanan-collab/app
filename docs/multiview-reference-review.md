# Multiview reference review

Reviewed September 11, 2026. The owner subsequently authorized multiview capped at four panes.
Device targets are Android phones and Android TV; Fire devices are excluded from
the required test matrix at the owner's request.

## Recommended primary reference

[AerioTV Android](https://github.com/jonzey231/AerioTV-Android), revision
`dcfd75673fa1a0af7cc1848dc42228d542196ad8` (September 5, 2026).

Inspected the actual `feature/multiview/MultiviewStore.kt`,
`MultiviewScreen.kt`, grid helpers, tile model, and license files. The implementation
uses Media3 players per tile, supports remote/touch selection, transfers audible
playback, replaces and reorders tiles, and releases tile players when their views
are removed. Its state store preserves the audible channel when slots are moved
or removed. It provides an appropriate behavioral reference for CharmIPTV's
existing Media3 live-TV playback.

Do not copy its settings wholesale. Its live-tile LoadControl prioritizes time
over byte thresholds and has no explicit shared byte budget at that construction
site. Charm needs an aggregate limit. Comments describing PCM audio are partly
stale: the actual default `tileAudioStrategy()` is `track`, which disables audio
tracks in non-audible panes. The alternatives are experimental; changing the
audible pane may briefly interrupt that pane. Nine tiles is an application cap,
not a verified hardware capability for all devices.

License: GPL-3.0-or-later with a specific Google Play services linking exception.
Treat this as reference material until code-reuse licensing compatibility is
reviewed. No source code has been copied into CharmIPTV for multiview.

## Secondary reference

[Davidona/StreamVault-IPTV](https://github.com/Davidona/StreamVault-IPTV), revision
`f86d4aeef21de4524a986c4ae87ac5f58ac42d25` (August 25, 2026), has a four-slot
manager, slot replacement, duplicate-channel handling, and TV multiview controls.
Its custom source-available noncommercial license makes it a less suitable code
donor. This is a different project from vitobotta/streamvault previously reviewed
for Real-Debrid.

## Approved CharmIPTV design

Add a Multiview command to live-TV controls, seed the current channel, and use the
existing guide for channel selection. Preserve Charm's colors, focus ring and
remote conventions. Start with two panes and optionally four on validated devices.
Provide Listen, Change channel, Fullscreen and Close controls per pane.

Build a separate live multiview session owner that releases guide preview before
opening tiles. Define total buffering and decoder limits, isolate pane failures,
handle audio focus and background transitions, and release every player on exit.
Account for provider connection allowances and bandwidth before adding streams.

Android explicitly describes `getMaxSupportedInstances()` as an upper-bound hint;
resource availability can lower the usable count:
https://developer.android.com/reference/android/media/MediaCodecInfo.CodecCapabilities#getMaxSupportedInstances()

The current research does not establish smooth multiview playback on any specific
CharmIPTV device. That requires actual playback, navigation and memory testing.
