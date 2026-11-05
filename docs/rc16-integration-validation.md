# RC16 provider and shared-screen integration

This change completes the requested clone-derived provider paths inside MediaLab's existing source registry, secure credential store, guide databases, player ownership and shared navigation. It is a test release, not a public baseline promotion.

## Clone evidence

The supplied 5.3.3 clone APK has SHA-256 `59f895707e69803eb4ce42c2c1c594f14a2492e5e79d5dd2ab262befece0598c`. Protocol references are recorded beside the implementation. Recovered Stalker profile routine: `ev_9229e9dfae3630765ee5477bf01887cdf9ace4a0c8ec93863d2581bb461d06e5`; archive lookup: `ev_d6ac6cff3c53a695b38e6c4d85910ea0c99cb7f9ff43e2eebf37ed4a604c49ba`; series seasons: `ev_7d7eb79ba28559c6affc486a04b8a3e7677e126aae8f31021bfa14149c2ea58f`.

Xtream endpoint/model references are InterfaceC2867, C3860 movie URLs, C1847 series URLs, and C7027 provider-timezone archive URLs and XMLTV association. No unverified short-EPG endpoint was invented.

The recorded clone frame `clone-source-20.png` supplies the guide measurements; the earlier prototype screenshot is not evidence. Preview stays above the grid with programme details beside it. Logical preview size is 320 × 180, offset 16/12, details gap 24, grid gap 12, channel column 252, header 29 and row 40.

## App-wide connections

| Area | Implementation |
| --- | --- |
| Sources | Stalker setup, secure login, source-scoped channels, enabled state, revision checks and cleanup share playlistRegistry. Existing M3U and Xtream setup remain connected. |
| Live playback | Stalker channel commands resolve immediately before preparing the owned Media3 session. Late responses fail generation checks. Failed portal refresh cannot reuse an obsolete URL. |
| EPG | Portal schedules become bounded private XMLTV imports through the existing native guide store. Source ownership is derived centrally from the current registry for every caller. Source removal removes native guide ownership and assignments. |
| Assignment/backup | Portal channel directory and assignments appear in the shared Assign EPG drawer. Encrypted backup validates source/channel identities and restores portal assignment scope transactionally. |
| Provider VOD | Enabled Stalker and Xtream sources use one browser for categories, search, favorites, details, seasons and episodes. Shared shelves include provider favorites and resume points. |
| VOD playback | One-use in-memory handoff contains fresh source details; navigation/history never contain usable playback URLs. Player checks current enabled source and saved credentials, uses shared Media3, supports tracks, aspect, seeking, resume and completion. |
| Replay | Programme actions expose provider-supported archive replay. Availability is bounded by source archive days; dismissal cancels late handoff. No separate legacy catch-up screen is reintroduced. |
| Shared native library | Bundled VOD destinations run inside MainActivity and the shared shell. Settings open through app Settings. Native styling is restricted to VOD fragments, and native subtree layout is explicitly scheduled under React Native. |
| Account/lifecycle | Logout clears pending provider media handoffs; personal source persistence follows existing personal-playlist policy. Source changes invalidate browser/player work. Existing secure Remember me remains opt-in. |
| Appearance | Graphite/silver/violet theme, subtle drawer transparency, long VOD banner near top and raised catalog area; bounded guide logos and accessible channel numbering. |

## Guard changes reviewed

`nativeEpg.ts`'s exact normalized transport hash changes only for registry-derived portal source merging in `configureNativeUserGuideSources`. Managed primary M3U/EPG fetch URLs, headers and parsers are unchanged. The exact read-only primary directory bridge remains independently constrained.

The old whole-repository scan prohibited all catch-up text. The user explicitly requested complete clone archive functionality. `provider_replay_contract.py` accepts only the exact reviewed five adapter/caller files; changed bytes or new legacy catch-up paths still fail. Its negative test covers both cases. Other decoder, timer, lifecycle and transport scan rules remain enabled.

## Verification record

Before packaging: frontend unit/architecture tests, TypeScript, ESLint, native guide/config checks, preserved VOD source check, Media3-only checks, whole-repository interaction scan, Python guard tests and account-version reporting tests.

Android CI additionally compiles Kotlin/Java, executes app/VOD native unit tests, checks Android 7 API compatibility, builds the signed two-ABI sideload, verifies package/version/signing/managed-origin secrecy and encrypts the delivery archive.

Device verification and final artifact details must be recorded after the actual candidate passes. Protocol fixtures establish expected requests and parsing, not compatibility with every live provider. Network catalog loading remains necessary; removal of the old separate welcome/loading screen does not promise zero network latency. Signing, Hermes and encrypted delivery do not make an installed APK impossible to reverse engineer.
