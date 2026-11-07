package com.charmiptv.app

internal enum class CharmTrimLevel { BACKGROUND, MODERATE, CRITICAL }

/** Android's running-pressure values and UI-hidden values are separate ranges. */
internal fun charmTrimLevelForAndroid(level: Int): CharmTrimLevel? = when {
  level >= 80 -> CharmTrimLevel.CRITICAL
  level >= 40 -> CharmTrimLevel.MODERATE
  level >= 20 -> CharmTrimLevel.BACKGROUND
  level >= 15 -> CharmTrimLevel.CRITICAL
  level >= 10 -> CharmTrimLevel.MODERATE
  else -> null
}
