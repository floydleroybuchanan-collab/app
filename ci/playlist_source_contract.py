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
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': 'fb6450318c0fd71316b76963c0e302e51dbe6c23cd86b5b44f62be96a47f475d',
    'frontend/src/nativeEpg.ts': 'dd9bae6d41e03939a979c86b8bcc8594b56216e8309a3dcfb5ce60422d9c4456',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': '171d02004c211d9310a8d2ead7ccaaf7d4fe93b1876b4e19b84b83bc3f0a3daa',
}

def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
