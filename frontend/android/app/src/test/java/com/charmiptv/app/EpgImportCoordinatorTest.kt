package com.charmiptv.app

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class EpgImportCoordinatorTest {
  @Test fun sameDatabaseSerializesStagingAndMetadata() {
    val pool = Executors.newSingleThreadExecutor()
    val entered = CountDownLatch(1)
    val key = "same-database-test"
    val events = java.util.Collections.synchronizedList(mutableListOf<String>())
    try {
      val lease = EpgImportCoordinator.acquire(key)
      try {
        events.add("foreground-staging")
        val job = pool.submit {
          entered.countDown()
          EpgImportCoordinator.acquire(key).use { events.add("background-staging"); events.add("background-metadata") }
        }
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        assertFalse(job.isDone)
        events.add("foreground-metadata")
      } finally { lease.close() }
      pool.shutdown()
      assertTrue(pool.awaitTermination(3, TimeUnit.SECONDS))
      assertEquals(listOf("foreground-staging", "foreground-metadata", "background-staging", "background-metadata"), events)
      assertEquals(0, EpgImportCoordinator.activeImports())
    } finally { pool.shutdownNow() }
  }

  @Test fun differentDatabaseDoesNotWaitAndNestedLeaseCountsOnce() {
    val pool = Executors.newSingleThreadExecutor()
    try {
      EpgImportCoordinator.acquire("first-database").use {
        assertEquals(1, EpgImportCoordinator.activeImports())
        EpgImportCoordinator.acquire("first-database").use { assertEquals(1, EpgImportCoordinator.activeImports()) }
        assertTrue(pool.submit<Boolean> { EpgImportCoordinator.acquire("second-database").use { true } }.get(2, TimeUnit.SECONDS))
      }
      assertEquals(0, EpgImportCoordinator.activeImports())
    } finally { pool.shutdownNow() }
  }

  @Test fun exceptionReleasesLeaseForNextImporter() {
    try { EpgImportCoordinator.acquire("failure-database").use { throw IllegalStateException("synthetic") } }
    catch (_: IllegalStateException) {}
    val pool = Executors.newSingleThreadExecutor()
    try {
      assertTrue(pool.submit<Boolean> { EpgImportCoordinator.acquire("failure-database").use { true } }.get(2, TimeUnit.SECONDS))
      assertEquals(0, EpgImportCoordinator.activeImports())
    } finally { pool.shutdownNow() }
  }

  @Test fun backgroundDefersToVisibleAppOrPlayback() {
    try {
      for (visible in listOf(false, true)) for (playing in listOf(false, true)) {
        EpgImportCoordinator.appVisible = visible
        EpgImportCoordinator.playbackActive = playing
        assertEquals(!visible && !playing, EpgImportCoordinator.canStartBackground())
      }
    } finally { EpgImportCoordinator.appVisible = false; EpgImportCoordinator.playbackActive = false }
  }
}
