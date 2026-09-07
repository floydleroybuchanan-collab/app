"""Exact transport snapshots for the user-authorized multi-playlist integration.

This extends the single-playlist repair gate without exempting whole files.
The source.native snapshot includes the reviewed RC.6 optional-source repair:
authenticated managed-content handoff, independent guide refresh, preserved
disable choices and explicitly empty enabled-catalog projections. HTTP/HTTPS
provider transport remains direct. See docs/rc6-source-focus-audit.md.
The follow-up reviewed scheduler/primary-parser repair is documented in
docs/rc6-build163-regression-repair.md; it does not change provider transport.
The build-166 stability follow-up adds per-stage scheduling gates, reports
match-write failures honestly, and leases native imports through metadata
publication. URLs, parsers, request headers and payload delivery are unchanged.
Regression coverage: stability166Regression.test.mjs and EpgImportCoordinatorTest.
Any later edit must be reviewed again; the remaining player checks still run.
See docs/multiple-playlists-test-1.md and the behavioral/database tests.
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': '0abc1004f35dea9ca5220cb645610120ebf9f237e85eda779cd5abec63382945',
    'frontend/src/nativeEpg.ts': 'd461decc33083a30f2f727f77eac010815f033b0ec14b1a6a3051d80b7ed7f23',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': '171d02004c211d9310a8d2ead7ccaaf7d4fe93b1876b4e19b84b83bc3f0a3daa',
}

def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(source.replace("\r\n", "\n").encode("utf-8")).hexdigest() == expected
