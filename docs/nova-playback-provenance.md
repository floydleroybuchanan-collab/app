# Embedded Nova playback provenance

The optional VOD engine uses the Nova v6.4.63 release. The CI materialization
script checks the complete release APK SHA-256 before extracting an explicit
allowlist of playback libraries. It does not install or launch Nova's application,
load its torrent daemon, or download executable code at runtime.

Release APK:
`org.courville.nova-2669509-6.4.63-20260909.2142-universal-release.apk`

SHA-256: `3c70d4bf5cf86ab84f720899aaed3f5757b5ed4f73fcba7c05499f301f6a7a11`

Release and build manifests:
https://github.com/nova-video-player/aos-AVP/releases/tag/v6.4.63

The exact upstream project revisions are included in the APK asset
`licenses/nova/nova-v6.4.63-manifest.xml`. Core revisions:

- aos-MediaLib: `53ba67259afa100e0898d7b6500413fb027d4b6f`
- aos-avos: `2cf21c486c7bf244c49b78d2220197a6d75396dd`
- aos-Video: `f53a1fc055d1d550a2edad4992bf82f9d12a7872`
- aos-FileCoreLibrary: `b0b6716bf8c9c2c672eca1dd2b842c1b05556fd5`

Java JNI adapters retain Archos's Apache-2.0 notices. Charm changes remove SMB
proxy dependencies and unused optional audio-transformer bindings; the
CodecDiscovery JNI callback is implemented against Android's codec APIs.
The native release libraries are unmodified. AVOS/MediaLib use Apache-2.0;
FFmpeg's embedded configuration reports LGPL-2.1-or-later, without enable-gpl.
Bundled dependencies include dav1d, Opus, libmysofa and OpenSSL. Retain their
licenses and corresponding source/build references with redistributed builds.

The live-TV Media3 FFmpeg audio extension is independently built from its existing
pinned source and linked statically into libffmpegJNI. The optional Nova engine
runs in Charm's existing VOD process. Native library presence does not prove that
a device can decode every advertised codec/profile, sustain 4K software decoding,
or display HDR correctly.

## Current integration boundaries

Media3 remains the default VOD engine. Nova can be selected in VOD Settings and
offers an explicit return to Media3. Real-Debrid authentication uses the user's
personal API token, encrypted locally with Android Keystore; an OAuth device-code
flow requires a registered application client ID and is not supplied by borrowing
another project's identity.

The source picker identifies verified files already ready in the user's cloud.
It cannot claim global cache availability from the removed instantAvailability
endpoint. Unknown results require explicit preparation. Multiview is for live TV
and uses Media3; it does not start multiple Nova engines.

Before calling this integration device-tested, validate JNI loading, seeking,
audio/captions, source handoff, resume and lifecycle on Android phones and Android
TV. Fire devices are no longer required. External subtitle sidecars and playback
features not represented by the native dialog must be checked separately from
embedded subtitle-track selection.
