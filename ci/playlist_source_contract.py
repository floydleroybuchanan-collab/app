"""Exact transport snapshots for the user-authorized multi-playlist integration.

This extends the single-playlist repair gate without exempting whole files.
Any later edit must be reviewed again; the remaining player checks still run.
See docs/multiple-playlists-test-1.md and the behavioral/database tests.
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': '8bb6ed14cd6ec73ea184be81e00bdac4dd258fdf188ecda5cb152020e52b5e90',
    'frontend/src/nativeEpg.ts': 'ea064ba8b17531b43f7ff702516eed1bfbc1f70c1cc098d81ce635d1db8b9da2',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': 'f0bdf8960ec205b2ac67f21bf6f2e9228cb04b29ddefafad9c013aafcc195ef4',
}

def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
