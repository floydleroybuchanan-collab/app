package com.charmiptv.app

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BoundedMaintenanceQueueTest {
  @Test fun blockedMaintenanceDoesNotBlockTheCallerOrGrowTheQueue() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val rejected = AtomicInteger()
    BoundedMaintenanceQueue("maintenance-test", 1).use { queue ->
      queue.submit({ throw AssertionError(it) }) { started.countDown(); release.await(5, TimeUnit.SECONDS) }
      assertTrue(started.await(5, TimeUnit.SECONDS))
      queue.submit({ throw AssertionError(it) }) { finished.countDown() }
      queue.submit({ rejected.incrementAndGet() }) { throw AssertionError("Queue overflow executed") }
      assertEquals(1, rejected.get())
      release.countDown()
      assertTrue(finished.await(5, TimeUnit.SECONDS))
    }
  }

  @Test fun destructionCancelsQueuedWorkAndRejectsNewWork() {
    val started = CountDownLatch(1)
    val queuedCancelled = AtomicInteger()
    val queuedExecuted = AtomicInteger()
    val queue = BoundedMaintenanceQueue("maintenance-cancel-test", 1)
    queue.submit({}) { started.countDown(); CountDownLatch(1).await(5, TimeUnit.SECONDS) }
    assertTrue(started.await(5, TimeUnit.SECONDS))
    queue.submit({ queuedCancelled.incrementAndGet() }) { queuedExecuted.incrementAndGet() }
    queue.close()
    queue.submit({ queuedCancelled.incrementAndGet() }) { queuedExecuted.incrementAndGet() }
    assertEquals(2, queuedCancelled.get())
    assertEquals(0, queuedExecuted.get())
  }
}
