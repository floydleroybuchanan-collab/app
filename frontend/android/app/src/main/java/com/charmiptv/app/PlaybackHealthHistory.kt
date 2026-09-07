package com.charmiptv.app

import java.util.ArrayDeque

/** Bounded local metadata only. No source URLs, headers, usernames or tokens. */
internal class PlaybackHealthHistory(private val capacity: Int = 120) {
  private val rows = ArrayDeque<Map<String, Any>>()
  @Synchronized fun add(row: Map<String, Any>) {
    if (capacity <= 0) return
    rows.addLast(LinkedHashMap(row))
    while (rows.size > capacity) rows.removeFirst()
  }
  @Synchronized fun snapshot(): List<Map<String, Any>> = rows.map { LinkedHashMap(it) }
}
