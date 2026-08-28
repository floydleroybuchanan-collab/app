package com.charmiptv.app

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CancellationException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Slow diagnostics/disk work must not occupy React Native's module-call queue. */
internal class BoundedMaintenanceQueue(name: String, capacity: Int = 4) : AutoCloseable {
  private class Task(val onFailure: (Throwable) -> Unit, val work: () -> Unit) : Runnable {
    private val claimed = AtomicBoolean(false)

    override fun run() {
      if (!claimed.compareAndSet(false, true)) return
      try {
        if (Thread.currentThread().isInterrupted) throw CancellationException("Maintenance cancelled")
        work()
      } catch (failure: Throwable) {
        runCatching { onFailure(failure) }
      }
    }

    fun cancel(failure: Throwable) {
      if (claimed.compareAndSet(false, true)) runCatching { onFailure(failure) }
    }
  }

  private val executor = ThreadPoolExecutor(
    1, 1, 30L, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(capacity),
    { work -> Thread(work, name).apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 } },
    ThreadPoolExecutor.AbortPolicy(),
  ).apply { allowCoreThreadTimeOut(true) }

  fun submit(onFailure: (Throwable) -> Unit, work: () -> Unit) {
    val task = Task(onFailure, work)
    try {
      executor.execute(task)
    } catch (failure: java.util.concurrent.RejectedExecutionException) {
      task.cancel(failure)
    }
  }

  override fun close() {
    for (task in executor.shutdownNow()) {
      (task as Task).cancel(CancellationException("Native module was destroyed"))
    }
  }
}
