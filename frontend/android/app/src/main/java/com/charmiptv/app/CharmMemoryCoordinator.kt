package com.charmiptv.app

import android.app.ActivityManager
import android.content.Context
import android.os.SystemClock

internal enum class CharmTrimLevel { BACKGROUND, MODERATE, CRITICAL }

internal data class CharmMemoryBudgets(
  val memoryClassMb: Int,
  val lowRam: Boolean,
  val epgBytes: Long,
  val logoMemoryBytes: Long,
  val playerCacheBytes: Long,
  val vodCacheBytes: Long,
)

/** One acceptance decision for native trim and its matching JS notification. */
internal class CharmMemoryStartupGrace(
  private val elapsedRealtimeMs: () -> Long = SystemClock::elapsedRealtime,
) {
  @Volatile private var playbackStartingUntilMs = 0L

  fun setPlaybackStarting(starting: Boolean) {
    playbackStartingUntilMs = if (starting) elapsedRealtimeMs() + 15_000L else 0L
  }

  fun dispatch(level: CharmTrimLevel, onTrim: (CharmTrimLevel) -> Unit): Boolean {
    // Critical pressure must pass even during the first decoder preparation.
    if (level != CharmTrimLevel.CRITICAL && elapsedRealtimeMs() < playbackStartingUntilMs) return false
    onTrim(level)
    return true
  }
}

internal object CharmMemoryCoordinator {
  @Volatile private var budgets = CharmMemoryBudgets(192, false, 48L shl 20, 24L shl 20, 32L shl 20, 32L shl 20)
  private val startupGrace = CharmMemoryStartupGrace()
  private val listeners = LinkedHashSet<(CharmTrimLevel, CharmMemoryBudgets) -> Unit>()

  fun initialize(context: Context) {
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val memoryClass = manager.memoryClass.coerceAtLeast(64)
    val lowRam = manager.isLowRamDevice || memoryClass < 192
    val totalBytes = memoryClass.toLong() * 1024L * 1024L
    budgets = CharmMemoryBudgets(
      memoryClassMb = memoryClass,
      lowRam = lowRam,
      epgBytes = minOf(if (lowRam) 24L shl 20 else 64L shl 20, totalBytes / 6L),
      logoMemoryBytes = minOf(if (lowRam) 12L shl 20 else 32L shl 20, totalBytes / 10L),
      playerCacheBytes = minOf(if (lowRam) 16L shl 20 else 48L shl 20, totalBytes / 8L),
      vodCacheBytes = minOf(if (lowRam) 12L shl 20 else 64L shl 20, totalBytes / 8L),
    )
  }

  fun budgets(): CharmMemoryBudgets = budgets

  fun setPlaybackStarting(starting: Boolean) {
    startupGrace.setPlaybackStarting(starting)
  }

  fun register(listener: (CharmTrimLevel, CharmMemoryBudgets) -> Unit): () -> Unit = synchronized(listeners) {
    listeners.add(listener)
    return@synchronized { synchronized(listeners) { listeners.remove(listener) } }
  }

  fun trim(level: CharmTrimLevel): Boolean {
    // Delay background/moderate cleanup during decoder startup. Critical
    // pressure always wins. Callers must not emit a JS pressure event when
    // native cleanup was deferred by this same startup decision.
    return startupGrace.dispatch(level, ::dispatchTrim)
  }

  /**
   * Used only immediately before a full decoder reconstruction on low-RAM
   * hardware. MODERATE listeners may release disposable RAM caches, while
   * persistent SQLite guide data and the current guide selection stay intact.
   * This deliberately bypasses the decoder-start grace period: the player is
   * about to release/recreate its decoder and needs that memory first.
   */
  fun trimNonEssentialForPlaybackRecovery() {
    dispatchTrim(CharmTrimLevel.MODERATE)
  }

  private fun dispatchTrim(level: CharmTrimLevel) {
    val snapshot = synchronized(listeners) { listeners.toList() }
    for (listener in snapshot) runCatching { listener(level, budgets) }
  }
}
