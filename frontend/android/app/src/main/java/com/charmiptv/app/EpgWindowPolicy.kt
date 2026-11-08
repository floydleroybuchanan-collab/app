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
}
