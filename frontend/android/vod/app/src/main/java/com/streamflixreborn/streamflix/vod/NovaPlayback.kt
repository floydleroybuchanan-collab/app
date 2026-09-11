package com.streamflixreborn.streamflix.vod

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.DialogFragment
import androidx.fragment.app.Fragment
import com.archos.medialib.AvosMediaPlayer
import com.archos.medialib.IMediaPlayer
import com.archos.medialib.LibAvos
import com.streamflixreborn.streamflix.fragments.player.PlayerViewModel
import com.streamflixreborn.streamflix.models.Video
import java.util.concurrent.atomic.AtomicInteger

/** Embedded AVOS playback. Native work is serialized off the UI thread; only one decoder is owned. */
class NovaPlayback : DialogFragment(), SurfaceHolder.Callback {
    private var model: PlayerViewModel? = null
    private var video: Video? = null
    private var server: Video.Server? = null
    private var media3: ((Video, Video.Server, Long) -> Unit)? = null
    private var closed: (() -> Unit)? = null
    private val thread = HandlerThread("Charm-Nova")
    private lateinit var worker: Handler
    private val main = Handler(android.os.Looper.getMainLooper())
    private var native: AvosMediaPlayer? = null
    private var nativeContent: Video.Type? = null
    private lateinit var surface: SurfaceView
    private lateinit var subtitle: TextView
    private lateinit var bitmapSubtitle: ImageView
    private lateinit var status: TextView
    private lateinit var seek: SeekBar
    @Volatile private var position = 0L
    @Volatile private var duration = 0L
    @Volatile private var desiredPlaying = true
    private var surfaceReady = false
    private var started = false
    private var leavingForMedia3 = false
    private var complete = false
    private var cueSequence = 0
    private val revision = AtomicInteger()
    private var audio: AudioManager? = null
    private val focus = AudioManager.OnAudioFocusChangeListener { change ->
        if (change < 0) { desiredPlaying = false; command { it.pause() } }
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        thread.start()
        worker = Handler(thread.looper)
        setStyle(STYLE_NO_TITLE, android.R.style.Theme_Material_NoActionBar_Fullscreen)
    }
    override fun onCreateDialog(state: Bundle?): Dialog {
        val context = requireContext()
        val frame = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
        surface = SurfaceView(context)
        frame.addView(surface, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        surface.holder.addCallback(this)
        bitmapSubtitle = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
        frame.addView(bitmapSubtitle, FrameLayout.LayoutParams(-1, -1))
        subtitle = TextView(context).apply { setTextColor(Color.WHITE); textSize = 22f; gravity = Gravity.CENTER; setShadowLayer(3f, 1f, 1f, Color.BLACK) }
        frame.addView(subtitle, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply { bottomMargin = 180 })
        val controls = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xBB000000.toInt()); setPadding(12, 8, 12, 8) }
        status = TextView(context).apply { setTextColor(Color.WHITE); text = "Nova · Preparing video…"; textSize = 15f }
        controls.addView(status)
        seek = SeekBar(context).apply { max = 1000 }
        controls.addView(seek)
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(bar: SeekBar) {}
            override fun onStopTrackingTouch(bar: SeekBar) { val target = duration * bar.progress / 1000; position = target; command { it.seekTo(target.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()) } }
            override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {}
        })
        val scroll = HorizontalScrollView(context)
        val buttons = LinearLayout(context)
        fun button(text: String, action: () -> Unit) {
            buttons.addView(Button(context).apply { this.text = text; isFocusable = true; setOnClickListener { action() } })
        }
        button("Play / Pause") { desiredPlaying = !desiredPlaying; command { if (desiredPlaying) it.start() else it.pause() } }
        button("−30s") { position = (position - 30_000).coerceAtLeast(0); command { it.seekTo(position.toInt()) } }
        button("+30s") { position = (position + 30_000).coerceAtMost(duration); command { it.seekTo(position.toInt()) } }
        button("Sources") { model?.let { m -> SourcePicker.show(this, m, server?.id) { m.selectSource(it) } } }
        button("Audio") { tracks(false) }
        button("Subtitles") { tracks(true) }
        button("Media3") {
            leavingForMedia3 = true
            val v = video; val s = server
            releaseNative { if (v != null && s != null) main.post { dismissAllowingStateLoss(); media3?.invoke(v, s, position) } }
        }
        button("Close") { dismiss() }
        scroll.addView(buttons); controls.addView(scroll)
        frame.addView(controls, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        return Dialog(context, theme).apply { setContentView(frame); window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
    override fun onStart() {
        super.onStart()
        dialog?.window?.setLayout(-1, -1)
        started = true
        audio = requireContext().getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio?.requestAudioFocus(focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        if (model == null || video == null) { dismissAllowingStateLoss(); return }
        if (surfaceReady) startNative()
    }
    override fun surfaceCreated(holder: SurfaceHolder) { surfaceReady = true; if (started) startNative() }
    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}
    override fun surfaceDestroyed(holder: SurfaceHolder) { surfaceReady = false; releaseNative() }
    private fun command(action: (AvosMediaPlayer) -> Unit) {
        if (!::worker.isInitialized) return
        worker.post { native?.let { runCatching { action(it) } } }
    }
    fun replace(video: Video, server: Video.Server) {
        this.video = video; this.server = server
        if (started && surfaceReady) startNative()
    }
    private fun startNative() {
        val current = video ?: return
        val content = model?.contentType ?: return
        val context = requireContext().applicationContext
        val epoch = revision.incrementAndGet()
        status.text = "Nova · Preparing video…"
        worker.post {
            if (epoch != revision.get()) return@post
            native?.let { previous ->
                runCatching { position = previous.currentPosition.toLong() }
                if (!complete) nativeContent?.let { type -> runCatching { VodHistory.save(type, position, duration) } }
                runCatching { previous.release() }
            }; native = null
            if (nativeContent != null && nativeContent != content) position = VodHistory.resume(content)
            nativeContent = content
            complete = false
            try {
                LibAvos.init(context)
                check(LibAvos.isAvailable()) { "Native playback libraries are unavailable on this device." }
                LibAvos.setDecoder(LibAvos.MP_DECODER_ANY)
                LibAvos.setPassthrough(0)
                LibAvos.setStreamBufferSize(24)
                val player = AvosMediaPlayer()
                native = player
                player.setSurface(surface.holder.surface)
                player.setOnVideoSizeChangedListener(object : IMediaPlayer.OnVideoSizeChangedListener {
                    override fun onVideoSizeChanged(mp: IMediaPlayer, width: Int, height: Int) {
                        if (width > 0 && height > 0) onVideoAspectChanged(mp, width.toDouble() / height)
                    }
                    override fun onVideoAspectChanged(mp: IMediaPlayer, aspect: Double) {
                        main.post {
                            if (epoch != revision.get() || !isAdded || aspect <= 0) return@post
                            val frame = surface.parent as View
                            val width = minOf(frame.width, (frame.height * aspect).toInt())
                            val height = (width / aspect).toInt()
                            surface.layoutParams = android.widget.FrameLayout.LayoutParams(width, height, Gravity.CENTER)
                        }
                    }
                })
                player.setOnPreparedListener {
                    if (epoch == revision.get()) {
                        runCatching {
                            duration = player.duration.toLong()
                            if (position > 0) player.seekTo(position.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
                            if (desiredPlaying) player.start()
                            main.post { if (epoch == revision.get() && isAdded) status.text = "Nova · ${server?.details?.badges.orEmpty()}" }
                            tick(epoch)
                        }.onFailure { main.post { if (epoch == revision.get() && isAdded) status.text = "Nova could not start playback. Try Media3." } }
                    }
                }
                player.setOnCompletionListener {
                    if (epoch == revision.get()) {
                        complete = true
                        runCatching { VodHistory.save(content, duration, duration, true) }
                        main.post { if (epoch == revision.get() && isAdded) { status.text = "Finished"; model?.autoplayNextEpisode() } }
                    }
                }
                player.setOnErrorListener { _, _, _, _ ->
                    main.post { if (epoch == revision.get() && isAdded) {
                        status.text = "This source could not play. Choose another source or Media3."
                        model?.let { if (!it.fallback(server)) SourcePicker.show(this, it, server?.id) { s -> it.selectSource(s) } }
                    } }; true
                }
                player.setOnSubtitleListener { _, cue ->
                    main.post {
                        if (epoch != revision.get() || !isAdded) return@post
                        subtitle.text = if (cue.isText) cue.text else ""
                        bitmapSubtitle.setImageBitmap(if (cue.isBitmap) cue.bitmap else null)
                        if (cue.isBitmap && cue.frameWidth > 0 && cue.frameHeight > 0 && cue.bounds != null) {
                            val bounds = cue.bounds
                            val sx = surface.width.toFloat() / cue.frameWidth
                            val sy = surface.height.toFloat() / cue.frameHeight
                            bitmapSubtitle.layoutParams = FrameLayout.LayoutParams(
                                (bounds.width() * sx).toInt().coerceAtLeast(1),
                                (bounds.height() * sy).toInt().coerceAtLeast(1)).apply {
                                leftMargin = surface.left + (bounds.left * sx).toInt()
                                topMargin = surface.top + (bounds.top * sy).toInt()
                            }
                        }
                        val sequence = ++cueSequence
                        if (cue.duration > 0) main.postDelayed({
                            if (sequence == cueSequence && epoch == revision.get() && isAdded) { subtitle.text = ""; bitmapSubtitle.setImageDrawable(null) }
                        }, cue.duration.toLong())
                    }
                }
                player.setDataSource2(current.source, current.headers ?: emptyMap())
                player.prepareAsync()
            } catch (_: Exception) { main.post { if (isAdded) status.text = "Nova could not open this source. Try Media3." } }
            catch (_: LinkageError) { main.post { if (isAdded) status.text = "Nova could not load on this device. Try Media3." } }
        }
    }
    private fun tick(epoch: Int) {
        worker.postDelayed({
            if (epoch != revision.get()) return@postDelayed
            val p = native ?: return@postDelayed
            runCatching {
                position = p.currentPosition.toLong()
                duration = p.duration.toLong()
                if (!complete) nativeContent?.let { VodHistory.save(it, position, duration) }
            }
            main.post { if (isAdded && duration > 0) seek.progress = (position * 1000 / duration).toInt() }
            tick(epoch)
        }, 5000)
    }
    private fun tracks(subs: Boolean) {
        worker.post {
            val p = native ?: return@post
            val metadata = runCatching { p.getMediaMetadata(false, false) }.getOrNull() ?: return@post
            val countKey = if (subs) IMediaPlayer.METADATA_KEY_NB_SUBTITLE_TRACK else IMediaPlayer.METADATA_KEY_NB_AUDIO_TRACK
            val count = if (metadata.has(countKey)) metadata.getInt(countKey).coerceIn(0, 128) else 0
            val labels = (0 until count).map { i ->
                val key = if (subs) IMediaPlayer.METADATA_KEY_SUBTITLE_TRACK + i * IMediaPlayer.METADATA_KEY_SUBTITLE_TRACK_MAX
                    else IMediaPlayer.METADATA_KEY_AUDIO_TRACK + i * IMediaPlayer.METADATA_KEY_AUDIO_TRACK_MAX
                if (metadata.has(key)) metadata.getString(key) else "Track ${i + 1}"
            }
            main.post { if (isAdded) AlertDialog.Builder(requireContext()).setTitle(if (subs) "Subtitles" else "Audio")
                .setItems((if (subs) listOf("Off") + labels else labels).toTypedArray()) { _, index ->
                    command { current -> if (current === p) { if (subs) current.setSubtitleTrack(index - 1) else current.setAudioTrack(index) } }
                }.setNegativeButton("Close", null).show() }
        }
    }
    private fun releaseNative(after: (() -> Unit)? = null) {
        revision.incrementAndGet()
        worker.post {
            native?.let { p ->
                runCatching {
                    position = p.currentPosition.toLong()
                    if (!complete) nativeContent?.let { VodHistory.save(it, position, p.duration.toLong()) }
                }
                runCatching { p.release() }
            }
            native = null
            after?.invoke()
        }
    }
    override fun onStop() { started = false; releaseNative(); audio?.abandonAudioFocus(focus); super.onStop() }
    override fun onDismiss(dialog: android.content.DialogInterface) { super.onDismiss(dialog); if (!leavingForMedia3) closed?.invoke() }
    override fun onDestroy() { releaseNative { thread.quitSafely() }; main.removeCallbacksAndMessages(null); super.onDestroy() }

    companion object {
        fun show(parent: Fragment, model: PlayerViewModel, video: Video, server: Video.Server, position: Long,
            media3: (Video, Video.Server, Long) -> Unit, closed: () -> Unit) {
            val manager = parent.childFragmentManager
            val existing = manager.findFragmentByTag("charm-nova") as? NovaPlayback
            if (existing != null) { existing.replace(video, server); return }
            NovaPlayback().apply {
                this.model = model; this.video = video; this.server = server
                this.position = if (position > 0) position else VodHistory.resume(model.contentType)
                this.media3 = media3; this.closed = closed
            }.show(manager, "charm-nova")
        }
    }
}
