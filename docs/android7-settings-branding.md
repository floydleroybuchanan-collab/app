# Android 7 compatibility and settings/branding update

## Scope

- Android minimum becomes API 24 (Android 7.0), with target/compile API 36 unchanged.
- Both ARMv7 and ARM64 remain packaged in one owner-signed, non-debuggable sideload APK.
- Version code increases from 11 to 12; installation identity and owner certificate stay unchanged for in-place updates.
- Android 5/6 and non-Android platforms such as Vega OS are not supported by this build.
- Future Android versions and every manufacturer's firmware cannot be certified by a build check alone.

## Compatibility changes

Host, embedded VOD, and Expo configuration agree on API 24. Existing Java library desugaring remains enabled in host and VOD. The VOD entrance no longer calls API-26-only `ValueAnimator.areAnimatorsEnabled()` on Android 7: it reads the system animation-duration setting instead. No changes to provider/extractor/player/data implementations are required by that fallback.

An opt-in Android lint gate checks `NewApi` and `InlinedApi` before APK packaging. The final APK verifier checks the merged minimum, modern target, optional TV hardware, both native ARM architectures, owner-signing checks in the workflow, and existing bundle/player rules.

Camera and autofocus hardware are explicitly optional, alongside optional touchscreen, Leanback and microphone declarations. No country gating was found in the host installer configuration, build workflow, account authentication or managed-source handoff code. This is not a claim that every ISP, download service, external provider or Cloudflare dashboard rule is unrestricted. Their regional network rules affect download/reachability/content, not the APK's minimum OS version. No geography bypass, certificate bypass, account weakening or provider-URL embedding was added.

## Settings

Playlists now uses the same complete-page focus boundary as EPG Settings. The nested scroll-only upward trap is removed. Scroll clipping is disabled, the scroll container itself cannot own focus, and route/list/editor entry resets scroll to the top while the existing route hook focuses All Settings / Cancel edit. Busy action buttons stay mounted and focusable but ignore presses. A synchronous in-flight guard prevents repeated operations before React publishes busy state.

All four overscan controls now change by 1 pixel per press, retaining existing limits, saved values, Save & Apply, Reset and Discard.

## Artwork

The user-supplied 1254 × 1254 PNG is preserved unchanged in the source assets and native drawable. The VOD canvas renders it through an antialiased circular bitmap shader, with a diameter of 244 units on the existing 960 × 540 design canvas (previously 200). Text and finite entrance/skip behavior remain unchanged. Legacy launcher, adaptive launcher and TV banner resources use the same artwork with purpose-specific sizing. The new native resource remains local and needs no image download.

## Validation

- 374 frontend tests, TypeScript, ESLint and native source/config checks passed locally.
- 27 CI Python tests and Media3-only source guards passed locally.
- Android resource compilation passed locally.
- Browser sizing preview inspected: circular welcome artwork fits above all text; this is a visual aid, not an Android device test.
- Native API audit, final signed artifact checks and hardware installation results must be recorded with the delivered build. No Android device is connected to this workstation.

## Device acceptance checklist

On Android 7.0 / Fire OS 6 and a current Android TV device: update without uninstalling, cold launch/login, session restore, both supplied playlists and EPGs, HTTP and HTTPS playback, settings list/editor navigation, rail left/right handoff, screen-fit save/relaunch, and VOD entrance/skip/playback. Repeat playlist focus checks during a refresh and after returning from EPG Settings. Check launcher artwork after the launcher refreshes its cache.
