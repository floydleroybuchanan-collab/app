package com.streamflixreborn.streamflix.charm

import android.content.Context
import java.security.MessageDigest

/**
 * Isolates the native Room movie/favorites/history store per authenticated
 * Charming MediaLab account. Provider isolation alone is not enough.
 *
 * Existing providerName.db files remain owned by the first authenticated
 * account on the device. Later accounts use separate scoped filenames.
 * No account IDs, session tokens or provider passwords are stored in DB names.
 */
object CharmVodAccountScope {
    private const val PREFS = "charm_vod_history_legacy_owner_v1"
    @Volatile private var dbPrefix = "not_signed_in"

    private fun digest(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    @Synchronized
    fun activate(context: Context, accountId: String?) {
        val valid = accountId?.takeIf { it.length in 1..128 && it.all { ch ->
            ch.isLetterOrDigit() || ch == '-' || ch == '_'
        } }
        if (valid == null) {
            dbPrefix = "not_signed_in"
            return
        }
        val accountHash = digest(valid)
        val settings = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var originalOwner = settings.getString("legacy_owner_hash", null)
        if (originalOwner == null) {
            // Synchronous commit: the separate :vod content-provider process
            // must not race a pending preference write during first migration.
            if (!settings.edit().putString("legacy_owner_hash", accountHash).commit())
                throw IllegalStateException("Could not bind the existing VOD library to this account")
            originalOwner = accountHash
        }
        dbPrefix = if (originalOwner == accountHash) "" else "acct_" + accountHash.take(24) + "_"
    }

    /** Stable for the lifetime of each Room wrapper; no directory traversal. */
    fun databaseFileName(sanitizedProvider: String): String = dbPrefix + sanitizedProvider + ".db"
}
