"""Regression tests for release gates; fixtures are not real installable APKs."""
import importlib.util
import io
from pathlib import Path
import struct
import unittest
import zipfile
from media3_source_contract import REFRESH_IMPORT, REFRESH_BEFORE, REFRESH_AFTER, normalize_audited_playback_refresh


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard = load_module("verify-media3-only")
apk = load_module("verify-android-apk")


def apk_fixture(extra=None, omit=None):
    entries = {"assets/index.android.bundle": b"Media3 Hermes fixture"}
    entries["classes.dex"] = b"\n".join([
        b"Landroidx/media3/exoplayer/ExoPlayer;",
        b"Landroidx/media3/exoplayer/rtsp/RtspMediaSource;",
        b"Landroidx/media3/decoder/ffmpeg/FfmpegAudioRenderer;",
    ])
    for abi, elf_class, machine in [("armeabi-v7a", 1, 40), ("arm64-v8a", 2, 183)]:
        for name in ["libffmpegJNI.so", "libhermes.so", "libreactnative.so", "libc++_shared.so"]:
            header = bytearray(64)
            header[:4] = b"\x7fELF"
            header[4] = elf_class
            struct.pack_into("<H", header, 18, machine)
            entries[f"lib/{abi}/{name}"] = bytes(header) + b"ffmpegGetVersion"
    entries.update(extra or {})
    if omit:
        entries.pop(omit)
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        for name, contents in entries.items():
            archive.writestr(name, contents)
    data.seek(0)
    return zipfile.ZipFile(data)


class PlaybackRefreshContractTests(unittest.TestCase):
    def test_only_the_reviewed_helper_is_normalized(self):
        self.assertEqual(REFRESH_BEFORE, normalize_audited_playback_refresh(REFRESH_IMPORT + REFRESH_AFTER))

    def test_an_altered_source_or_new_timer_is_not_hidden(self):
        for mutation in [
            REFRESH_AFTER.replace("sourceUrl(SOURCE_M3U)", '"https://different.invalid"'),
            REFRESH_AFTER.replace("  return parsed.channels;", "  setTimeout(stopPlayback, 1000);\n  return parsed.channels;"),
        ]:
            self.assertNotEqual(REFRESH_BEFORE, normalize_audited_playback_refresh(REFRESH_IMPORT + mutation))
            self.assertIn("createPlaybackSourceRefresher<Channel>", normalize_audited_playback_refresh(mutation))

    def test_unrelated_transport_changes_remain_visible(self):
        suffix = "\nconst providerOverride = 'changed';"
        self.assertEqual(REFRESH_BEFORE + suffix, normalize_audited_playback_refresh(REFRESH_IMPORT + REFRESH_AFTER + suffix))


class Media3SourceGuardTests(unittest.TestCase):
    def test_playlist_directive_is_not_a_player_dependency(self):
        self.assertEqual([], guard.source_findings("parser.ts", '#EXTVLCOPT:http-user-agent=ProviderBox'))

    def test_legacy_preference_migration_is_allowed(self):
        self.assertEqual([], guard.source_findings("preference.ts", 'if (stored === "vlc") return "media3";'))

    def test_native_import_and_dependency_are_rejected(self):
        for source in ["import org.videolan.libvlc.LibVLC", 'implementation("org.videolan.android:libvlc-all:3.7.5")']:
            self.assertTrue(guard.source_findings("build.gradle", source))

    def test_routing_and_empty_bridge_files_are_rejected(self):
        self.assertTrue(guard.source_findings("policy.ts", 'return "vlc";'))
        self.assertTrue(guard.source_findings("NativeVlcPlaybackManager.kt", ""))

    def test_disabled_workflow_requires_all_jobs_to_be_disabled(self):
        source = "name: test\njobs:\n  repair:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n  build:\n    runs-on: ubuntu-latest\n"
        self.assertEqual(1, len(guard.retired_workflow_findings("old.yml", source)))
        self.assertEqual([], guard.retired_workflow_findings("old.yml", source.split("  build:")[0]))

    def test_disabled_step_is_not_a_disabled_job(self):
        source = "jobs:\n  repair:\n    runs-on: ubuntu-latest\n    steps:\n      - if: ${{ false }}\n        run: echo old\n"
        self.assertTrue(guard.retired_workflow_findings("old.yml", source))

    def test_script_guard_must_precede_any_other_executable_code(self):
        stop = 'raise SystemExit("Retired player repair: Media3-only playback supersedes it")\n'
        self.assertEqual([], guard.retired_script_findings("old.py", '"""history"""\nfrom __future__ import annotations\n' + stop))
        self.assertTrue(guard.retired_script_findings("old.py", "print('mutation')\n" + stop))


class Media3ApkGuardTests(unittest.TestCase):
    def test_only_media3_and_ffmpeg_pass(self):
        with apk_fixture() as archive:
            libraries, classes = apk.verify_archive(archive)
        self.assertEqual(2, len(libraries))
        self.assertEqual(3, len(classes))

    def test_vlc_library_in_any_abi_is_rejected(self):
        for name in ["lib/arm64-v8a/libvlc.so", "lib/x86/libvlcjni.so", "assets/libVLC.so"]:
            with self.subTest(name=name), apk_fixture({name: b"removed"}) as archive:
                with self.assertRaisesRegex(ValueError, "VLC"):
                    apk.verify_archive(archive)

    def test_vlc_dex_classes_are_rejected(self):
        for marker in [b"Lorg/videolan/libvlc/MediaPlayer;", b"Lcom/charmiptv/app/NativeVlcPlaybackModule;"]:
            with self.subTest(marker=marker), apk_fixture({"classes2.dex": marker}) as archive:
                with self.assertRaisesRegex(ValueError, "VLC"):
                    apk.verify_archive(archive)

    def test_vlc_js_bridge_is_rejected(self):
        with apk_fixture({"assets/index.android.bundle": b"NativeVlcPlayback"}) as archive:
            with self.assertRaisesRegex(ValueError, "VLC"):
                apk.verify_archive(archive)

    def test_required_ffmpeg_and_media3_are_not_weakened(self):
        with apk_fixture(omit="lib/arm64-v8a/libffmpegJNI.so") as archive:
            with self.assertRaises(KeyError):
                apk.verify_archive(archive)
        with apk_fixture({"classes.dex": b""}) as archive:
            with self.assertRaisesRegex(ValueError, "Required player class"):
                apk.verify_archive(archive)

    def test_invalid_elf_is_rejected(self):
        with apk_fixture({"lib/arm64-v8a/libhermes.so": b"bad"}) as archive:
            with self.assertRaisesRegex(ValueError, "Invalid ABI library"):
                apk.verify_archive(archive)


class OwnerWorkflowGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.publisher = (guard.ROOT / guard.OWNER_PUBLISHER).read_text(encoding="utf-8")

    def test_current_encrypted_publisher_passes(self):
        self.assertEqual([], guard.active_workflow_findings(guard.OWNER_PUBLISHER, self.publisher))

    def test_an_alternate_artifact_uploader_is_rejected(self):
        self.assertTrue(guard.active_workflow_findings("old-build.yml", self.publisher))

    def test_plaintext_or_wildcard_upload_paths_are_rejected(self):
        for replacement in ["frontend/artifacts/*.apk", "frontend/protected-artifacts/*", "frontend"]:
            source = self.publisher.replace(guard.ENCRYPTED_UPLOAD_PATHS[0] + "\n", replacement + "\n")
            with self.subTest(path=replacement):
                self.assertTrue(guard.active_workflow_findings(guard.OWNER_PUBLISHER, source))

    def test_old_provider_fallback_and_dotenv_are_rejected(self):
        for source in [
            self.publisher.replace(
                '      EXPO_NO_DOTENV: "1"',
                '      EXPO_PUBLIC_M3U_URL: ${{ secrets.M3U_URL }}\n      EXPO_NO_DOTENV: "1"',
            ),
            self.publisher.replace('EXPO_NO_DOTENV: "1"', 'EXPO_NO_DOTENV: "0"'),
            self.publisher.replace(
                '      EXPO_NO_DOTENV: "1"',
                '      EXPO_PUBLIC_EPG_URL: ${{ secrets.EPG_URL }}\n      EXPO_NO_DOTENV: "1"',
            ),
        ]:
            self.assertTrue(guard.active_workflow_findings(guard.OWNER_PUBLISHER, source))

    def test_missing_owner_signing_or_managed_content_gate_is_rejected(self):
        for marker in [
            "CHARM_KEYSTORE_B64: ${{ secrets.CHARM_KEYSTORE_B64 }}",
            'test -z "${EXPO_PUBLIC_M3U_URL:-}"',
            "grep -q '/content/access' src/auth/accountApi.ts",
            "charm.requireProtectedSigning=true",
        ]:
            source = self.publisher.replace(marker, "removed-reviewed-gate")
            with self.subTest(marker=marker):
                self.assertTrue(guard.active_workflow_findings(guard.OWNER_PUBLISHER, source))

    def test_missing_encryption_or_duplicate_uploader_is_rejected(self):
        for source in [
            self.publisher.replace("protect-sideload-artifact.mjs encrypt", "protect-sideload-artifact.mjs decrypt"),
            self.publisher + "\n      - uses: actions/upload-artifact@unreviewed\n",
        ]:
            self.assertTrue(guard.active_workflow_findings(guard.OWNER_PUBLISHER, source))


if __name__ == "__main__":
    unittest.main()
