package com.charmiptv.app

import androidx.media3.common.PlaybackException

/** Event-driven recovery. BUFFERING is deliberately not a failure input. */
internal class Media3RecoveryPolicy {
  enum class Failure { NETWORK, LIVE_WINDOW, LIVE_END, AUTHENTICATION, DECODER, STARTUP, FATAL }
  enum class Action { REPREPARE_SOURCE, REFRESH_SOURCE, REBUILD_PLAYER, STOP }
  data class Decision(val action: Action, val delayMs: Long)

  var attempts = 0
    private set
  private var decoderAttempts = 0
  private var authenticationAttempts = 0
  private var playingSinceMs: Long? = null

  fun reset() {
    attempts = 0
    decoderAttempts = 0
    authenticationAttempts = 0
    playingSinceMs = null
  }

  fun onPlaying(nowMs: Long) {
    if (playingSinceMs == null) playingSinceMs = nowMs
  }

  fun onInterrupted(nowMs: Long) {
    // Evaluated only on an event, never by a timer that can stop playback.
    // A single painted frame must not reset decoder/authentication limits.
    if (playingSinceMs?.let { nowMs - it >= HEALTHY_PLAYBACK_RESET_MS } == true) reset()
    playingSinceMs = null
  }

  fun decide(failure: Failure, nowMs: Long): Decision {
    onInterrupted(nowMs)
    val action = when (failure) {
      Failure.NETWORK, Failure.LIVE_WINDOW, Failure.LIVE_END -> Action.REPREPARE_SOURCE
      Failure.AUTHENTICATION -> if (authenticationAttempts++ == 0) Action.REFRESH_SOURCE else Action.STOP
      Failure.DECODER, Failure.STARTUP -> if (decoderAttempts++ == 0) Action.REBUILD_PLAYER else Action.STOP
      Failure.FATAL -> Action.STOP
    }
    if (action == Action.STOP) return Decision(action, 0)
    attempts = (attempts.toLong() + 1).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    return Decision(action, minOf(attempts, 5) * 1_000L)
  }

  companion object {
    const val HEALTHY_PLAYBACK_RESET_MS = 10_000L

    fun classify(errorCode: Int, httpCode: Int?, hasIoCause: Boolean, hasTlsFailure: Boolean, isEstablishedLive: Boolean = false): Failure {
      if (hasTlsFailure) return Failure.FATAL
      if (httpCode == 401 || httpCode == 403) return Failure.AUTHENTICATION
      if (httpCode != null) {
        return if (httpCode == 408 || httpCode == 429 || httpCode in 500..599) Failure.NETWORK else Failure.FATAL
      }
      return when (errorCode) {
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> Failure.NETWORK
        PlaybackException.ERROR_CODE_IO_UNSPECIFIED -> if (hasIoCause) Failure.NETWORK else Failure.FATAL
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED ->
          if (isEstablishedLive) Failure.NETWORK else Failure.FATAL
        PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW -> Failure.LIVE_WINDOW
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FAILED,
        PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
        PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED -> Failure.DECODER
        else -> Failure.FATAL
      }
    }

    fun reconnectOnEnd(isLive: Boolean, userPaused: Boolean): Boolean = isLive && !userPaused
  }
}
