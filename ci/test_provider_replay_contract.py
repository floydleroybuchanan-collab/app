import unittest
from pathlib import Path
from provider_replay_contract import REVIEWED, is_reviewed_provider_replay

ROOT = Path(__file__).resolve().parents[1]

class ProviderReplayGate(unittest.TestCase):
    def test_exact_reviewed_adapters_only(self):
        for path in REVIEWED:
            source = (ROOT / path).read_text(encoding="utf-8")
            self.assertTrue(is_reviewed_provider_replay(path, source), path)
            self.assertFalse(is_reviewed_provider_replay(path, source + "\n// changed decoder handoff"), path)
            self.assertFalse(is_reviewed_provider_replay("frontend/app/catchup.tsx", source))

if __name__ == "__main__":
    unittest.main()
