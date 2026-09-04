"""Exact transport snapshots for the user-authorized multi-playlist integration.

This extends the single-playlist repair gate without exempting whole files.
The source.native snapshot includes the reviewed RC.6 optional-source repair:
authenticated managed-content handoff, independent guide refresh, preserved
disable choices and explicitly empty enabled-catalog projections. HTTP/HTTPS
provider transport remains direct. See docs/rc6-source-focus-audit.md.
Any later edit must be reviewed again; the remaining player checks still run.
See docs/multiple-playlists-test-1.md and the behavioral/database tests.
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': '4da8e293af539342e178b3f115d679566521bc97e24ae5ce56dc00125ba81da4',
    'frontend/src/nativeEpg.ts': 'caa2c548a16b96563dcc32a4b7b34e02589302009482d683b0f179097b4f739e',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': 'eec2d6a4dbcc5300c586fa7a63f474d6bb0afe8dcd0999843695b0a7840d288e',
}

def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
