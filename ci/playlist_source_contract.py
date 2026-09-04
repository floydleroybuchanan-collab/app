"""Exact transport snapshots for the user-authorized multi-playlist integration.

This extends the single-playlist repair gate without exempting whole files.
The source.native snapshot includes the reviewed RC.6 authenticated managed-
content handoff; direct HTTP/HTTPS stream compatibility and the existing
playlist/EPG parsing, caching, and player ownership remain unchanged.
Any later edit must be reviewed again; the remaining player checks still run.
See docs/multiple-playlists-test-1.md and the behavioral/database tests.
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': '058640b429cf2637d472a8af1bb11d6ada62a4e92a35663dd4b31c2b11cfb552',
    'frontend/src/nativeEpg.ts': 'd00cc38c78856466009ba6036ec3a4e05a8861ca40b91609879d0cdec7627603',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': '883d9d4edb7d815a510d732f56a8a0e0d3d3140d7e29e1a18bd6421808aae19f',
}

def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
