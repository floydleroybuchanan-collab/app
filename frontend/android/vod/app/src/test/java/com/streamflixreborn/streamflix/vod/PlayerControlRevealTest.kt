package com.streamflixreborn.streamflix.vod

import android.app.Application
import android.os.Looper
import android.view.KeyEvent
import androidx.media3.exoplayer.ExoPlayer
import com.streamflixreborn.streamflix.ui.PlayerTvView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], application=Application::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
class PlayerControlRevealTest {
    @Test fun playbackHandoffReleasesOldOwnerAndIgnoresStaleRelease() {
        val context = RuntimeEnvironment.getApplication()
        val first = ExoPlayer.Builder(context).build()
        val second = ExoPlayer.Builder(context).build()
        val third = ExoPlayer.Builder(context).build()
        var releasedFirst = false
        var releasedSecond = false
        val core = com.streamflixreborn.streamflix.charm.CharmPlaybackCore
        try {
            core.claim(first) { releasedFirst = true; core.release(first) }
            core.claim(second) { releasedSecond = true; core.release(second) }
            assertTrue(releasedFirst)
            core.release(first)
            core.claim(third) { core.release(third) }
            assertTrue(releasedSecond)
        } finally { core.release(first); core.release(second); core.release(third) }
    }

    @Test fun failedReleaseDoesNotAdmitAnotherOwner() {
        val context = RuntimeEnvironment.getApplication()
        val first = ExoPlayer.Builder(context).build()
        val second = ExoPlayer.Builder(context).build()
        val core = com.streamflixreborn.streamflix.charm.CharmPlaybackCore
        try {
            core.claim(first) { /* platform failure left its decoder alive */ }
            assertThrows(IllegalStateException::class.java) { core.claim(second) { core.release(second) } }
        } finally { core.release(first); core.release(second) }
    }
    @Test fun stopBelongsToTheControllerAndHidesWithIt() {
        val context = RuntimeEnvironment.getApplication()
        val player = ExoPlayer.Builder(context).build()
        val attrs = org.robolectric.Robolectric.buildAttributeSet().addAttribute(androidx.media3.ui.R.attr.controller_layout_id, "@layout/content_exo_controller_tv").build()
        val view = PlayerTvView(context, attrs).apply { this.player = player }
        val stop = view.findViewById<android.view.View>(com.streamflixreborn.streamflix.R.id.btn_exo_stop)
        try {
            view.showController()
            shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(300))
            assertTrue(view.isControllerFullyVisible)
            assertEquals(com.streamflixreborn.streamflix.R.id.exo_settings, stop.nextFocusRightId)
            assertEquals(com.streamflixreborn.streamflix.R.id.btn_exo_sources, stop.nextFocusLeftId)
            view.hideController()
            shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(1))
            assertFalse(view.isControllerFullyVisible)
        } finally { view.player = null; player.release() }
    }
    @Test fun firstRemotePressRevealsControlsWithoutSeekingOrPausing() {
        val context=RuntimeEnvironment.getApplication()
        val player=ExoPlayer.Builder(context).build()
        val view=PlayerTvView(context).apply { this.player=player }
        try {
            for(key in listOf(KeyEvent.KEYCODE_DPAD_LEFT,KeyEvent.KEYCODE_DPAD_RIGHT,
                KeyEvent.KEYCODE_DPAD_UP,KeyEvent.KEYCODE_DPAD_DOWN,KeyEvent.KEYCODE_DPAD_CENTER,KeyEvent.KEYCODE_ENTER)) {
                view.hideController();shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(1))
                val position=player.currentPosition;val playing=player.playWhenReady
                assertTrue(view.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN,key)))
                shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(300))
                assertTrue(view.isControllerFullyVisible)
                assertTrue(view.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP,key)))
                assertEquals(position,player.currentPosition);assertEquals(playing,player.playWhenReady)
            }
        } finally {view.player=null;player.release()}
    }
}


