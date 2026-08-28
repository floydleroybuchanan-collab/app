#!/usr/bin/env python3
"""Fail CI if the removed VLC engine or a retired player repair is enabled.

EXTVLCOPT is a playlist metadata syntax. Preserve its HTTP headers for Media3;
it is intentionally allowed and must not be confused with a VLC runtime.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {"node_modules", "build", ".gradle", ".expo", "dist", ".cxx", "test", "androidTest"}
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".kt", ".java", ".gradle", ".json", ".patch", ".xml", ".kts", ".properties", ".toml"}
RUNTIME_MARKERS = (
    "org.videolan", "org/videolan", "libvlc", "react-native-vlc-media-player",
    "RCTVLCPlayer", "NativeVlc", "nativeVlcPlayback", "vlcAvailable", "<VLCPlayer",
)
OWNER_PUBLISHER = ".github/workflows/build-media3-sideload-now.yml"
ENCRYPTED_UPLOAD_PATHS = [
    "frontend/protected-artifacts/sideload.zip.enc",
    "frontend/protected-artifacts/sideload.zip.enc.json",
]


def source_findings(relative: str, source: str) -> list[str]:
    findings = []
    if re.search(r"nativevlc|libvlc", relative, re.I):
        findings.append(f"Removed VLC implementation file remains: {relative}")
    for marker in RUNTIME_MARKERS:
        if marker.lower() in source.lower():
            findings.append(f"VLC runtime reference: {relative}: {marker}")
    if re.search(r"\breturn\s+[\"']vlc[\"']", source):
        findings.append(f"VLC engine routing remains: {relative}")
    return findings


def retired_workflow_findings(relative: str, source: str) -> list[str]:
    """Only job-level false guards count; a comment or disabled step does not."""
    findings = []
    job_blocks = re.findall(r"(?ms)^  [A-Za-z_][\w-]*:\n(.*?)(?=^  [A-Za-z_][\w-]*:\n|\Z)", source.split("\njobs:\n", 1)[-1])
    if not job_blocks:
        return [f"Retired workflow has no inspectable jobs: {relative}"]
    for index, block in enumerate(job_blocks, start=1):
        if not re.search(r"(?m)^    if:\s*\$\{\{\s*false\s*\}\}\s*$", block):
            findings.append(f"Retired player workflow job {index} is executable: {relative}")
    return findings


def retired_script_findings(relative: str, source: str) -> list[str]:
    statements = ast.parse(source).body
    for node in statements:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        if isinstance(node, ast.ImportFrom) and node.module == "__future__":
            continue
        if (isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call)
            and isinstance(node.exc.func, ast.Name) and node.exc.func.id == "SystemExit"
            and node.exc.args and isinstance(node.exc.args[0], ast.Constant)
            and str(node.exc.args[0].value).startswith("Retired player repair: Media3-only playback")):
            return []
        break
    return [f"Retired player mutation can still execute: {relative}"]


def active_workflow_findings(relative: str, source: str) -> list[str]:
    """Fail closed on unreviewed uploaders and stale provider-input fallbacks.

    This checks our canonical workflow layout, not arbitrary YAML semantics.
    Workflow syntax is also parsed separately during validation.
    """
    findings = []
    if re.search(r"vars\.EXPO_PUBLIC_(?:M3U|EPG)_URL", source):
        findings.append(f"Old provider-variable fallback remains: {relative}")
    if re.search(r"EXPO_PUBLIC_(?:M3U|EPG)_URL:", source):
        if not re.search(r'(?m)^      EXPO_NO_DOTENV:\s*["\x27]1["\x27]\s*$', source):
            findings.append(f"Provider-input workflow must disable dotenv: {relative}")

    upload_marker = r'uses:\s*["\x27]?actions/upload-artifact@'
    uploads = re.findall(upload_marker, source)
    if relative != OWNER_PUBLISHER:
        if uploads:
            findings.append(f"Unreviewed artifact uploader; use the encrypted owner publisher: {relative}")
        return findings

    for key in ("M3U", "EPG"):
        binding = rf"(?m)^      EXPO_PUBLIC_{key}_URL:\s*\$\{{\{{\s*secrets\.{key}_URL\s*\}}\}}\s*$"
        if not re.search(binding, source):
            findings.append(f"Owner publisher must use only secrets.{key}_URL")
    blocks = [block for block in re.split(r"(?m)^      - ", source) if re.search(upload_marker, block)]
    if len(uploads) != 1 or len(blocks) != 1:
        findings.append("Owner publisher must have exactly one canonical encrypted upload step")
    else:
        path_block = re.search(r"(?m)^          path: \|\n((?:^            [^\n]+\n)+)", blocks[0])
        paths = [line.strip() for line in path_block.group(1).splitlines()] if path_block else []
        if paths != ENCRYPTED_UPLOAD_PATHS:
            findings.append("Owner artifact upload must contain only the encrypted envelope and metadata")
    encrypt = "node ../ci/protect-sideload-artifact.mjs encrypt ../ci/sideload-artifact-public.pem sideload-private.zip protected-artifacts/sideload.zip.enc"
    if encrypt not in source:
        findings.append("Owner publisher is missing the reviewed artifact-encryption command")
    return findings


def scan(root: Path) -> list[str]:
    findings = []
    roots = [root / "frontend" / name for name in ("src", "app", "android", "plugins", "patches")]
    for directory in roots:
        for path in directory.rglob("*"):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES or any(part in EXCLUDED for part in path.parts):
                continue
            findings.extend(source_findings(path.relative_to(root).as_posix(), path.read_text(encoding="utf-8", errors="replace")))
    for name in ("package.json", "package-lock.json", "react-native.config.js", "app.json"):
        path = root / "frontend" / name
        if path.is_file():
            findings.extend(source_findings(path.relative_to(root).as_posix(), path.read_text(encoding="utf-8")))
    manifest = json.loads((root / "ci/retired-player-automation.json").read_text(encoding="utf-8"))
    for relative in manifest["workflows"]:
        source = (root / relative).read_text(encoding="utf-8")
        findings.extend(retired_workflow_findings(relative, source))
    for relative in manifest["scripts"]:
        source = (root / relative).read_text(encoding="utf-8")
        findings.extend(retired_script_findings(relative, source))
    retired = set(manifest["workflows"])
    for path in sorted((root / ".github/workflows").glob("*")):
        if path.suffix not in {".yml", ".yaml"}:
            continue
        relative = path.relative_to(root).as_posix()
        if relative not in retired:
            findings.extend(active_workflow_findings(relative, path.read_text(encoding="utf-8")))
    return findings


if __name__ == "__main__":
    failures = scan(ROOT)
    if failures:
        print("Media3-only guard failed:\n" + "\n".join(failures))
        sys.exit(1)
    print("Media3-only source/dependency, retired-automation and owner-publisher guards passed")
