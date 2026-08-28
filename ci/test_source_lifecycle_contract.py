import unittest
from pathlib import Path

from source_lifecycle_contract import lifecycle_findings


class SourceLifecycleContractTests(unittest.TestCase):
    def test_protected_sources_and_contract_helpers_trigger_native_gate(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/android-native-ci.yml").read_text(encoding="utf-8")
        for path in ("frontend/src/source.native.ts", "frontend/src/nativeEpg.ts", "ci/source_lifecycle_contract.py", "ci/guide_cache_source_contract.py"):
            self.assertEqual(2, workflow.count(f'- "{path}"'), path)

    def test_production_leaks_still_fail(self):
        for path in ("frontend/src/hook.ts", "frontend/app/player.tsx", "frontend/plugins/plugin.js"):
            self.assertEqual(2, len(lifecycle_findings(path, "setInterval(work); AppState.addEventListener(change)")))

    def test_cleaned_up_production_listeners_pass(self):
        source = "setInterval(work); clearInterval(timer); AppState.addEventListener(change); sub.remove()"
        self.assertEqual([], lifecycle_findings("frontend/src/hook.ts", source))

    def test_only_explicit_test_trees_ignore_assertion_strings(self):
        source = "setInterval(work); AppState.addEventListener(change)"
        for path in ("frontend/tests/lifecycle.test.mjs", "frontend/android/app/src/test/Fixture.kt"):
            self.assertEqual([], lifecycle_findings(path, source))
        self.assertEqual(2, len(lifecycle_findings("frontend/src/testsScreen.tsx", source)))
