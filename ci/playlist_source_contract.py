"""Exact transport snapshots for the user-authorized multi-playlist integration.

This extends the single-playlist repair gate without exempting whole files.
The source.native snapshot includes the reviewed RC.6 optional-source repair:
authenticated managed-content handoff, independent guide refresh, preserved
disable choices and explicitly empty enabled-catalog projections. HTTP/HTTPS
provider transport remains direct. See docs/rc6-source-focus-audit.md.
The follow-up reviewed scheduler/primary-parser repair is documented in
docs/rc6-build163-regression-repair.md; it does not change provider transport.
Any later edit must be reviewed again; the remaining player checks still run.
See docs/multiple-playlists-test-1.md and the behavioral/database tests.
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': '3b2f4c1e1aedbad8966e28712a1610a5348c85944bd7e3b8ed558afcc459bc35',
    'frontend/src/nativeEpg.ts': 'caa2c548a16b96563dcc32a4b7b34e02589302009482d683b0f179097b4f739e',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': 'c5d610ce625af16df4333a4972bc3370ebb236cc0232ab844fdf9b787526ff48',
}

def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
