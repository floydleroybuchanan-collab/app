package com.charmiptv.app

import android.content.ComponentCallbacks2
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CharmMemoryStartupGraceTest {
  @Test fun firstTuneDefersRunningModeratePressureWithoutDispatching() {
    val grace = CharmMemoryStartupGrace { 0L }
    val dispatched = ArrayList<CharmTrimLevel>()
    grace.setPlaybackStarting(true)
    val level = requireNotNull(charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE))
    assertEquals(CharmTrimLevel.MODERATE, level)
    assertFalse(grace.dispatch(level) { dispatched.add(it) })
    assertTrue(dispatched.isEmpty())
  }

  @Test fun graceExpiresAtFifteenSecondsOfElapsedTime() {
    var elapsedMs = 1_000L
    val grace = CharmMemoryStartupGrace { elapsedMs }
    val dispatched = ArrayList<CharmTrimLevel>()
    grace.setPlaybackStarting(true)
    elapsedMs = 15_999L
    assertFalse(grace.dispatch(CharmTrimLevel.MODERATE) { dispatched.add(it) })
    elapsedMs = 16_000L
    assertTrue(grace.dispatch(CharmTrimLevel.MODERATE) { dispatched.add(it) })
    assertEquals(listOf(CharmTrimLevel.MODERATE), dispatched)
  }

  @Test fun criticalPressureAlwaysDispatchesDuringStartup() {
    val grace = CharmMemoryStartupGrace { 1_000L }
    val dispatched = ArrayList<CharmTrimLevel>()
    grace.setPlaybackStarting(true)
    for (androidLevel in listOf(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL, ComponentCallbacks2.TRIM_MEMORY_COMPLETE)) {
      val level = requireNotNull(charmMemoryTrimLevel(androidLevel))
      assertTrue(grace.dispatch(level) { dispatched.add(it) })
    }
    assertEquals(listOf(CharmTrimLevel.CRITICAL, CharmTrimLevel.CRITICAL), dispatched)
    assertFalse(grace.dispatch(CharmTrimLevel.MODERATE) { dispatched.add(it) })
  }

  @Test fun hiddenStateUsesTheSameGraceAndDispatchesAfterExpiry() {
    var elapsedMs = 10_000L
    val grace = CharmMemoryStartupGrace { elapsedMs }
    val dispatched = ArrayList<CharmTrimLevel>()
    val hidden = requireNotNull(charmMemoryTrimLevel(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN))
    assertEquals(CharmTrimLevel.BACKGROUND, hidden)
    grace.setPlaybackStarting(true)
    assertFalse(grace.dispatch(hidden) { dispatched.add(it) })
    assertTrue(dispatched.isEmpty())
    elapsedMs += 15_000L
    assertTrue(grace.dispatch(hidden) { dispatched.add(it) })
    assertEquals(listOf(CharmTrimLevel.BACKGROUND), dispatched)
  }

  @Test fun completedStartupRestoresOrdinaryTrimImmediately() {
    val grace = CharmMemoryStartupGrace { 1_000L }
    val dispatched = ArrayList<CharmTrimLevel>()
    assertTrue(grace.dispatch(CharmTrimLevel.MODERATE) { dispatched.add(it) })
    grace.setPlaybackStarting(true)
    assertFalse(grace.dispatch(CharmTrimLevel.MODERATE) { dispatched.add(it) })
    grace.setPlaybackStarting(false)
    assertTrue(grace.dispatch(CharmTrimLevel.MODERATE) { dispatched.add(it) })
    assertEquals(listOf(CharmTrimLevel.MODERATE, CharmTrimLevel.MODERATE), dispatched)
  }

  @Test fun newTuneRenewsGraceAgainstTheInjectedMonotonicClock() {
    var elapsedMs = 500L
    val grace = CharmMemoryStartupGrace { elapsedMs }
    grace.setPlaybackStarting(true)
    elapsedMs = 10_000L
    grace.setPlaybackStarting(true)
    elapsedMs = 15_500L
    assertFalse(grace.dispatch(CharmTrimLevel.MODERATE) { throw AssertionError("renewed startup was trimmed") })
    elapsedMs = 25_000L
    assertTrue(grace.dispatch(CharmTrimLevel.MODERATE) {})
  }
}
