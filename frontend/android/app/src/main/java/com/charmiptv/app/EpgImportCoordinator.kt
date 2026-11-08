package com.charmiptv.app

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock

/** One lease per database, shared by WorkManager and every React importer.
 * Readers never take this lock. Reentrant leases also protect low-level swaps.
 */
internal object EpgImportCoordinator {
  private val locks = ConcurrentHashMap<String, ReentrantLock>()
  // Only one memory-intensive XMLTV import runs at a time across all sources.
  // Native readers and playback do not take this lock.
  private val globalImportGate = ReentrantLock(true)
  private val imports = AtomicInteger(0)
  @Volatile var appVisible = false
  @Volatile var playbackActive = false

  fun canStartBackground(): Boolean = !appVisible && !playbackActive
  fun activeImports(): Int = imports.get()

  fun acquire(databaseKey: String): AutoCloseable {
    globalImportGate.lock()
    val lock = locks.getOrPut(databaseKey) { ReentrantLock(true) }
    try {
      lock.lock()
    } catch (failure: Throwable) {
      globalImportGate.unlock()
      throw failure
    }
    val outer = lock.holdCount == 1
    if (outer) imports.incrementAndGet()
    return AutoCloseable {
      if (outer) imports.decrementAndGet()
      try { lock.unlock() } finally { globalImportGate.unlock() }
    }
  }
}
