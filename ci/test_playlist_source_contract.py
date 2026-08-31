import unittest
from pathlib import Path
from playlist_source_contract import REVIEWED_PLAYLIST_TRANSPORT, is_reviewed_playlist_transport

ROOT = Path(__file__).resolve().parents[1]


class PlaylistTransportGate(unittest.TestCase):
    def test_only_exact_reviewed_snapshots_are_accepted(self):
        for path in REVIEWED_PLAYLIST_TRANSPORT:
            source = (ROOT / path).read_text(encoding="utf-8")
            self.assertTrue(is_reviewed_playlist_transport(path, source), path)
            self.assertFalse(is_reviewed_playlist_transport(path, source + "\n// unreviewed transport edit\n"), path)
            self.assertFalse(is_reviewed_playlist_transport("unlisted-file.ts", source))


if __name__ == "__main__":
    unittest.main()
