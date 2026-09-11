package com.charmiptv.app

/** Pure policy shared by allocation and unit tests. Allocation targets exclude decoder memory. */
internal object MultiviewPolicy {
  const val MAX_PANES = 4
  const val TOTAL_BUFFER_BYTES = 48 * 1024 * 1024
  const val PANE_BUFFER_BYTES = TOTAL_BUFFER_BYTES / MAX_PANES
  fun validSlot(slot: Int) = slot in 0 until MAX_PANES
  fun audioAfterRemoval(audible: Int, removed: Int, remaining: Set<Int>): Int =
    if (audible != removed && audible in remaining) audible else remaining.minOrNull() ?: -1
}
