package com.charmiptv.app

import org.junit.Assert.*
import org.junit.Test

class MultiviewPolicyTest {
  @Test fun bufferAllocationStaysWithinSharedBudget() {
    assertEquals(48 * 1024 * 1024, (0 until 4).sumOf { MultiviewPolicy.PANE_BUFFER_BYTES })
    assertFalse(MultiviewPolicy.validSlot(4))
    assertFalse(MultiviewPolicy.validSlot(-1))
  }
  @Test fun removalKeepsAudibleChannelUntilThatPaneIsRemoved() {
    assertEquals(3, MultiviewPolicy.audioAfterRemoval(3,1,setOf(0,2,3)))
    assertEquals(0, MultiviewPolicy.audioAfterRemoval(3,3,setOf(0,2)))
    assertEquals(-1, MultiviewPolicy.audioAfterRemoval(0,0,emptySet()))
  }
}
