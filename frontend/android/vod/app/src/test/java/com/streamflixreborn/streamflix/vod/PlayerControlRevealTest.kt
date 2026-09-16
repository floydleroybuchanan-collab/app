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
