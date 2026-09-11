"""Materialize verified Nova playback binaries; never download code at app runtime."""
from pathlib import Path
import argparse
import hashlib
import urllib.request
import zipfile

TAG = "v6.4.63"
NAME = "org.courville.nova-2669509-6.4.63-20260909.2142-universal-release.apk"
SHA256 = "3c70d4bf5cf86ab84f720899aaed3f5757b5ed4f73fcba7c05499f301f6a7a11"
ABIS = ("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
LIBS = ("audiocompress", "avcodec", "avfilter", "avformat", "avos", "avos_android", "avosjni",
        "avutil", "cputest", "dav1d", "deinterlace", "mysofa", "nvpnativehelper", "opus",
        "sfdec.core.21", "sfdec", "swresample", "swscale")

def prepare(apk: Path, destination: Path):
    if hashlib.sha256(apk.read_bytes()).hexdigest() != SHA256:
        raise ValueError("Nova release checksum mismatch; refusing to package binaries")
    with zipfile.ZipFile(apk) as archive:
        for abi in ABIS:
            for lib in LIBS:
                relative = Path(abi) / ("lib" + lib + ".so")
                data = archive.read("lib/" + relative.as_posix())
                if not data.startswith(b"\x7fELF"):
                    raise ValueError("Invalid native binary")
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    print("Verified Nova", TAG, ":", len(LIBS), "playback libraries for", len(ABIS), "ABIs")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", type=Path)
    args = parser.parse_args()
    frontend = Path(__file__).resolve().parents[1]
    apk = args.apk or frontend / ".native-downloads" / NAME
    if not apk.exists():
        apk.parent.mkdir(parents=True, exist_ok=True)
        url = "https://github.com/nova-video-player/aos-AVP/releases/download/" + TAG + "/" + NAME
        with urllib.request.urlopen(url, timeout=120) as response, apk.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    prepare(apk, frontend / "android/vod/app/src/main/jniLibs")
