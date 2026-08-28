package com.charmiptv.app

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoTimeoutException
import java.lang.reflect.Proxy
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
