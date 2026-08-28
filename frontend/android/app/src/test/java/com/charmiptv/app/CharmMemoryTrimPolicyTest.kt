package com.charmiptv.app

import android.content.ComponentCallbacks2
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CharmMemoryTrimPolicyTest {
  @Test fun hidingTheUiIsNotRunningLowMemory() {
    assertEquals(CharmTrimLevel.BACKGROUND, charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN))
    assertEquals(CharmTrimLevel.BACKGROUND, charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_BACKGROUND))
  }

  @Test fun runningPressureLevelsDoNotUseBackgroundRangeOrdering() {
    assertEquals(CharmTrimLevel.MODERATE, charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE))
    assertEquals(CharmTrimLevel.MODERATE, charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW))
    assertEquals(CharmTrimLevel.CRITICAL, charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL))
  }

  @Test fun backgroundSeverityStillEscalatesToComplete() {
    assertEquals(CharmTrimLevel.MODERATE, charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_MODERATE))
    assertEquals(CharmTrimLevel.CRITICAL, charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_COMPLETE))
    assertEquals(CharmTrimLevel.CRITICAL, charmMemoryTrimLevel(100))
    assertNull(charmMemoryTrimLevel(0))
  }
}
