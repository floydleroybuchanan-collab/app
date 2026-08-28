package com.charmiptv.app

import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoTimeoutException

/**
 * Called on the player's application looper, just like Player.release().
 *
 * Media3 1.8.0 reports an internal release timeout synchronously through
 * onPlayerError, then returns normally and retires its listeners. The normal
 * playback listener may already have been invalidated during a handoff. Neither
 * a normal return nor isReleased proves that the decoder finished releasing.
 */
@OptIn(UnstableApi::class)
internal class Media3ReleaseGuard {
  var failure: Throwable? = null
    private set
  private var timedOutPlaybackThread: Thread? = null
  private var releaseTimeoutOnly = false
  private var releaseInProgress = false

  fun release(player: Player?, ownedPlaybackThread: Thread? = null): Boolean {
    // After a timeout, ExoPlayer's next release can be a successful no-op even
    // while renderer cleanup is still blocked. A subsequent no-op release is
    // not proof that the first release finished.
    if (failure != null || releaseInProgress) return false
    if (player == null) return true
    // The caller must own this dedicated Media3 thread, not a shared/external
    // looper. Remember a live thread before release can finish or time out.
    val releaseThread = ownedPlaybackThread?.takeIf {
      it !== Thread.currentThread() && it.isAlive
    }

    val releaseListener = object : Player.Listener {
      override fun onPlayerError(error: PlaybackException) {
        val timeout = error.cause as? ExoTimeoutException
        if (error.errorCode == PlaybackException.ERROR_CODE_TIMEOUT &&
          timeout?.timeoutOperation == ExoTimeoutException.TIMEOUT_OPERATION_RELEASE) {
          // A later timeout callback cannot rehabilitate an earlier arbitrary
          // release/listener failure for completion acknowledgement.
          if (failure == null) {
            rememberFailure(error)
            releaseTimeoutOnly = true
            timedOutPlaybackThread = releaseThread
          }
        }
      }
    }
    releaseInProgress = true
    try {
      player.addListener(releaseListener)
      player.release()
    } catch (error: Throwable) {
      releaseTimeoutOnly = false
      rememberFailure(error)
    } finally {
      try {
        player.removeListener(releaseListener)
      } catch (error: Throwable) {
        releaseTimeoutOnly = false
        rememberFailure(error)
      } finally {
        releaseInProgress = false
      }
    }
    // Return the failure instead of throwing so the caller can detach surfaces,
    // cancel callbacks, and settle the bridge stop Promise with an error.
    return failure == null
  }

  /**
   * Media3 stops its owned playback thread when its internal release path ends.
   * A timeout means that path did not finish before the caller's deadline; it
   * may finish later. Allow the next explicit operation only after that thread
   * has actually terminated. Never wait on the UI thread or infer completion
   * from elapsed time, isReleased, or a second release() call. Like Media3's
   * normal release acknowledgement, this cannot verify vendor resource cleanup.
   */
  fun acknowledgeCompletedRelease(): Boolean {
    if (releaseInProgress || failure == null || !releaseTimeoutOnly ||
      timedOutPlaybackThread?.state != Thread.State.TERMINATED) return false
    failure = null
    timedOutPlaybackThread = null
    releaseTimeoutOnly = false
    return true
  }

  private fun rememberFailure(error: Throwable) {
    if (failure == null) failure = error
  }
}
