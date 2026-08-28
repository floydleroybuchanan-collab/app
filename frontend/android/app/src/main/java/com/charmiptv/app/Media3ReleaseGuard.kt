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

  fun release(player: Player?): Boolean {
    // After a timeout, ExoPlayer's next release can be a successful no-op even
    // while renderer cleanup is still blocked. Only process restart clears this
    // quarantine; do not manufacture a new decoder-release acknowledgement.
    if (failure != null) return false
    if (player == null) return true

    val releaseListener = object : Player.Listener {
      override fun onPlayerError(error: PlaybackException) {
        val timeout = error.cause as? ExoTimeoutException
        if (error.errorCode == PlaybackException.ERROR_CODE_TIMEOUT &&
          timeout?.timeoutOperation == ExoTimeoutException.TIMEOUT_OPERATION_RELEASE) {
          rememberFailure(error)
        }
      }
    }
    try {
      player.addListener(releaseListener)
      player.release()
    } catch (error: Throwable) {
      rememberFailure(error)
    } finally {
      try {
        player.removeListener(releaseListener)
      } catch (error: Throwable) {
        rememberFailure(error)
      }
    }
    // Return the failure instead of throwing so the caller can detach surfaces,
    // cancel callbacks, and settle the bridge stop Promise with an error.
    return failure == null
  }

  private fun rememberFailure(error: Throwable) {
    if (failure == null) failure = error
  }
}
