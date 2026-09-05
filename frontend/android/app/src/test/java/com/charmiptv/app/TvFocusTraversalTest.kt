package com.charmiptv.app

import org.junit.Assert.*
import org.junit.Test

class TvFocusTraversalTest {
  private data class Node(val name: String, val usable: Boolean = false, val children: List<Node> = emptyList())

  @Test fun walksNestedGuideSentinelsAndKeepsTheFixedHeaderReachable() {
    val root = Node("page focus guide", children = listOf(
      Node("header", children = listOf(Node("All Settings", true))),
      Node("scroll container", children = listOf(Node("clipped old row"), Node("Custom EPG", true), Node("CharmIPTV 2 EPG", true))),
    ))
    assertEquals(listOf("All Settings", "Custom EPG", "CharmIPTV 2 EPG"),
      TvFocusTraversal.targets(root, { it.children }, { it.usable }).map { it.name })
  }

  @Test fun falseSuccessFromAContainerDoesNotEndTheHandoff() {
    val requests = ArrayList<String>()
    var focused = "rail"
    assertTrue(TvFocusTraversal.transfer(listOf("sentinel", "button"), {
      requests.add(it); focused = if (it == "sentinel") "clipped row" else it; true
    }, { focused == "button" }, { focused = "rail" }))
    assertEquals(listOf("sentinel", "button"), requests)
    assertEquals("button", focused)
  }

  @Test fun exhaustingTargetsRestoresVisibleRailRatherThanLeavingInvisibleFocus() {
    var focused = "rail"
    assertFalse(TvFocusTraversal.transfer(listOf("clipped row", "clipped row"), {
      focused = it; true
    }, { false }, { focused = "rail" }))
    assertEquals("rail", focused)
  }
}
