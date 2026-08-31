# Multiple playlists test 1

Base: VOD build 139, `847c1963face34766dc658b1e1f9120ffb580068`.
Branch: `feature/multiple-playlists-test-1`. Do not merge into main without TV testing and review.

## Reference and implementation choices

The behavioral reference is [Eliminater74/TiVIMate_Analysis](https://github.com/Eliminater74/TiVIMate_Analysis/tree/eab124bb2cf19d0512fa729c30e3328177db434c). Its Markdown reports are design references, not verified proprietary source code. Performance claims in those reports are not acceptance evidence for this app.

| Reference report | Behavior used here | Implementation / evidence |
| --- | --- | --- |
| `tivimate_playlist_setup_wizard_deep_dive.md` | Validate before activating; cancel leaves current catalog intact | Settings → Playlists; masked URL or Android document picker; validation preview and explicit Save |
| `tivimate_playlist_management_analysis.md` | Independent playlist identity, enable/disable, order and customization preservation | `playlistRegistry.ts`, `playlistCatalog.ts`; primary channel IDs unchanged, additional IDs scoped to immutable source IDs |
| `tivimate_playlist_update_safety_analysis.md` | Last-good data; never replace unrelated sources or user customizations | Immutable per-source revisions, persisted revision pointers, previous-revision recovery; complete aggregate native projection; behavioral failure/concurrency tests |
| `tivimate_playlist_epg_update_analysis.md` | Independent playlist and EPG refresh clocks and associations | Per-playlist update settings; shared EPG records; ordered source associations and exact TVG-ID matching |
| `tivimate_search_architecture_analysis.md` | Browse/search distinguish sources | Drawer playlist entries, defaulting to the first supplied service and remembering selection; optional All Playlists; source labels in search; source-scoped provider groups |

The existing native SQLite catalog is retained as the guide's combined, indexed projection. It is **never** given an individual source as though that source were the whole catalog. Source-owned snapshots are staged in private app storage. This avoids a destructive migration of existing channel IDs and Room customizations. It is a bounded test implementation, not the reference reports' claimed 100,000-channel architecture.

Automatic EPG associations live in a new Room table (control database 3 → 4). Existing manual binding rows are not rewritten. Effective queries prefer any explicit manual assignment over automatic exact-ID selection. Identical XMLTV IDs in different EPG databases remain distinct. Missing IDs are not guessed from generic station names. Feed priority selects the first associated directory containing the exact ID; newly added feeds are imported with the associated candidates before final selection. Each EPG record is downloaded once per association refresh, shared by all its playlists.

## Supplied services and user additions

- Existing `M3U_URL` / `EPG_URL` remain the first supplied service.
- `M3U_URL_2` / `EPG_URL_2` supply the second service; the playlist slot appears when configured. URLs are not editable in the supplied service UI.
- Supplied playlists may be disabled and reordered but not removed. Download another source before disabling the last usable catalog.
- Five personal M3U playlists are supported in this test build, with a combined enabled-channel budget of 25,000. Oversized/truncated imports do not silently replace a working catalog.
- Personal playlist addresses use Android SecureStore; parsed channel caches remain private app data. Credentials embedded in a distributed APK cannot be considered secret from its recipient.
- The second supplied EPG has a reserved slot. The existing eight user EPG slots remain available: original Custom EPG plus seven additional feeds. Ten EPG slots total including both supplied feeds; this is a configuration limit, not a device capacity benchmark.
- Local documents retain Android read permission. A missing USB drive/document causes refresh failure while the saved catalog remains usable. TVs without a system document picker can use URL input.
- EPG setup remains in the existing EPG manager. Save/enable a feed there, then associate it in Playlists; select multiple feeds in priority order. Deselect/reselect changes priority. Manual channel assignments remain available in EPG settings.
- Playlist settings require the existing parental PIN when configured. Existing playback/guide lock paths remain in use.

## Validation and scope

New behavioral tests cover duplicate IDs/groups, legacy favorites, migration seeding, source-isolated updates/recovery, failed downloads, failed persistence, credential rollback, enable/disable, removal during import, and the personal-source limit. Real SQLite tests execute the shipped migration and effective-binding queries, including manual precedence and same XMLTV ID in separate feeds.

The original live Media3 player and VOD implementation are retained. The upstream VOD integrity check still protects 190 provider/extractor/player/model/database files. No Xtream account adapter, Stalker adapter, catch-up, recording or multiview was added.

This test does not implement a TiviMate-compatible full settings backup, provider account information, or additional playlist-specific time-offset controls. Existing favorites backup and EPG controls remain. The local M3U parser handles the same stream entries as the host's existing parser; this is not an Xtream movie/series catalog adapter.

Before production use, test on an actual TV: install over build 139 without clearing data, verify existing favorites, both supplied services and user lists, duplicate station IDs, DPAD focus, guide search jumps, fullscreen Back, file removal, offline startup, refresh failure, PIN locks and memory under real feed sizes. No connected TV/emulator was available during development; successful compilation and APK verification do not establish device playback or DPAD behavior.


## Expandable playlist drawer revision

Both guide drawers show expandable playlist headers. Each source contains All Channels, Favorites and its original M3U groups; the optional All Playlists section aggregates only when chosen. The existing app navigation and VOD remain. Raw provider groups use an encoded UI identity so a provider group called Sports or Favorites cannot accidentally invoke an app-generated category. Group labels, order, hidden metadata and custom group membership remain separate from parsed stream records. The obsolete curated-tab and global provider-tab controls are removed; startup choices are Last used, All Channels, Favorites and custom groups.

Choosing a PIN-protected group defers source selection until the PIN succeeds. Source changes discard a remembered focus target belonging to another playlist. Disabling or removing the last usable playlist is refused until another catalog is available.

The custom EPG source normalizer is now idempotent. Existing double-normalized programme database filenames are reused when present, without moving SQLite/WAL files. Three Android unit tests cover normalization and legacy database selection.

The previous player-interaction gate pinned transport to a single-playlist snapshot. Its reviewed snapshot contract now includes the three authorized multi-source integration files by exact SHA-256; unknown changes still fail, and all other player checks remain active. This is an explicit audit-baseline update, not a playback-code change or blanket gate exemption. The contract itself is tested.


## Playlist-header EPG discovery

Downloaded and local M3U files now recognize `url-tvg`, `x-tvg-url`, and `tvg-url` in the EXTM3U header. Discovery accepts HTTP(S), resolves relative links for remote playlists, deduplicates URLs and caps discovery at eight feeds. Header URLs are not exposed in status messages. Detected URLs/EPG records are stored in private app preferences, like the existing custom EPG manager; this storage is not a claim of protection from a rooted device.

The validation preview reports the count but changes no EPG configuration. Saving or refreshing a valid playlist records its header, reuses existing feeds and creates available custom EPG slots. Existing configured owner EPGs are retained. Manual playlist association choices turn automatic association off; manual channel assignments always win. A per-playlist detection switch can re-enable discovery. Disabled shared feeds stay disabled. Capacity errors retain previous associations and display a corrective message. Removing a playlist does not delete shared feeds.

TiviMate auto-detection is documented by the playlist-producing project's integration guide: https://ersatztv.org/docs/clients/tivimate/ . This is evidence of supported integration behavior, not access to proprietary TiviMate source.
