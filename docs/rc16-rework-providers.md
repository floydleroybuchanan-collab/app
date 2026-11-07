# RC16 rework provider integration

The registry now contains **74 provider entries**: the existing 68 plus NetPrime (English movies/series), Filmo (German movies), Kellerkino (German movies), KinoGer (German movies/series), euroStreaming (Italian series), and Vavoo English (UK/US live groups). Sflix, Animefenix and AnimeFlv remain available although absent from the supplied ZIP registry. TMDb remains the existing default. Both provider pickers use the registry and language filters automatically.

## Integration

- NetPrime uses existing Vidrock, VidLink and TwoEmbed adapters and added Vidlove, Videm and Vidnest TMDb resolution.
- Added central extractor registrations for Firestream, Fastream, Hexload, MovieMaster, Videoapp, Vidlove, Videm, DeltaBit and Turbovid. Existing extractors and custom fallback routing remain intact.
- Added custom-domain preference access needed by imported providers without replacing stored provider selections or the existing provider cache.
- Imported direct HTTP requests use cancellation-aware calls, total timeouts and response closure. Direct HTML/JSON reads are bounded; Filmo's session-cookie list is capped. Cancellation propagates instead of turning into an empty-source fallback. Videm now resolves both relative and absolute stream URLs correctly.
- Vavoo uses its existing app protocol with English configuration; request language/region now follow the selected instance. No TLS-validation relaxation was imported.
- No new Gradle dependency or native secret getter was required. Existing account, database, WebView and source-aggregation integrations were retained.

## Verification and limits

The production VOD Kotlin compile passed during coordinated validation. ProviderCancellationTest passed all three regression cases: cancellation propagation, normal failure fallback and successful-result preservation; BoundedProviderCacheTest passed4/4, SearchPaginationTest3/3 and SourcePickerLayoutTest4/4. The implementing playback agent confirmed fresh XML. A later diagnostic-only redaction in seven new imported files removes URL/challenge/body/exception-detail leakage and requires the final incremental Kotlin compile. These tests do not establish live-provider compatibility.

No live catalog, search or playback success is claimed for these additions. Provider availability, geoblocking, anti-bot checks, host changes and device decoding still require runtime testing. Retrofit-converted responses were not all given new response budgets; this is not a claim of a complete provider-memory audit.

Uprot intentionally uses the app's existing configured resolver API and page decoding. The ZIP's remotely downloaded executable configuration and additional native-secret protocol were not imported. Consequently, euroStreaming links depending on that newer Uprot protocol may fail; this needs live compatibility testing rather than being reported as verified support.

## Preserved-source review guard

The original preserved-source hash manifest was not changed. The exact allowlist gains only Provider.kt and VavooProvider.kt; reviewed hashes were refreshed for those files, Extractor.kt, PlayerMobileFragment.kt and PlayerTvFragment.kt. Each entry retains its original upstream hash and documents the reviewed changes. Player files were inspected and confirmed stable by their implementing agent before hashing.

`node frontend/scripts/verify-vod-source.mjs` passed: 190 preserved files,13 exact reviewed exceptions after the two additional bounded DOM-cache changes. The guard still fails on unreviewed changes; it does not cover newly added files or substitute for runtime tests.
