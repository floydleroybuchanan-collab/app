"""Exact clone-derived replay additions authorized for the RC16 integration.

The old standalone catch-up implementation remains prohibited. These reviewed
adapters use the owned StreamPlayer through an opaque one-use handoff, verify
current source credentials, and expose replay only inside the provider window.
See docs/rc16-integration-validation.md and frontend/tests/xtreamMedia.test.mjs.
"""
import hashlib
import json
from pathlib import Path

REVIEWED = json.loads((Path(__file__).parent / "provider-replay-sha256.json").read_text(encoding="utf-8"))

def is_reviewed_provider_replay(path: str, source: str) -> bool:
    expected = REVIEWED.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
