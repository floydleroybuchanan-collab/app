#!/usr/bin/env python3
"""Regression tests for the sideload-update identity guard."""
import copy
import importlib.util
from pathlib import Path
import unittest


path = Path(__file__).with_name("verify-release-update.py")
spec = importlib.util.spec_from_file_location("release_update_contract", path)
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


class ReleaseUpdateContractTests(unittest.TestCase):
    def setUp(self):
        self.pem = b"-----BEGIN PUBLIC KEY-----\nfixture-only\n-----END PUBLIC KEY-----\n"
        self.package = "com.example.media.sideload"
        self.config = {"expo": {"version": "2.2.1-rc.25", "android": {
            "package": "com.example.media", "versionCode": 2500,
        }}}
        self.baseline = {
            "lastConfirmedInstallableRelease": {
                "githubBuildNumber": 267, "versionCode": 2400,
                "versionName": "2.2.0-rc.24-sideload", "packageId": self.package,
            },
            "ownerEncryptionPublicKeyGitBlobSha1": contract._git_blob_sha1(self.pem),
        }
        self.app = """
        applicationId 'com.example.media'
        versionCode 2500
        versionName "2.2.1-rc.25"
        applicationIdSuffix '.sideload'
        versionNameSuffix '-sideload'
        """
        self.vod = """
        buildConfigField 'int', 'VERSION_CODE', '2500'
        buildConfigField 'String', 'VERSION_NAME', '"2.2.1-rc.25"'
        buildConfigField 'String', 'APPLICATION_ID', '"com.example.media.sideload"'
        """

    def verify(self):
        return contract.validate_release(self.config, self.baseline, self.app, self.vod, self.pem)

    def test_valid_owner_update(self):
        self.assertEqual(self.verify()["versionCode"], 2500)

    def test_downgrade_is_rejected(self):
        self.config["expo"]["android"]["versionCode"] = 18
        with self.assertRaisesRegex(ValueError, "must exceed installed Build"):
            self.verify()

    def test_old_rc_name_is_rejected(self):
        self.config["expo"]["version"] = "2.1.0-rc.10.1"
        with self.assertRaisesRegex(ValueError, "version name must"):
            self.verify()

    def test_installation_package_cannot_change(self):
        self.config["expo"]["android"]["package"] = "com.example.another"
        with self.assertRaisesRegex(ValueError, "package ID"):
            self.verify()

    def test_wrong_encryption_public_key_is_rejected(self):
        self.pem = b"-----BEGIN PUBLIC KEY-----\nwrong-owner\n-----END PUBLIC KEY-----\n"
        with self.assertRaisesRegex(ValueError, "owner encryption public key changed"):
            self.verify()

    def test_host_gradle_disagreement_is_rejected(self):
        self.app = self.app.replace("versionCode 2500", "versionCode 18")
        with self.assertRaisesRegex(ValueError, "host Gradle versionCode"):
            self.verify()

    def test_vod_metadata_disagreement_is_rejected(self):
        self.vod = self.vod.replace("'VERSION_CODE', '2500'", "'VERSION_CODE', '18'")
        with self.assertRaisesRegex(ValueError, "embedded VOD version code"):
            self.verify()

    def test_separate_package_suffix_is_rejected(self):
        self.app = self.app.replace("applicationIdSuffix '.sideload'", "applicationIdSuffix '.testing'")
        with self.assertRaisesRegex(ValueError, "sideload suffix missing"):
            self.verify()

    def test_rc_number_must_match_code_family(self):
        self.config["expo"]["android"]["versionCode"] = 2401
        self.app = self.app.replace("versionCode 2500", "versionCode 2401")
        with self.assertRaisesRegex(ValueError, "RC25 requires versionCode"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
