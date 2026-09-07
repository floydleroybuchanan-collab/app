package com.charmiptv.app

import org.junit.Assert.*
import org.junit.Test

class PlaybackHealthHistoryTest {
  @Test fun historyStaysBoundedAndCopiesInputAndOutput() {
    val history = PlaybackHealthHistory()
    for (value in 0..999) history.add(mapOf("event" to value))
    assertEquals(120, history.snapshot().size)
    assertEquals(880, history.snapshot().first()["event"])
    assertEquals(999, history.snapshot().last()["event"])
    val input = mutableMapOf<String, Any>("event" to 1000)
    history.add(input)
    input["event"] = "changed"
    assertEquals(1000, history.snapshot().last()["event"])
    (history.snapshot().last() as MutableMap)["event"] = "changed-again"
    assertEquals(1000, history.snapshot().last()["event"])
  }

  @Test fun zeroCapacityCollectsNothing() {
    val history = PlaybackHealthHistory(0)
    history.add(mapOf("event" to "test"))
    assertTrue(history.snapshot().isEmpty())
  }
}
