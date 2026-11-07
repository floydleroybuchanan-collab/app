# RC17 source and guide audit

Baseline ed22cb45, RC17 build 224. This is a source and fixture audit. No device import or provider account was exercised.

| Path | Ownership, publication, and failure behavior |
|---|---|
| M3U | `playlistRegistry.ts` validates setup and keeps personal addresses in SecureStore. `EpgNativeModule.fetchPlaylist` hands HTTP or document input to `NativePlaylistParser` on a separate executor. The parser streams bounded input and rejects oversized imports. Registry validation prevents an empty or truncated catalog from replacing the active revision. |
| Xtream | `xtream.ts` validates account status before catalog import, maps provider IDs into source-scoped rows, and discovers the provider XMLTV feed. Catalog requests have a 30-second cancellation timer and 32 MiB response checks. A provider failure leaves the existing catalog in place. |
| Stalker | `stalker.ts` uses handshake, profile and optional login. It pages a bounded catalog and refreshes expired authentication once. Portal programs normalize to UTC, then `stalkerGuide.ts` writes an app-private XMLTV staging file and deletes it after native import. `CustomEpgNativeModule` verifies the source and canonical file path. |
| Catalog | `playlistRegistry.ts` serializes mutation, commits only after a revision file is written, retains current and previous revisions, and removes older files. Source-scoped IDs survive ordinary credential rotation and prevent identically named stations from colliding. Protected URL changes invalidate delayed managed catalog publication. |
| Guide | `source.native.ts` coalesces cold reads, publishes the first catalog independently, then synchronizes native catalog, associated guides, ownership and primary XMLTV. `playlistEpg.ts` reconciles feed links, then refreshes associated sources individually. Native ownership resolves automatic and manual bindings. `EpgDatabase.replaceBatches` stages bounded batches and swaps only a nonempty feed in a transaction. |
| Schedule | `SourceRefreshScheduler.tsx` holds a generation, avoids player/surfing routes, checks ownership between stages and defers publication when a screen becomes unsafe. `EpgUpdateScheduler.kt` checks visibility/playback before and after taking each database lease, checks the current source row, then honors due/retry and manual-only rules. `BackgroundEpgUpdater` rechecks the source at swap. Nested leases on the same thread are reentrant. |
| Cache | The JS window caches positive and negative results by window and guide generation, maintains a bounded set and distinguishes soft load trimming from strict runway retention. Native display caches bound painted channels to 128 normally or 64 on low-RAM devices. Native XMLTV transactions keep the last successful data readable while streaming and staging. |

## Corrections

- The same date/epoch key can recur after ownership invalidation or cache clear. Late native reads now check a monotonic cache generation before further fallback work, merge, trim or return. The test resolves a prior native read after the identical key is recreated and verifies that its data cannot merge.
- Cache rebuild previously allowed an active source job to rewrite metadata after clear. The clear operation now drains current cache writers and gates new ones until clearing completes. Stale cold snapshots cannot start a replacement import during maintenance. A deferred-write test verifies ordering and repeated-clear coalescing.
- Concurrent Stalker calls previously treated a handshake token as ready before the profile completed. They now wait for the pending auth operation. A rejected old token does not reset a newer token, and an already cancelled call does not start auth. A deferred-profile test verifies both callers remain blocked.
- Native primary, legacy custom, source custom and background XMLTV consumers now own the input stream outside lazy iteration. Previously an insert failure could abandon a generator suspended at a yielded batch before its inner stream finalizer ran. Native WorkManager checks stop/cancellation before work and after the lease, periodically during parsing, and before publication. Cancellation preserves the previous success clock and records cancelled history. A call-order guard verifies stream ownership and the worker checkpoints.

## Remaining limits

- The 17% display marks playlist completion before primary XMLTV dispatch. Diagnostic timings distinguish an actual parser delay from the executor queue, lease, cache, or associated source. There is no observed device trace establishing the cause of the reported stall.
- Cooperative WorkManager checks run between parser operations. A blocked socket read still relies on the existing read timeout. Rebuild intentionally waits for existing cache writers and does not force-abort a legitimate import.
- XMLTV byte/row limits bound input, not peak process RAM. Alias maps, directory results, and full catalogue projection still allocate across the bridge. Portal and Xtream JSON body size is validated after reading when no trustworthy content length is available. A measured low-memory Android import is required before changing these limits.
- The last-good transaction protects programme swaps. Alias and successful-refresh metadata are written separately after programme publication, so abrupt process death between those writes still needs a recovery design if observed.

Validation: focused JavaScript fixtures for source lifecycle, native source architecture, Stalker, and cache behavior. Android compilation and real-provider playback remain separate release gates.
