package com.charmiptv.app

import androidx.media3.common.PlaybackException
import com.charmiptv.app.Media3RecoveryPolicy.Action
import com.charmiptv.app.Media3RecoveryPolicy.Failure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class Media3RecoveryPolicyTest {
  @Test fun repeatedNetworkOutagesNeverBecomeTerminalFailures() {
    val policy = Media3RecoveryPolicy()
    repeat(100) { index ->
      val result = policy.decide(Failure.NETWORK, index * 1_000L)
      assertEquals(Action.REPREPARE_SOURCE, result.action)
      assertEquals(minOf(index + 1, 5) * 1_000L, result.delayMs)
    }
  }

  @Test fun bufferingAndResumptionDoNotConsumeRecoveryAttempts() {
    val policy = Media3RecoveryPolicy()
    repeat(100) { index ->
      policy.onPlaying(index * 20_000L)
      policy.onInterrupted(index * 20_000L + 2_000)
    }
    assertEquals(0, policy.attempts)
  }

  @Test fun healthyPlaybackResetsAnOutageWithoutAWatchdog() {
    val policy = Media3RecoveryPolicy()
    repeat(6) { policy.decide(Failure.NETWORK, 0) }
    policy.onPlaying(1_000)
    policy.onPlaying(5_000)
    assertEquals(1_000L, policy.decide(Failure.NETWORK, 11_000).delayMs)
  }

  @Test fun oneFrameDoesNotPermitAnInfiniteDecoderRebuildLoop() {
    val policy = Media3RecoveryPolicy()
    assertEquals(Action.REBUILD_PLAYER, policy.decide(Failure.DECODER, 0).action)
    policy.onPlaying(100)
    assertEquals(Action.STOP, policy.decide(Failure.DECODER, 200).action)
  }

  @Test fun startupAndDecoderFaultsShareABoundedRebuildBudget() {
    val policy = Media3RecoveryPolicy()
    assertEquals(Action.REBUILD_PLAYER, policy.decide(Failure.STARTUP, 0).action)
    assertEquals(Action.STOP, policy.decide(Failure.DECODER, 100).action)
  }

  @Test fun authRefreshIsBoundedAndIndependentOfNetworkRetries() {
    val policy = Media3RecoveryPolicy()
    repeat(8) { policy.decide(Failure.NETWORK, 0) }
    assertEquals(Action.REFRESH_SOURCE, policy.decide(Failure.AUTHENTICATION, 0).action)
    assertEquals(Action.STOP, policy.decide(Failure.AUTHENTICATION, 0).action)
  }

  @Test fun laterIndependentDecoderFaultCanRecoverAfterHealthyPlayback() {
    val policy = Media3RecoveryPolicy()
    policy.decide(Failure.DECODER, 0)
    policy.onPlaying(100)
    assertEquals(Action.REBUILD_PLAYER, policy.decide(Failure.DECODER, 10_100).action)
  }

  @Test fun transientAndPermanentErrorsAreSeparated() {
    for (code in listOf(408, 429, 500, 502, 503, 504)) {
      assertEquals(Failure.NETWORK, Media3RecoveryPolicy.classify(2004, code, true, false))
    }
    for (code in listOf(400, 404, 410, 416, 458)) {
      assertEquals(Failure.FATAL, Media3RecoveryPolicy.classify(2004, code, true, false))
    }
    for (code in listOf(401, 403)) {
      assertEquals(Failure.AUTHENTICATION, Media3RecoveryPolicy.classify(2004, code, true, false))
    }
    assertEquals(Failure.NETWORK, Media3RecoveryPolicy.classify(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, null, true, false))
    assertEquals(Failure.FATAL, Media3RecoveryPolicy.classify(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, null, true, true))
    assertEquals(Failure.FATAL, Media3RecoveryPolicy.classify(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, null, true, false))
    assertEquals(Failure.LIVE_WINDOW, Media3RecoveryPolicy.classify(PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW, null, false, false))
  }

  @Test fun finiteVodAndPausedLiveDoNotReconnectAtEnd() {
    assertFalse(Media3RecoveryPolicy.reconnectOnEnd(false, false))
    assertFalse(Media3RecoveryPolicy.reconnectOnEnd(true, true))
    assertTrue(Media3RecoveryPolicy.reconnectOnEnd(true, false))
  }

  @Test fun damagedLiveSegmentsRecoverButUnsupportedFormatsAndUnprovenSourcesDoNotLoop() {
    for (code in listOf(
      PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
      PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
    )) {
      assertEquals(Failure.NETWORK, Media3RecoveryPolicy.classify(code, null, true, false, true))
      assertEquals(Failure.FATAL, Media3RecoveryPolicy.classify(code, null, true, false, false))
    }
    assertEquals(Failure.FATAL, Media3RecoveryPolicy.classify(
      PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, null, true, false, true,
    ))
  }
}
