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


def android_api_notes(data: bytes) -> list[int]:
    """Read NDK minimum-API notes from ELF SHT_NOTE sections, if present."""
    if len(data) < 64 or data[:4] != b"\x7fELF" or data[5] != 1:
        return []
    wide = data[4] == 2
    table = struct.unpack_from("<Q" if wide else "<I", data, 40 if wide else 32)[0]
    stride, count = struct.unpack_from("<HH", data, 58 if wide else 46)
    levels = []
    if stride < (64 if wide else 40) or table + stride * count > len(data):
        return levels
    for index in range(count):
        section = table + index * stride
        if struct.unpack_from("<I", data, section + 4)[0] != 7:
            continue
        offset, size = struct.unpack_from("<QQ" if wide else "<II", data, section + (24 if wide else 16))
        end = offset + size
        if end > len(data):
            raise ValueError("Malformed native ELF note section")
        while offset + 12 <= end:
            namesize, descsize, kind = struct.unpack_from("<III", data, offset)
            name = offset + 12
            desc = name + ((namesize + 3) & ~3)
            after = desc + ((descsize + 3) & ~3)
            if after > end:
                raise ValueError("Malformed native ELF note")
            if kind == 1 and data[name:name + namesize].rstrip(b"\0") == b"Android" and descsize >= 4:
                levels.append(struct.unpack_from("<I", data, desc)[0])
            offset = after
    return levels


def verify_archive(archive: zipfile.ZipFile) -> tuple[dict[str, list[str]], list[str]]:
    """Validate packaged engines, including every ABI, without executing the APK."""
    names = archive.namelist()
    if len(names) != len(set(names)):
        raise ValueError("Duplicate APK ZIP entries")
    if "assets/index.android.bundle" not in names:
        raise ValueError("Standalone JS/Hermes bundle missing")
    forbidden = [name for name in names if re.search(r"(?:libvlc|videolan|nativevlc)", name, re.I)]
    if forbidden:
        raise ValueError(f"Removed VLC engine is packaged: {', '.join(forbidden)}")
    libraries = {}
    for abi, elf_class, machine in [("armeabi-v7a", 1, 40), ("arm64-v8a", 2, 183)]:
        required = ["libffmpegJNI.so", "libhermes.so", "libreactnative.so", "libc++_shared.so"]
        for name in required:
            data = archive.read(f"lib/{abi}/{name}")
            if len(data) < 20 or data[:4] != b"\x7fELF" or data[4] != elf_class or struct.unpack_from("<H", data, 18)[0] != machine:
                raise ValueError(f"Invalid ABI library: {abi}/{name}")
            if name == "libffmpegJNI.so" and b"ffmpegGetVersion" not in data:
                raise ValueError(f"FFmpeg JNI exports missing for {abi}")
        libraries[abi] = sorted(n.rsplit("/", 1)[1] for n in names if n.startswith(f"lib/{abi}/") and n.endswith(".so"))
        for name in libraries[abi]:
            levels = android_api_notes(archive.read(f"lib/{abi}/{name}"))
            if any(level > 24 for level in levels):
                raise ValueError(f"Native library requires newer than Android 7: {abi}/{name}: {levels}")
    dex = b"".join(archive.read(n) for n in names if re.fullmatch(r"classes\d*\.dex", n))
    for marker in (b"Lorg/videolan/", b"Lcom/charmiptv/app/NativeVlc", b"RCTVLCPlayer"):
        if marker in dex:
            raise ValueError("Removed VLC Java/native bridge is packaged in DEX")
    bundle = archive.read("assets/index.android.bundle")
    if any(marker in bundle for marker in (b"NativeVlcPlayback", b"RCTVLCPlayer", b"react-native-vlc-media-player")):
        raise ValueError("Removed VLC bridge remains in the JS/Hermes bundle")
    classes = [
        "Landroidx/media3/exoplayer/ExoPlayer;",
        "Landroidx/media3/exoplayer/rtsp/RtspMediaSource;",
        "Landroidx/media3/decoder/ffmpeg/FfmpegAudioRenderer;",
    ]
    for name in classes:
        if name.encode() not in dex:
            raise ValueError(f"Required player class missing: {name}")
    return libraries, classes


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
    minimum = re.search(r"^sdkVersion:'(\d+)'", badging, re.M)
    target = re.search(r"^targetSdkVersion:'(\d+)'", badging, re.M)
    if not minimum or int(minimum.group(1)) != 24:
        raise ValueError("Final merged APK must support Android 7 (minSdk 24)")
    if not target or int(target.group(1)) < 36 or "maxSdkVersion" in manifest:
        raise ValueError("APK must target modern Android without a maximum OS restriction")
    for feature in ("touchscreen", "camera", "camera.autofocus", "microphone"):
        if f"uses-feature: name='android.hardware.{feature}'" in badging:
            raise ValueError(f"TV-incompatible required hardware: {feature}")

    with zipfile.ZipFile(args.apk) as archive:
        libraries, classes = verify_archive(archive)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    for label, contents in [("signature", signature), ("alignment", alignment), ("badging", badging), ("manifest", manifest)]:
        args.output.with_suffix(f".{label}.txt").write_text(contents, encoding="utf-8")
    with args.apk.open("rb") as handle:
        checksum = hashlib.file_digest(handle, "sha256").hexdigest()
    report = {
        "apk": args.apk.name, "bytes": args.apk.stat().st_size, "sha256": checksum,
        "package": package.group(1), "versionCode": int(package.group(2)), "versionName": package.group(3),
        "signatureVerified": True, "zipAlignment16KiBVerified": True,
        "minSdk": int(minimum.group(1)), "targetSdk": int(target.group(1)),
        "nativeAndroidApiNotesChecked": True,
        "playbackEngine": "Media3", "vlcAbsent": True,
        "requiredClasses": classes, "nativeLibraries": libraries,
        "deviceInstallTested": False, "providerPlaybackTested": False,
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
