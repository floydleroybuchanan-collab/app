"""Build-level compatibility contracts; does not replace device testing."""
from pathlib import Path
import importlib.util
import struct
import io
import zipfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("apk", ROOT / "ci/verify-android-apk.py")
apk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apk)


class AndroidCompatibilityTests(unittest.TestCase):
    def test_owner_signing_identity_is_required(self):
        apk.verify_owner_certificate("Signer #1 certificate SHA-256 digest: " + apk.OWNER_CERTIFICATE_SHA256)
        for signature in ["", "Signer #1 certificate SHA-256 digest: " + "a" * 64,
                          "Signer #1 certificate SHA-256 digest: " + apk.OWNER_CERTIFICATE_SHA256 + "\nSigner #2 certificate SHA-256 digest: " + "b" * 64]:
            with self.assertRaises(ValueError): apk.verify_owner_certificate(signature)

    def test_release_rejects_private_material_and_debug_metadata(self):
        for name, body in [("assets/key.pem", b"-----BEGIN PRIVATE KEY-----"),
                           ("assets/upload.jks", b"binary"), ("assets/.env.production", b"secret"),
                           ("assets/index.android.bundle.map", b"{}"),
                           ("assets/index.android.bundle", b"x" * (1024 * 1024 - 10) + b"-----BEGIN RSA PRIVATE KEY-----")]:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive: archive.writestr(name, body)
            buffer.seek(0)
            with zipfile.ZipFile(buffer) as archive:
                with self.assertRaises(ValueError): apk.verify_sensitive_payloads(archive)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("assets/public.pem", b"-----BEGIN PUBLIC KEY-----")
            archive.writestr("assets/index.android.bundle", b"normal bundle")
        buffer.seek(0)
        with zipfile.ZipFile(buffer) as archive: apk.verify_sensitive_payloads(archive)

    def test_ndk_api_notes_are_read_for_both_elf_architectures(self):
        for wide in (True, False):
            for api in (21, 24, 26):
                data = bytearray(160)
                data[:6] = b"\x7fELF" + bytes([2 if wide else 1, 1])
                struct.pack_into("<Q" if wide else "<I", data, 40 if wide else 32, 64)
                struct.pack_into("<HH", data, 58 if wide else 46, 64 if wide else 40, 1)
                struct.pack_into("<I", data, 68, 7)
                struct.pack_into("<QQ" if wide else "<II", data, 64 + (24 if wide else 16), 128, 24)
                struct.pack_into("<III", data, 128, 8, 4, 1)
                data[140:148] = b"Android\0"
                struct.pack_into("<I", data, 148, api)
                self.assertEqual(apk.android_api_notes(bytes(data)), [api])
        self.assertEqual(apk.android_api_notes(b""), [])

    def test_native_audio_uses_host_api_and_invalidates_old_cache(self):
        source = (ROOT / "frontend/scripts/build-media3-ffmpeg-audio.sh").read_text()
        self.assertIn("android.minSdkVersion=", source)
        self.assertIn('ANDROID_API="${CHARM_FFMPEG_ANDROID_API:-$APP_MIN_SDK}"', source)
        self.assertIn("ANDROID_API > APP_MIN_SDK", source)
        self.assertRegex(source, r'BUILD_KEY="\$FFMPEG_COMMIT\|\$ANDROID_API\|')

    def test_ci_checks_api_before_packaging_and_verifies_actual_apk(self):
        workflow = (ROOT / ".github/workflows/build-media3-sideload-now.yml").read_text()
        self.assertLess(workflow.index(":app:lintSideload"), workflow.index(":app:assembleSideload"))
        self.assertIn(":vod:lintSideload", workflow)
        verifier = (ROOT / "ci/verify-android-apk.py").read_text()
        self.assertIn('int(minimum.group(1)) != 24', verifier)
        self.assertIn('int(target.group(1)) < 36', verifier)

    def test_both_tv_architectures_remain_packaged(self):
        workflow = (ROOT / ".github/workflows/build-media3-sideload-now.yml").read_text()
        self.assertIn("reactNativeArchitectures=armeabi-v7a,arm64-v8a", workflow)
        self.assertNotRegex(workflow, r"reactNativeArchitectures=arm64-v8a\s")


if __name__ == "__main__":
    unittest.main()
