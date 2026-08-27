#!/usr/bin/env python3
"""Inspect the real sideload APK using Android build tools; never installs it."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import zipfile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("--sdk", default=os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.sdk:
        parser.error("--sdk or ANDROID_HOME is required")
    tools = Path(args.sdk) / "build-tools" / "36.0.0"
    config = json.loads((Path(__file__).resolve().parents[1] / "frontend/app.json").read_text(encoding="utf-8"))["expo"]
    expected_package = config["android"]["package"] + ".sideload"
    expected_version = config["version"] + "-sideload"

    def run(name: str, *arguments: str) -> str:
        suffix = (".bat" if name == "apksigner" else ".exe") if os.name == "nt" else ""
        result = subprocess.run([str(tools / (name + suffix)), *arguments], check=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.stdout

    apk = str(args.apk.resolve())
    signature = run("apksigner", "verify", "--verbose", "--print-certs", apk)
    alignment = run("zipalign", "-c", "-P", "16", "-v", "4", apk)
    badging = run("aapt", "dump", "badging", apk)
    manifest = run("aapt", "dump", "xmltree", apk, "AndroidManifest.xml")
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    if not package or package.group(1) != expected_package or package.group(3) != expected_version:
        raise ValueError("APK package/version does not match the source sideload configuration")
    if int(package.group(2)) != config["android"]["versionCode"]:
        raise ValueError("APK versionCode does not match source")
    if "android.intent.category.LEANBACK_LAUNCHER" not in manifest or "android.permission.INTERNET" not in badging:
        raise ValueError("APK is missing TV launcher or Internet permission")
    if "application-debuggable" in badging:
        raise ValueError("Sideload must embed the production bundle without a debuggable application")

    libraries = {}
    with zipfile.ZipFile(args.apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate APK ZIP entries")
        if "assets/index.android.bundle" not in names:
            raise ValueError("Standalone JS/Hermes bundle missing")
        for abi, elf_class, machine in [("armeabi-v7a", 1, 40), ("arm64-v8a", 2, 183)]:
            required = ["libffmpegJNI.so", "libvlc.so", "libvlcjni.so", "libhermes.so", "libreactnative.so", "libc++_shared.so"]
            for name in required:
                data = archive.read(f"lib/{abi}/{name}")
                if data[:4] != b"\x7fELF" or data[4] != elf_class or struct.unpack_from("<H", data, 18)[0] != machine:
                    raise ValueError(f"Invalid ABI library: {abi}/{name}")
                if name == "libffmpegJNI.so" and b"ffmpegGetVersion" not in data:
                    raise ValueError(f"FFmpeg JNI exports missing for {abi}")
            libraries[abi] = sorted(n.rsplit("/", 1)[1] for n in names if n.startswith(f"lib/{abi}/") and n.endswith(".so"))
        dex = b"".join(archive.read(n) for n in names if re.fullmatch(r"classes\d*\.dex", n))
        classes = [
            "Landroidx/media3/exoplayer/ExoPlayer;",
            "Landroidx/media3/exoplayer/rtsp/RtspMediaSource;",
            "Landroidx/media3/decoder/ffmpeg/FfmpegAudioRenderer;",
            "Lorg/videolan/libvlc/MediaPlayer;",
        ]
        for name in classes:
            if name.encode() not in dex:
                raise ValueError(f"Required player class missing: {name}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    for label, contents in [("signature", signature), ("alignment", alignment), ("badging", badging), ("manifest", manifest)]:
        args.output.with_suffix(f".{label}.txt").write_text(contents, encoding="utf-8")
    with args.apk.open("rb") as handle:
        checksum = hashlib.file_digest(handle, "sha256").hexdigest()
    report = {
        "apk": args.apk.name, "bytes": args.apk.stat().st_size, "sha256": checksum,
        "package": package.group(1), "versionCode": int(package.group(2)), "versionName": package.group(3),
        "signatureVerified": True, "zipAlignment16KiBVerified": True,
        "requiredClasses": classes, "nativeLibraries": libraries,
        "deviceInstallTested": False, "providerPlaybackTested": False,
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
