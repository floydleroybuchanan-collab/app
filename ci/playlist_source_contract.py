"""Exact transport snapshots for the user-authorized multi-playlist integration.

This extends the single-playlist repair gate without exempting whole files.
The source.native snapshot includes the reviewed RC.6 optional-source repair:
authenticated managed-content handoff, independent guide refresh, preserved
disable choices and explicitly empty enabled-catalog projections. HTTP/HTTPS
provider transport remains direct. See docs/rc6-source-focus-audit.md.
The follow-up reviewed scheduler/primary-parser repair is documented in
docs/rc6-build163-regression-repair.md; it does not change provider transport.
The build-166 stability follow-up adds per-stage scheduling gates, reports
match-write failures honestly, and leases native imports through metadata
publication. URLs, parsers, request headers and payload delivery are unchanged.
Regression coverage: stability166Regression.test.mjs and EpgImportCoordinatorTest.
RC9 changes display/log brand strings only; transport is unchanged.
Any later edit must be reviewed again; the remaining player checks still run.
See docs/multiple-playlists-test-1.md and the behavioral/database tests.
Build 2550: setProgress is now exported (unused across process boundaries;
still the same private module state, just visible to playlistRegistry.ts),
and fetchPlaylist() passes a 4th onProgress callback into the existing
refreshPlaylists() call so a large catalog's startup screen stops sitting
frozen at its floor percentage. Neither change touches a URL, parser,
request header or payload: refreshPlaylists()/previewPlaylist() themselves
(frontend/src/core/playlistRegistry.ts) are untouched here, and the
callback only ever calls setProgress with a UI ratio/label.
Build 2552: the build-2550 fix only reached ensureLoaded()'s fresh-fetch
branch (refreshInternal/fetchPlaylist). A returning device with an
already-cached channel list takes ensureLoaded()'s separate cached-path
branch instead, which still does real work for a large account (combining
playlists, syncing thousands of rows into the native database) and
reported no progress of its own - the startup bars still sat frozen on a
warm cache. That branch now calls the same setProgress with a UI
ratio/label at each step; still no URL, parser, header or payload change.
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': 'f3826cb1c1198cc9459083c2c1c87f235eaaf2387d21f850b11a5b3c4297daaa',
    'frontend/src/nativeEpg.ts': 'dd9bae6d41e03939a979c86b8bcc8594b56216e8309a3dcfb5ce60422d9c4456',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': '171d02004c211d9310a8d2ead7ccaaf7d4fe93b1876b4e19b84b83bc3f0a3daa',
}

def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
