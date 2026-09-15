package com.charmiptv.app

import org.junit.Assert.*
import org.junit.Test

class PlayerSelectPolicyTest {
  @Test fun firstOkRevealsAndSecondOkActivates() {
    assertFalse(PlayerSelectPolicy.activate(false, false, true))
    assertTrue(PlayerSelectPolicy.activate(true, true, true))
  }
  @Test fun controlsHidingOrRemountingDuringHoldCannotClickNewSurface() {
    assertFalse(PlayerSelectPolicy.activate(true, true, false))
    assertFalse(PlayerSelectPolicy.activate(true, false, true))
    assertFalse(PlayerSelectPolicy.activate(false, true, true))
  }
}
