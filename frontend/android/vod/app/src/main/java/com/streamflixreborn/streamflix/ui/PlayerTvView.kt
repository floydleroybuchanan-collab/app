package com.streamflixreborn.streamflix.ui

import android.content.Context
import android.util.AttributeSet
import android.view.KeyEvent
import android.widget.Toast
import androidx.media3.common.Player
import androidx.media3.ui.PlayerControlView
import androidx.media3.ui.PlayerView
import com.streamflixreborn.streamflix.R
import java.util.Locale

class PlayerTvView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyle: Int = 0
) : PlayerView(context, attrs, defStyle) {

    val controller: PlayerControlView
        get() = PlayerView::class.java.getDeclaredField("controller").let {
            it.isAccessible = true
            it.get(this) as PlayerControlView
        }

    var isManualZoomEnabled: Boolean = false
        private set

    var onMediaPreviousClicked: (() -> Boolean)? = null
    var onMediaNextClicked: (() -> Boolean)? = null

    private var zoomToast: Toast? = null

    override fun onFinishInflate() {
        super.onFinishInflate()
        findViewById<android.view.View>(R.id.btn_exo_subtitles)?.setOnClickListener {
            openSettingsSection(com.streamflixreborn.streamflix.fragments.player.settings.PlayerSettingsView.Settings.Subtitle)
        }
        findViewById<android.view.View>(R.id.btn_exo_audio)?.setOnClickListener {
            openSettingsSection(com.streamflixreborn.streamflix.fragments.player.settings.PlayerSettingsView.Settings.Audio)
        }
        findViewById<android.view.View>(R.id.btn_exo_guide)?.setOnClickListener {
            com.streamflixreborn.streamflix.charm.VodHostActions.openGuide?.invoke()
        }
        // Showing the controls only requests a layout. Inside the embedded VOD
        // host that request can stop at an ancestor and never run: the controls
        // were VISIBLE but 0x0 (seen on device), so they "never came back".
        setControllerVisibilityListener(ControllerVisibilityListener { visibility ->
            if (visibility == android.view.View.VISIBLE) scheduleLayoutPass()
        })
    }

    private var layoutPassPosted = false
    private val layoutPass = Runnable {
        layoutPassPosted = false
        // Lay out the whole player page (controls, settings panel, overlays)
        // at its current size. A cheap exact measure; never changes the size.
        val page = parent as? android.view.View ?: this
        if (!page.isAttachedToWindow || page.width <= 0 || page.height <= 0) return@Runnable
        page.measure(
            MeasureSpec.makeMeasureSpec(page.width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(page.height, MeasureSpec.EXACTLY),
        )
        page.layout(page.left, page.top, page.right, page.bottom)
    }

    /** Runs one layout pass on the next frame (coalesced). */
    fun scheduleLayoutPass() {
        if (layoutPassPosted) return
        layoutPassPosted = true
        post(layoutPass)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(layoutPass)
        layoutPassPosted = false
        super.onDetachedFromWindow()
    }

    /** Opens the existing settings panel and steps straight into one of its sections. */
    private fun openSettingsSection(section: com.streamflixreborn.streamflix.fragments.player.settings.PlayerSettingsView.Settings) {
        findViewById<android.view.View>(androidx.media3.ui.R.id.exo_settings)?.performClick()
        val panel = (parent as? android.view.ViewGroup)?.findViewById<android.view.View>(R.id.settings) ?: return
        val index = com.streamflixreborn.streamflix.fragments.player.settings.PlayerSettingsView.Settings.listTv.indexOf(section)
        if (index < 0) return
        val list = panel.findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.rv_settings) ?: return
        var attempts = 0
        fun press() {
            val row = list.findViewHolderForAdapterPosition(index)?.itemView
            when {
                row != null -> row.performClick()
                ++attempts < 12 -> list.postDelayed({ press() }, 40L)
            }
        }
        list.post { press() }
    }

    override fun setPlayer(player: Player?) {
        super.setPlayer(player)
        if (player == null) {
            com.streamflixreborn.streamflix.charm.VodSourceRequest.pending = false
            com.streamflixreborn.streamflix.charm.VodSourceRequest.chosen = null
            return
        }
        if (!com.streamflixreborn.streamflix.charm.VodSourceRequest.pending) return
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState != Player.STATE_READY) return
                player.removeListener(this)
                if (com.streamflixreborn.streamflix.charm.VodSourceRequest.take()) {
                    findViewById<android.view.View>(R.id.btn_exo_sources)?.performClick()
                }
            }
        })
    }

    fun enterManualZoomMode() {
        player?.pause()
        isManualZoomEnabled = true
        showZoomToast(context.getString(R.string.player_manual_zoom_hint), Toast.LENGTH_LONG)
    }

    fun exitManualZoomMode() {
        isManualZoomEnabled = false
        videoSurfaceView?.apply {
            scaleX = 1f
            scaleY = 1f
        }
        zoomToast?.cancel()
        player?.play()
    }

    private fun showZoomToast(message: String, duration: Int = Toast.LENGTH_SHORT) {
        zoomToast?.cancel()
        zoomToast = Toast.makeText(context, message, duration)
        zoomToast?.show()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Whatever this key opened (controls, settings panel, a pop-up) gets
        // laid out on the next frame even if its layout request was swallowed.
        if (event.action == KeyEvent.ACTION_UP) scheduleLayoutPass()
        if (isManualZoomEnabled) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                // RIPRISTINATA LOGICA ORIGINALE: Scaliamo solo il videoSurfaceView.
                // Grazie all'uso di texture_view nel layout, ora le modifiche sono visibili in tempo reale anche in pausa.
                val videoView = videoSurfaceView ?: return true
                when (event.keyCode) {
                    KeyEvent.KEYCODE_DPAD_UP -> {
                        videoView.scaleY += 0.01f
                        showZoomToast("Zoom Y: ${String.format(Locale.US, "%.2f", videoView.scaleY)}")
                    }
                    KeyEvent.KEYCODE_DPAD_DOWN -> {
                        videoView.scaleY -= 0.01f
                        showZoomToast("Zoom Y: ${String.format(Locale.US, "%.2f", videoView.scaleY)}")
                    }
                    KeyEvent.KEYCODE_DPAD_LEFT -> {
                        videoView.scaleX -= 0.01f
                        showZoomToast("Zoom X: ${String.format(Locale.US, "%.2f", videoView.scaleX)}")
                    }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        videoView.scaleX += 0.01f
                        showZoomToast("Zoom X: ${String.format(Locale.US, "%.2f", videoView.scaleX)}")
                    }
                    KeyEvent.KEYCODE_BACK -> {
                        exitManualZoomMode()
                    }
                }
            }
            return true
        }

        val player = player ?: return super.dispatchKeyEvent(event)

        when (event.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                return if (event.action == KeyEvent.ACTION_DOWN) {
                    onMediaPreviousClicked?.invoke() ?: false
                } else {
                    true
                }
            }

            KeyEvent.KEYCODE_MEDIA_NEXT -> {
                return if (event.action == KeyEvent.ACTION_DOWN) {
                    onMediaNextClicked?.invoke() ?: false
                } else {
                    true
                }
            }
        }

        if (player.isCommandAvailable(Player.COMMAND_GET_CURRENT_MEDIA_ITEM) && player.isPlayingAd) {
            return super.dispatchKeyEvent(event)
        }

        if (controller.isVisible) return super.dispatchKeyEvent(event)

        return when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                if (event.action == KeyEvent.ACTION_DOWN) {
                    player.seekTo(player.currentPosition - 10_000)
                }
                true
            }

            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                if (event.action == KeyEvent.ACTION_DOWN) {
                    player.seekTo(player.currentPosition + 10_000)
                }
                true
            }
            else -> super.dispatchKeyEvent(event)
        }
    }
}
