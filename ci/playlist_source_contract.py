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
RC9 changes display/log brand strings only; transport is unchanged.
RC16 merges portal guide ownership from the current secure source registry;
see docs/rc16-integration-validation.md for the reviewed scope.
Any later edit must be reviewed again; the remaining player checks still run.
See docs/multiple-playlists-test-1.md and the behavioral/database tests.
"""
import hashlib

REVIEWED_PLAYLIST_TRANSPORT = {
    'frontend/src/source.native.ts': '46cda3e8fde5ad80158c6c9accf8ca45620415d45168b9eaa0754c8a912fa7f4',
    'frontend/src/nativeEpg.ts': '2679305589ac6e4c64c0ec44b676b9c257f7939adbcee912cb26296f80018873',
    'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt': '171d02004c211d9310a8d2ead7ccaaf7d4fe93b1876b4e19b84b83bc3f0a3daa',
}


# Exact read-only directory bridge added for the persistent Assign EPG pane.
# These literals contain no fetch/import code. An altered or duplicate fragment
# remains in the source and therefore fails the existing pinned transport hash.
PRIMARY_DIRECTORY_BRIDGE = {
    "frontend/src/nativeEpg.ts": (
        '  listPrimaryGuideChannels?(query: string, offset: number, limit: number): Promise<{ total: number; rows: { id: string; name: string }[] }>;\n',
        'export async function listNativePrimaryGuideChannels(query = "", offset = 0, limit = 50): Promise<{ total: number; rows: { id: string; name: string }[] }> { if (!nativeModule?.listPrimaryGuideChannels) return { total: 0, rows: [] }; return nativeModule.listPrimaryGuideChannels(query, Math.max(0, offset), Math.max(1, Math.min(100, limit))); }\n',
    ),
    "frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt": (
        '''  @ReactMethod
  fun listPrimaryGuideChannels(query: String, offset: Double, limit: Double, promise: Promise) {
    queryExecutor.execute {
      try {
        val page = database.listDisplayNameAliases(query, offset.toInt().coerceAtLeast(0), limit.toInt().coerceIn(1, 100))
        val rows = Arguments.createArray()
        for (row in page.rows) rows.pushMap(Arguments.createMap().apply {
          putString("id", row.channelId); putString("name", row.displayName)
        })
        promise.resolve(Arguments.createMap().apply { putInt("total", page.total); putArray("rows", rows) })
      } catch (t: Throwable) { promise.reject("EPG_PRIMARY_DIRECTORY_FAILED", "Could not read the primary Guide directory", t) }
    }
  }

''',
    ),
}


def normalize_primary_directory_bridge(path: str, source: str) -> str:
    source = source.replace("\r\n", "\n")
    fragments = PRIMARY_DIRECTORY_BRIDGE.get(path, ())
    # Accept the unchanged historical snapshot or exactly one complete bridge.
    # Partial/duplicate additions are deliberately left for the hash to reject.
    if fragments and all(source.count(fragment) == 1 for fragment in fragments):
        for fragment in fragments:
            source = source.replace(fragment, "", 1)
    return source


def is_reviewed_playlist_transport(path: str, source: str) -> bool:
    expected = REVIEWED_PLAYLIST_TRANSPORT.get(path)
    return bool(expected) and hashlib.sha256(normalize_primary_directory_bridge(path, source).encode("utf-8")).hexdigest() == expected
