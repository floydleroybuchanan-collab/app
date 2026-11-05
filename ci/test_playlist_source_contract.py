import unittest
from pathlib import Path
from playlist_source_contract import REVIEWED_PLAYLIST_TRANSPORT, PRIMARY_DIRECTORY_BRIDGE, is_reviewed_playlist_transport, normalize_primary_directory_bridge

ROOT = Path(__file__).resolve().parents[1]


class PlaylistTransportGate(unittest.TestCase):
    def test_only_exact_reviewed_snapshots_are_accepted(self):
        for path in REVIEWED_PLAYLIST_TRANSPORT:
            source = (ROOT / path).read_text(encoding="utf-8")
            self.assertTrue(is_reviewed_playlist_transport(path, source), path)
            self.assertFalse(is_reviewed_playlist_transport(path, source + "\n// unreviewed transport edit\n"), path)
            self.assertFalse(is_reviewed_playlist_transport("unlisted-file.ts", source))

    def test_directory_bridge_is_exact_and_transport_is_still_pinned(self):
        for path, fragments in PRIMARY_DIRECTORY_BRIDGE.items():
            source = (ROOT / path).read_text(encoding="utf-8")
            original = normalize_primary_directory_bridge(path, source)
            self.assertTrue(is_reviewed_playlist_transport(path, original), path)
            for fragment in fragments:
                self.assertFalse(is_reviewed_playlist_transport(path, source.replace(fragment, fragment + fragment)), path)
                self.assertFalse(is_reviewed_playlist_transport(path, source.replace(fragment, fragment.replace("100", "101").replace("number", "unknown", 1))), path)
            # Changing unrelated transport bytes cannot be hidden by the bridge.
            self.assertFalse(is_reviewed_playlist_transport(path, source.replace("User-Agent", "Changed-Agent", 1)), path)
            self.assertFalse(is_reviewed_playlist_transport(path, source + "\n// altered fetch/parser/header behavior\n"), path)


if __name__ == "__main__":
    unittest.main()
