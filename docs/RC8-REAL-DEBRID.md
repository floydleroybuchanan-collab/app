# RC8 Real-Debrid linking and source adapters

RC8 starts from RC7 build 171, commit `6a06ac2f87cb396055693953e912e676102b4bd8`. It preserves the current live TV, account, bot, admin panel and Cloudflare interfaces.

## Account linking

VOD Settings → VOD Sources and Real-Debrid → Real-Debrid account offers:

- **Sign in on this device**: opens the official Real-Debrid authorization page in a browser.
- **Link with a code**: displays a code and QR code for approval on another device.
- **Advanced: enter API token**: retains personal-token login.

The public repository uses Real-Debrid's documented open-source client, `X245A4XAIBGVM`. A registered application's client ID can override it through `REAL_DEBRID_CLIENT_ID` (GitHub repository variable or local build configuration). No user client secret, password or account token is bundled into the APK.

Device authorization requests new per-user credentials, observes the server's polling interval and expiry, and exchanges the private device code after approval. Only the user-facing code and official verification URL appear in the dialog. Cancellation stops pending linking. An account revision prevents a delayed authorization from replacing a newer account choice.

Access tokens, refresh tokens and user-specific client credentials use the existing Android Keystore AES-GCM vault in the app's no-backup directory. Tokens refresh before expiry or once after a confirmed unauthorized response. Personal tokens require reconnection when revoked. Token data is excluded from browser URLs, provider requests, playback intents and logs.

Account settings include refresh status, expiry information, a local connection label, disconnect and a link to manage website connections. The label is local to CharmIPTV; it does not rename an OAuth application on Real-Debrid. Disconnect clears local credentials. Revoking the website authorization remains available on Real-Debrid's Devices page.

## Settings appearance

The VOD Sources and Real-Debrid entry now uses the same chevron widget and existing SettingsListStyler as the other top-level cards. It inherits their size, spacing, typography, colors and TV focus behavior.

## Sources

- Adds native SendVid, EarnVids/VidHide-family and public VK host-page adapters.
- Adds a bounded HTML/packed-player fallback for known MP4Upload, Sibnet, UQLoad, VidMoly, Vidoza and related host domains.
- Resolves explicit relative sources against the final player page.
- Preserves existing host-specific extractors, catalog providers, subtitle behavior, source switching and player engines.
- Adds a separate Real-Debrid host option when a discovered original host link matches RD's published supported domains. Availability is checked when selected before unrestricting the link. Host options are not labeled as torrents; torrent options retain red titles and magnet icons.
- Retains existing torrent discovery and cloud verification. No undocumented instant-availability endpoint is added, and discovery does not add torrents to an account.

An extractor needs a title-specific host link from a catalog provider. Adding an extractor does not turn that host into a movie search catalog. Compatibility tests use synthetic markup; they do not certify current uptime or every variant of every host. Unsupported, private, removed or protected pages may still fail and should offer another source.

No new external FileMoon/MegaCloud decryption service is added. No code from sources with missing licensing was copied. Behavior references and Apache licensing are included under `assets/licenses/host-extractors` and available from Playback licenses and source.

## Validation

OAuth regression tests cover pending approval, credential exchange, refresh requests, incomplete credentials, public/private code separation and official-browser URL restrictions. Host parser tests cover representative markup, relative URLs, captions, headers and rejection of unrelated or unsafe links. The existing exact source-preservation guard allows only individually reviewed changes.

The live public-client code endpoint returned a valid code, official verification URL, five-second polling interval and 900-second expiry during implementation. An end-to-end login and playback check still requires the account owner's authorization and device. Live host uptime and all codecs on all hardware are not implied by a successful build.

References: [Real-Debrid API and OAuth documentation](https://api.real-debrid.com/), [device approval](https://real-debrid.com/device), [connection management](https://real-debrid.com/devices), [Yuzono references](https://github.com/yuzono/anime-extensions/tree/7a6f1474b6e48e477b5952af3ca635acff556496).
