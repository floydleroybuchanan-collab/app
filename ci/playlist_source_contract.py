"""Exact transport snapshots for the user-authorized multi-playlist integration.

This extends the single-playlist repair gate without exempting whole files.
Any later edit must be reviewed again; the remaining player checks still run.
See docs/multiple-playlists-test-1.md and the behavioral/database tests.
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': '8bb6ed14cd6ec73ea184be81e00bdac4dd258fdf188ecda5cb152020e52b5e90',
    'frontend/src/nativeEpg.ts': 'd00cc38c78856466009ba6036ec3a4e05a8861ca40b91609879d0cdec7627603',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': '883d9d4edb7d815a510d732f56a8a0e0d3d3140d7e29e1a18bd6421808aae19f',
}

def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
