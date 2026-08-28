"""Lifecycle string checks apply to production source, not test assertions."""

TEST_PREFIXES = (
    "frontend/tests/",
    "frontend/android/app/src/test/",
    "frontend/android/app/src/androidTest/",
)


def lifecycle_findings(relative_path: str, source: str) -> list[str]:
    if relative_path.startswith(TEST_PREFIXES):
        return []
    findings = []
    if "setInterval(" in source and "clearInterval(" not in source:
        findings.append(f"interval has no file-local cleanup: {relative_path}")
    if "AppState.addEventListener" in source and ".remove()" not in source:
        findings.append(f"AppState listener has no obvious cleanup: {relative_path}")
    return findings
