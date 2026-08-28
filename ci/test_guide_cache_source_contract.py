import unittest

from guide_cache_source_contract import CACHE_LIFECYCLE_REPAIRS, normalize_audited_guide_cache_lifecycle


class GuideCacheSourceContractTests(unittest.TestCase):
    def test_exact_reviewed_cache_changes_reverse(self):
        for before, after in CACHE_LIFECYCLE_REPAIRS:
            self.assertNotEqual(before, after)
            self.assertEqual(before, normalize_audited_guide_cache_lifecycle(after))

    def test_changed_cache_code_or_added_timer_is_not_hidden(self):
        for before, after in CACHE_LIFECYCLE_REPAIRS:
            changed = after.replace("\n", "\nsetTimeout(stopPlayback, 1000);\n", 1)
            normalized = normalize_audited_guide_cache_lifecycle(changed)
            self.assertNotEqual(before, normalized)
            self.assertIn("setTimeout(stopPlayback, 1000)", normalized)

    def test_unrelated_transport_changes_remain_visible(self):
        before, after = CACHE_LIFECYCLE_REPAIRS[0]
        transport = 'fetch("https://changed.invalid/playlist");\n'
        self.assertEqual(transport + before, normalize_audited_guide_cache_lifecycle(transport + after))

    def test_duplicate_repair_blocks_are_not_silently_accepted(self):
        for _, after in CACHE_LIFECYCLE_REPAIRS:
            self.assertEqual(after + after, normalize_audited_guide_cache_lifecycle(after + after))
