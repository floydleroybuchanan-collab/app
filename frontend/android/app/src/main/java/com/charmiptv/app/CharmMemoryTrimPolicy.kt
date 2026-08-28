package com.charmiptv.app

import android.content.ComponentCallbacks2

/** Running-pressure levels and background levels are separate Android ranges. */
internal fun charmMemoryTrimLevel(level: Int): CharmTrimLevel? = when {
  level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE ||
    level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> CharmTrimLevel.CRITICAL
  level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE ||
    level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
    level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE -> CharmTrimLevel.MODERATE
  level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> CharmTrimLevel.BACKGROUND
  else -> null
}
