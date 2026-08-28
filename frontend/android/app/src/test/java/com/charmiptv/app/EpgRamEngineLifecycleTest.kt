package com.charmiptv.app

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EpgRamEngineLifecycleTest {
  private fun programme(id: String) = NativeEpgProgram(id, "Programme", "Description", null, 1_000L, 4_000L)
  private fun binding(xmltvId: String) = PlaylistEpgMatchRow("playlist", xmltvId, "", false, "full", false)

  @Test
  fun `binding replacement between mapping snapshot and read cannot warm old ids`() {
    val reads = ArrayList<List<String>>()
    val engine = EpgRamEngine { _, _, ids ->
      reads.add(ids.toList())
      ids.map(::programme)
    }
    try {
      engine.replaceMatches(listOf(binding("old")))
      // Iteration begins after queryGuideWindow captures its mapping. Replace
      // it right there to reproduce the former generation-capture race exactly.
      val ids = object : AbstractCollection<String>() {
        override val size = 1
        override fun iterator(): Iterator<String> {
          engine.replaceMatches(listOf(binding("new")))
          return listOf("playlist").iterator()
        }
      }
      assertNull(engine.queryGuideWindow(1_000L, 4_000L, ids))
      assertTrue(reads.isEmpty())
      assertEquals(0L, engine.stats().getValue("channelCount"))
      val current = requireNotNull(engine.queryGuideWindow(1_000L, 4_000L, listOf("playlist")))
      assertEquals(listOf(listOf("new")), reads)
      assertEquals("playlist", current.single().channelId)
    } finally {
      engine.dispose()
    }
  }

  @Test
  fun `clear does not wait for an active database read or accept its stale refill`() {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val reads = AtomicInteger()
    val engine = EpgRamEngine { _, _, ids ->
      if (reads.incrementAndGet() == 1) {
        entered.countDown()
        check(release.await(5, TimeUnit.SECONDS)) { "cache clear blocked behind the database read" }
      }
      ids.map(::programme)
    }
    val executor = Executors.newSingleThreadExecutor()
    try {
      val result = executor.submit<List<NativeEpgProgram>?> { engine.queryWindow(1_000L, 4_000L, listOf("one")) }
      assertTrue(entered.await(5, TimeUnit.SECONDS))
      engine.clear()
      assertEquals(0L, engine.stats().getValue("channelCount"))
      release.countDown()
      assertNull(result.get(5, TimeUnit.SECONDS))
      assertEquals(0L, engine.stats().getValue("channelCount"))
      assertEquals(1, requireNotNull(engine.queryWindow(1_000L, 4_000L, listOf("one"))).size)
      assertEquals(2, reads.get())
    } finally {
      release.countDown()
      executor.shutdownNow()
      engine.dispose()
    }
  }

  @Test
  fun `memory trim rejects a read started before the trim`() {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val engine = EpgRamEngine { _, _, ids ->
      entered.countDown()
      check(release.await(5, TimeUnit.SECONDS))
      ids.map(::programme)
    }
    val executor = Executors.newSingleThreadExecutor()
    try {
      val result = executor.submit<List<NativeEpgProgram>?> { engine.queryWindow(1_000L, 4_000L, listOf("one")) }
      assertTrue(entered.await(5, TimeUnit.SECONDS))
      CharmMemoryCoordinator.trimNonEssentialForPlaybackRecovery()
      release.countDown()
      assertNull(result.get(5, TimeUnit.SECONDS))
      assertEquals(0L, engine.stats().getValue("channelCount"))
    } finally {
      release.countDown()
      executor.shutdownNow()
      engine.dispose()
    }
  }

  @Test
  fun `hot reads retain the bounded cache and do not mutate published arrays`() {
    val reads = AtomicInteger()
    val engine = EpgRamEngine { _, _, ids ->
      reads.incrementAndGet()
      ids.map(::programme)
    }
    try {
      val first = engine.queryWindow(1_000L, 4_000L, listOf("one"))
      val second = engine.queryWindow(1_000L, 4_000L, listOf("one"))
      assertEquals(first, second)
      assertEquals(1, reads.get())
      engine.queryWindow(1_000L, 4_000L, (0 until 1_000).map { "channel-$it" })
      assertTrue(engine.stats().getValue("channelCount") <= 320L)
      assertTrue(engine.stats().getValue("estimatedBytes") <= CharmMemoryCoordinator.budgets().epgBytes)
      assertEquals(listOf(programme("one")), first)
    } finally {
      engine.dispose()
    }
  }
}
