#!/usr/bin/env python3
"""Fail closed if a sideload build cannot update the last confirmed owner release.

This checks source identity and the PUBLIC RSA encryption key. Android APK
signing uses GitHub's separate CHARM_UPLOAD_* private keystore secrets.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError("Release update contract violated: " + message)


def _version_tuple(version: str) -> tuple[int, int, int, int]:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)-rc\.(\d+)(?:-sideload)?", version, flags=re.I)
    _require(match is not None, f"version name must be X.Y.Z-rc.N: {version}")
    return tuple(int(value) for value in match.groups())


def _git_blob_sha1(payload: bytes) -> str:
    # GitHub publishes this object's hash in its Contents API. Pin the exact
    # owner-provided PUBLIC key, not any independently-generated RSA key.
    return hashlib.sha1(b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload).hexdigest()


def validate_release(config: dict, baseline: dict, app_gradle: str, vod_gradle: str, pem: bytes) -> dict:
    previous = baseline["lastConfirmedInstallableRelease"]
    expo = config["expo"]
    android = expo["android"]
    code = android["versionCode"]
    version = expo["version"]
    expected_id = previous["packageId"]
    _require(isinstance(code, int) and not isinstance(code, bool), "Android versionCode must be an integer")
    _require(android["package"] + ".sideload" == expected_id,
             f"package ID must remain {expected_id} to preserve app data")
    _require(code > previous["versionCode"],
             f"versionCode {code} must exceed installed Build "
             f"{previous['githubBuildNumber']} versionCode {previous['versionCode']}")
    version_tuple = _version_tuple(version)
    previous_version = _version_tuple(previous["versionName"])
    _require(version_tuple > previous_version,
             f"versionName {version} must advance past {previous['versionName']}")
    rc = version_tuple[3]
    _require(rc * 100 <= code < (rc + 1) * 100,
             f"RC{rc} requires versionCode in the range {rc*100}–{rc*100+99}; got {code}")
    base_id = re.escape(android["package"])
    _require(re.search(r"(?m)^\s*applicationId\s+'" + base_id + r"'\s*$", app_gradle) is not None,
             "host Gradle applicationId disagrees with app.json")
    _require(re.search(r"(?m)^\s*versionCode\s+" + str(code) + r"\s*$", app_gradle) is not None,
             "host Gradle versionCode disagrees with app.json")
    _require(re.search(r'(?m)^\s*versionName\s+"' + re.escape(version) + r'"\s*$', app_gradle) is not None,
             "host Gradle versionName disagrees with app.json")
    _require(re.search(r"(?m)^\s*applicationIdSuffix\s+'\.sideload'\s*$", app_gradle) is not None,
             "sideload suffix missing: must update Build 267 instead of installing a second app")
    _require(re.search(r"(?m)^\s*versionNameSuffix\s+'-sideload'\s*$", app_gradle) is not None,
             "sideload versionName suffix missing")
    _require(f"buildConfigField 'int', 'VERSION_CODE', '{code}'" in vod_gradle,
             "embedded VOD version code disagrees with host")
    _require(f"""buildConfigField 'String', 'VERSION_NAME', '"{version}"'""" in vod_gradle,
             "embedded VOD version name disagrees with host")
    _require(f"""buildConfigField 'String', 'APPLICATION_ID', '"{expected_id}"'""" in vod_gradle,
             "embedded VOD sideload application ID disagrees with host")
    _require(pem.startswith(b"-----BEGIN PUBLIC KEY-----\n") and
             pem.rstrip().endswith(b"-----END PUBLIC KEY-----"), "owner encryption PEM must be a public key")
    _require(_git_blob_sha1(pem) == baseline["ownerEncryptionPublicKeyGitBlobSha1"],
             "owner encryption public key changed; this APK would be unreadable by the owner's private key")
    return {
        "upgradesGithubBuild": previous["githubBuildNumber"],
        "previousVersionCode": previous["versionCode"],
        "versionCode": code,
        "versionName": version + "-sideload",
        "packageId": expected_id,
        "ownerEncryptionKeyMatches": True,
    }


def main() -> None:
    config = json.loads((ROOT / "frontend/app.json").read_text(encoding="utf-8"))
    baseline = json.loads((ROOT / "ci/release-update-baseline.json").read_text(encoding="utf-8"))
    app_gradle = (ROOT / "frontend/android/app/build.gradle").read_text(encoding="utf-8")
    vod_gradle = (ROOT / "frontend/android/vod/app/build.gradle").read_text(encoding="utf-8")
    pem = (ROOT / "ci/sideload-artifact-public.pem").read_bytes()
    result = validate_release(config, baseline, app_gradle, vod_gradle, pem)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
