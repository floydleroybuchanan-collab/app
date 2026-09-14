package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.util.AtomicFile
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.AudioOffloadSupport
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.io.File

/** Device-local preference, read afresh by both the Live TV and VOD processes. */
object CharmAudioOutput {
    private fun file(context: Context) = AtomicFile(File(context.filesDir, "charm-audio-output"))
    fun mode(context: Context): String = try {
        if (file(context).openRead().use { it.readBytes().toString(Charsets.UTF_8) } == "stereo") "stereo" else "auto"
    } catch (_: Exception) { "auto" }
    fun setMode(context: Context, mode: String) {
        require(mode == "auto" || mode == "stereo")
        val target = file(context)
        val stream = target.startWrite()
        try { stream.write(mode.toByteArray(Charsets.UTF_8)); target.finishWrite(stream) }
        catch (failure: Exception) { target.failWrite(stream); throw failure }
    }
    fun matrix(channels: Int): ChannelMixingMatrix {
        val matrix = when (channels) {
            // Explicit input-row order: Media3 1.8's default surround factory
            // supplies output-row coefficients, which misroutes center audio.
            3 -> ChannelMixingMatrix(3, 2, floatArrayOf(1f,0f, 0f,1f, .7071f,.7071f))
            4 -> ChannelMixingMatrix(4, 2, floatArrayOf(1f,0f, 0f,1f, .7071f,0f, 0f,.7071f))
            5 -> ChannelMixingMatrix(5, 2, floatArrayOf(1f,0f, 0f,1f, .7071f,.7071f, .7071f,0f, 0f,.7071f))
            6 -> ChannelMixingMatrix(6, 2, floatArrayOf(1f,0f, 0f,1f, .7071f,.7071f, .5f,.5f, .7071f,0f, 0f,.7071f))
            7 -> ChannelMixingMatrix(7, 2, floatArrayOf(1f,0f, 0f,1f, .7071f,.7071f, .5f,.5f, .5f,.5f, .7071f,0f, 0f,.7071f))
            8 -> ChannelMixingMatrix(8, 2, floatArrayOf(1f,0f, 0f,1f, .7071f,.7071f, .5f,.5f, .7071f,0f, 0f,.7071f, .7071f,0f, 0f,.7071f))
            else -> ChannelMixingMatrix.createForConstantPower(channels, 2)
        }
        // Keep full-scale center/surround samples from clipping when summed.
        var maximum = 1f
        for (output in 0..1) {
            var sum = 0f
            for (input in 0 until channels) sum += matrix.getMixingCoefficient(input, output)
            maximum = maxOf(maximum, sum)
        }
        return matrix.scaleBy(1f / maximum)
    }
}

/** Explicit compatibility option; default audio and all video behavior are preserved. */
open class CharmAudioRenderersFactory(context: Context) : DefaultRenderersFactory(context) {
    private val stereo = CharmAudioOutput.mode(context) == "stereo"
    init { if (stereo) setExtensionRendererMode(EXTENSION_RENDERER_MODE_PREFER) }
    override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink? {
        if (!stereo) return super.buildAudioSink(context, enableFloatOutput, enableAudioTrackPlaybackParams)
        val mixer = ChannelMixingAudioProcessor()
        for (channels in 1..8) mixer.putChannelMixingMatrix(CharmAudioOutput.matrix(channels))
        val sink = DefaultAudioSink.Builder(context).setEnableFloatOutput(false)
            .setEnableAudioTrackPlaybackParams(false).setAudioProcessors(arrayOf(mixer)).build()
        // Compressed passthrough/offload bypasses PCM processors. Require decode
        // first so AC3/EAC3/AAC center and surround channels reach the stereo mix.
        return object : ForwardingAudioSink(sink) {
            override fun supportsFormat(format: Format) = getFormatSupport(format) != AudioSink.SINK_FORMAT_UNSUPPORTED
            override fun getFormatSupport(format: Format): Int = if (format.sampleMimeType == MimeTypes.AUDIO_RAW) super.getFormatSupport(format) else AudioSink.SINK_FORMAT_UNSUPPORTED
            override fun getFormatOffloadSupport(format: Format): AudioOffloadSupport = AudioOffloadSupport.DEFAULT_UNSUPPORTED
        }
    }
}
