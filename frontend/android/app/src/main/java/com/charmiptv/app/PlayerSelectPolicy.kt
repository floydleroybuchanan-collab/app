package com.charmiptv.app

/** An OK used to reveal controls must never click the button revealed by it. */
internal object PlayerSelectPolicy {
  fun activate(controlAtDown: Boolean, sameControlAtUp: Boolean, usableAtUp: Boolean): Boolean =
    controlAtDown && sameControlAtUp && usableAtUp
}
