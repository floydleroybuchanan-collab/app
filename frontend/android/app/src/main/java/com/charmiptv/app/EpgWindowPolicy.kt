package com.charmiptv.app

import android.content.Context

/** Shared rules for interactive, custom and WorkManager EPG imports. */
internal object EpgWindowPolicy {
  // Future data is limited to the maximum supported TV Guide runway, not the
  // freshness/age of the downloaded XMLTV file or retention of past programs.
  const val FUTURE_MS = 24L * 60L * 60L * 1000L
  const val DEFAULT_PAST_DAYS = 7L
  const val MAX_COMPRESSED_BYTES = 256L * 1024L * 1024L
  const val MAX_DECOMPRESSED_BYTES = 1024L * 1024L * 1024L
  const val MAX_IMPORT_DURATION_MS = 5L * 60L * 1000L

  private const val PRIMARY_PREFS = "charm_epg_primary_retention"
  private const val CUSTOM_PREFS = "charm_epg_custom_policy"
  private const val PAST_DAYS_KEY = "past_days"

  fun pastDays(context: Context, sourceId: String): Int {
    val prefs = context.getSharedPreferences(
      if (sourceId == "default") PRIMARY_PREFS else CUSTOM_PREFS,
      Context.MODE_PRIVATE,
    )
    return prefs.getInt(PAST_DAYS_KEY, DEFAULT_PAST_DAYS.toInt()).coerceIn(1, 14)
  }

  fun setPrimaryPastDays(context: Context, days: Int) {
    context.getSharedPreferences(PRIMARY_PREFS, Context.MODE_PRIVATE)
      .edit().putInt(PAST_DAYS_KEY, days.coerceIn(1, 14)).apply()
  }
}
