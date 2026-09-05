package com.charmiptv.app

/** Physical-tree traversal; deliberately independent of focus-guide sentinels. */
internal object TvFocusTraversal {
  fun <T> targets(root: T, children: (T) -> List<T>, usable: (T) -> Boolean): List<T> {
    val result = ArrayList<T>()
    fun visit(node: T) {
      if (usable(node)) result.add(node)
      for (child in children(node)) visit(child)
    }
    for (child in children(root)) visit(child)
    return result
  }

  fun <T> transfer(targets: List<T>, request: (T) -> Boolean, confirmed: () -> Boolean, restore: () -> Unit): Boolean {
    for (target in targets.distinct()) {
      // requestFocus can report success while a guide redirects to a hidden row.
      if (request(target) && confirmed()) return true
    }
    restore()
    return false
  }
}
