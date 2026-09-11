package com.streamflixreborn.streamflix.vod

import android.media.MediaCodecList
import android.os.Build

/** A decoder listing is a capability hint, not proof of profile, bitrate, HDR or display support. */
object DeviceCompatibility {
    private val decoders by lazy {
        runCatching { MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.filter { !it.isEncoder } }
            .getOrDefault(emptyList())
    }
    fun badge(details: SourceDetails?): String {
        val mime = when (details?.codec) {
            "HEVC" -> "video/hevc"
            "AV1" -> "video/av01"
            "H.264" -> "video/avc"
            else -> return "Format checked during playback"
        }
        val matching = decoders.filter { it.supportedTypes.any { t -> t.equals(mime, true) } }
        if (matching.isEmpty()) return "No Android decoder reported"
        val hardware = matching.any {
            if (Build.VERSION.SDK_INT >= 29) it.isHardwareAccelerated
            else !it.name.startsWith("OMX.google.") && !it.name.startsWith("c2.android.")
        }
        return if (hardware) "Hardware decoder reported · profile unverified" else "Software decoding · may be slower"
    }
    fun rank(details: SourceDetails?): Int {
        val badge = badge(details)
        return (if (badge.startsWith("No Android")) 100 else if (badge.startsWith("Software")) 50 else 0) +
            (if (details?.hdr != null) 10 else 0) + (if ((details?.height ?: 0) > 1080) 5 else 0)
    }
}
