package com.charmiptv.app

import android.content.Context

/** Shared fourth-layer time correction applied after source and playlist offsets. */
internal object GuideTimingPolicy {
  private const val PREFS = "charm_guide_timing"
  private const val GLOBAL_OFFSET = "global_offset_minutes"

  fun globalOffsetMinutes(context: Context): Int = context
    .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    .getInt(GLOBAL_OFFSET, 0)
    .coerceIn(-1440, 1440)

  fun setGlobalOffsetMinutes(context: Context, value: Int) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putInt(GLOBAL_OFFSET, value.coerceIn(-1440, 1440))
      .apply()
  }
}
