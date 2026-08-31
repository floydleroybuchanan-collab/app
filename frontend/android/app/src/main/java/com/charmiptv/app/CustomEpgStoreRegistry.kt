package com.charmiptv.app

import android.content.Context
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** Process-local handles for independently transactional custom XMLTV stores. */
internal object CustomEpgStoreRegistry {
  // Stable last-good migration name: charm_epg_user_v1.db
  private const val LEGACY_SOURCE_ID = "user"
  private val stores = ConcurrentHashMap<String, EpgDatabase>()

  fun normalizeSourceId(raw: String): String {
    val value = raw.trim().lowercase()
    if (value == LEGACY_SOURCE_ID) return LEGACY_SOURCE_ID
    val clean = value.removePrefix("user:").replace(Regex("[^a-z0-9_-]"), "").take(48)
    require(clean.isNotEmpty()) { "Custom EPG source id is empty" }
    return "user:$clean"
  }

  private fun hashedDatabaseName(sourceId: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(sourceId.toByteArray())
      .take(12).joinToString("") { "%02x".format(it) }
    return "charm_epg_user_${digest}.db"
  }

  internal fun databaseFileName(rawSourceId: String, exists: (String) -> Boolean): String {
    val sourceId = normalizeSourceId(rawSourceId)
    if (sourceId == LEGACY_SOURCE_ID) return "charm_epg_user_v1.db"
    // Older refresh/query paths normalized twice, while the channel picker only
    // normalized once. Prefer that existing programme DB without moving SQLite
    // files or their WAL; every new caller now resolves the same stable handle.
    val legacyName = hashedDatabaseName("user:" + sourceId.replace(":", ""))
    return if (exists(legacyName)) legacyName else hashedDatabaseName(sourceId)
  }

  fun database(context: Context, rawSourceId: String): EpgDatabase {
    val sourceId = normalizeSourceId(rawSourceId)
    return stores.getOrPut(sourceId) {
      val name = databaseFileName(sourceId) { context.getDatabasePath(it).exists() }
      EpgDatabase(context.applicationContext, name)
    }
  }

  fun closeAll() {
    stores.values.forEach { try { it.close() } catch (_: Throwable) {} }
    stores.clear()
  }
}
