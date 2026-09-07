package com.charmiptv.app

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock

/** One lease per database, shared by WorkManager and every React importer.
 * Readers never take this lock. Reentrant leases also protect low-level swaps.
 */
internal object EpgImportCoordinator {
  private val locks = ConcurrentHashMap<String, ReentrantLock>()
  private val imports = AtomicInteger(0)
  @Volatile var appVisible = false
  @Volatile var playbackActive = false

  fun canStartBackground(): Boolean = !appVisible && !playbackActive
  fun activeImports(): Int = imports.get()

  fun acquire(databaseKey: String): AutoCloseable {
    val lock = locks.getOrPut(databaseKey) { ReentrantLock(true) }
    lock.lock()
    val outer = lock.holdCount == 1
    if (outer) imports.incrementAndGet()
    return AutoCloseable {
      if (outer) imports.decrementAndGet()
      lock.unlock()
    }
  }
}
