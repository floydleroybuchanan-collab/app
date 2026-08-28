package com.charmiptv.app

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoTimeoutException
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(UnstableApi::class)
class Media3ReleaseGuardTest {
  @Test fun ordinaryReleaseSucceedsAndRemovesTheTemporaryListenerOnTheCallingThread() {
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val caller = Thread.currentThread()
    native.onRelease = { assertSame(caller, Thread.currentThread()) }

    assertTrue(guard.release(native.player))
    assertNull(guard.failure)
    assertEquals(listOf("addListener", "release", "removeListener"), native.calls)
    assertTrue(native.listeners.isEmpty())
    // A later healthy player can release through the same manager guard.
    assertTrue(guard.release(FakePlayer().player))
  }

  @Test fun synchronousReleaseTimeoutIsFailureEvenWhenReleaseReturnsNormally() {
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val timeout = releaseTimeout()
    native.onRelease = {
      native.emitError(timeout)
      // Match Media3: retire listeners and finish release without throwing.
      native.listeners.clear()
    }

    assertFalse(guard.release(native.player))
    assertSame(timeout, guard.failure)
    assertEquals(listOf("addListener", "release", "removeListener"), native.calls)
    assertTrue(native.listeners.isEmpty())
  }

  @Test fun aLaterNoOpReleaseOrNullPlayerCannotClearTheTimedOutDecoder() {
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val timeout = releaseTimeout()
    native.onRelease = { native.emitError(timeout) }
    assertFalse(guard.release(native.player))
    native.onRelease = {} // ExoPlayer's later release would now return normally.
    native.calls.clear()

    assertFalse(guard.release(native.player))
    assertFalse(guard.release(null))
    val replacement = FakePlayer()
    assertFalse(guard.release(replacement.player))
    assertSame(timeout, guard.failure)
    assertTrue(native.calls.isEmpty())
    assertTrue(replacement.calls.isEmpty())
  }

  @Test fun thrownReleaseFailureSettlesAndKeepsTheDecoderQuarantined() {
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val error = IllegalStateException("release failed")
    native.onRelease = { throw error }

    assertFalse(guard.release(native.player))
    assertSame(error, guard.failure)
    assertTrue(native.listeners.isEmpty())
    assertEquals(listOf("addListener", "release", "removeListener"), native.calls)
    native.onRelease = {}
    assertFalse(guard.release(native.player))
    assertEquals(1, native.calls.count { it == "release" })
  }

  @Test fun listenerCleanupDoesNotOverwriteTheOriginalReleaseTimeoutOrEscape() {
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val timeout = releaseTimeout()
    native.onRelease = { native.emitError(timeout) }
    native.onRemove = { throw IllegalStateException("listener removal failed") }

    assertFalse(guard.release(native.player))
    assertSame(timeout, guard.failure)
    assertEquals("removeListener", native.calls.last())
  }

  @Test fun failureToRegisterTheReleaseListenerNeverAcknowledgesRelease() {
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val error = IllegalStateException("listener registration failed")
    native.onAdd = { throw error }

    assertFalse(guard.release(native.player))
    assertSame(error, guard.failure)
    assertEquals(listOf("addListener", "removeListener"), native.calls)
  }

  @Test fun networkAndOtherOperationTimeoutsDoNotMasqueradeAsReleaseTimeouts() {
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    native.onRelease = {
      native.emitError(TestPlaybackException(null, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT))
      for (operation in listOf(
        ExoTimeoutException.TIMEOUT_OPERATION_UNDEFINED,
        ExoTimeoutException.TIMEOUT_OPERATION_SET_FOREGROUND_MODE,
        ExoTimeoutException.TIMEOUT_OPERATION_DETACH_SURFACE,
      )) native.emitError(TestPlaybackException(ExoTimeoutException(operation)))
    }

    assertTrue(guard.release(native.player))
    assertNull(guard.failure)
    assertTrue(native.listeners.isEmpty())
  }

  @Test fun aNeverAllocatedPlayerNeedsNoRelease() {
    val guard = Media3ReleaseGuard()
    assertTrue(guard.release(null))
    assertNull(guard.failure)
  }

  @Test fun releaseTimeoutRecoversOnlyAfterTheCapturedPlaybackThreadTerminates() = withPlaybackThread { thread, finish ->
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    native.onRelease = { native.emitError(releaseTimeout()) }
    assertFalse(guard.release(native.player, thread))
    assertFalse(guard.acknowledgeCompletedRelease())
    assertFalse(guard.release(null))
    val next = FakePlayer()
    assertFalse(guard.release(next.player))
    assertTrue(next.calls.isEmpty())

    finish()
    assertEquals(Thread.State.TERMINATED, thread.state)
    assertTrue(guard.acknowledgeCompletedRelease())
    assertNull(guard.failure)
    assertFalse(guard.acknowledgeCompletedRelease())
    assertTrue(guard.release(next.player))
    assertEquals(listOf("addListener", "release", "removeListener"), next.calls)
  }

  @Test fun arbitraryReleaseExceptionsCannotBeClearedByThreadTermination() = withPlaybackThread { thread, finish ->
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val failure = IllegalStateException("release failed")
    native.onRelease = { throw failure }
    assertFalse(guard.release(native.player, thread))
    finish()
    assertFalse(guard.acknowledgeCompletedRelease())
    assertSame(failure, guard.failure)
  }

  @Test fun cleanupFailureAfterATimeoutStillRequiresExplicitFaultHandling() = withPlaybackThread { thread, finish ->
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val timeout = releaseTimeout()
    native.onRelease = { native.emitError(timeout) }
    native.onRemove = { throw IllegalStateException("listener cleanup failed") }
    assertFalse(guard.release(native.player, thread))
    finish()
    assertFalse(guard.acknowledgeCompletedRelease())
    assertSame(timeout, guard.failure)
  }

  @Test fun acknowledgementCannotReenterBeforeReleaseAndListenerCleanupFinish() = withPlaybackThread { thread, finish ->
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    var duringRelease: Boolean? = null
    var duringCleanup: Boolean? = null
    native.onRelease = {
      native.emitError(releaseTimeout())
      finish()
      duringRelease = guard.acknowledgeCompletedRelease()
    }
    native.onRemove = { duringCleanup = guard.acknowledgeCompletedRelease() }

    assertFalse(guard.release(native.player, thread))
    assertFalse(requireNotNull(duringRelease))
    assertFalse(requireNotNull(duringCleanup))
    assertTrue(guard.acknowledgeCompletedRelease())
    assertNull(guard.failure)
  }

  @Test fun aLateTimeoutCallbackCannotRequalifyAnArbitraryReleaseException() = withPlaybackThread { thread, finish ->
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    val failure = IllegalStateException("release failed before timeout callback")
    var capturedListener: Player.Listener? = null
    native.onRelease = {
      capturedListener = native.listeners.single()
      throw failure
    }
    native.onRemove = { requireNotNull(capturedListener).onPlayerError(releaseTimeout()) }

    assertFalse(guard.release(native.player, thread))
    finish()
    assertFalse(guard.acknowledgeCompletedRelease())
    assertSame(failure, guard.failure)
  }

  @Test fun unstartedAlreadyDeadAndCallingThreadsAreNotCompletionEvidence() {
    val alreadyDead = Thread {}.apply { isDaemon = true; start(); join(2_000) }
    assertEquals(Thread.State.TERMINATED, alreadyDead.state)
    for (thread in listOf(Thread {}, alreadyDead, Thread.currentThread())) {
      val guard = Media3ReleaseGuard()
      val native = FakePlayer()
      native.onRelease = { native.emitError(releaseTimeout()) }
      assertFalse(guard.release(native.player, thread))
      assertFalse(guard.acknowledgeCompletedRelease())
    }
  }

  @Test fun aLaterReleaseCannotSubstituteAnotherCompletedThread() = withPlaybackThread { original, finish ->
    val guard = Media3ReleaseGuard()
    val native = FakePlayer()
    native.onRelease = { native.emitError(releaseTimeout()) }
    assertFalse(guard.release(native.player, original))
    val unrelated = Thread {}.apply { isDaemon = true; start(); join(2_000) }
    val replacement = FakePlayer()
    assertFalse(guard.release(replacement.player, unrelated))
    assertTrue(replacement.calls.isEmpty())
    assertFalse(guard.acknowledgeCompletedRelease())

    finish()
    assertTrue(guard.acknowledgeCompletedRelease())
  }

  private fun withPlaybackThread(test: (Thread, () -> Unit) -> Unit) {
    val started = CountDownLatch(1)
    val complete = CountDownLatch(1)
    val thread = Thread({ started.countDown(); complete.await() }, "test-owned-playback").apply {
      isDaemon = true
      start()
    }
    val finish = {
      complete.countDown()
      thread.join(2_000)
      assertFalse("owned thread did not terminate", thread.isAlive)
    }
    try {
      assertTrue(started.await(2, TimeUnit.SECONDS))
      test(thread, finish)
    } finally {
      finish()
    }
  }

  private fun releaseTimeout() = TestPlaybackException(
    ExoTimeoutException(ExoTimeoutException.TIMEOUT_OPERATION_RELEASE),
  )

  // Use the timestamp constructor so this JVM test needs neither an Android
  // clock nor a real decoder. Production still receives Media3's real event.
  private class TestPlaybackException(
    cause: Throwable?,
    code: Int = PlaybackException.ERROR_CODE_TIMEOUT,
  ) : PlaybackException("test playback error", cause, code, Bundle.EMPTY, 0L)

  private class FakePlayer {
    val listeners = mutableListOf<Player.Listener>()
    val calls = mutableListOf<String>()
    var onAdd: () -> Unit = {}
    var onRemove: () -> Unit = {}
    var onRelease: () -> Unit = {}
    val player: Player = Proxy.newProxyInstance(
      Player::class.java.classLoader,
      arrayOf(Player::class.java),
    ) { _, method, args ->
      calls += method.name
      when (method.name) {
        "addListener" -> { onAdd(); listeners += args!![0] as Player.Listener }
        "removeListener" -> { listeners -= args!![0] as Player.Listener; onRemove() }
        "release" -> onRelease()
        else -> throw AssertionError("Unexpected Player call: ${method.name}")
      }
      null
    } as Player

    fun emitError(error: PlaybackException) {
      listeners.toList().forEach { it.onPlayerError(error) }
    }
  }
}
