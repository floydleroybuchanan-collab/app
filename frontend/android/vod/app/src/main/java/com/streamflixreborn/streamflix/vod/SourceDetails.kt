package com.streamflixreborn.streamflix.vod

import java.io.Serializable
import java.util.Locale

/** Filename hints are not proof of codec support. Confirmed tracks supersede these hints. */
data class SourceDetails(
    val kind: Kind = Kind.DIRECT,
    val release: String = "",
    val infoHash: String? = null,
    val fileIndex: Int? = null,
    val cloudTorrentId: String? = null,
    val availability: Availability = Availability.UNKNOWN,
    val height: Int? = null,
    val codec: String? = null,
    val hdr: String? = null,
    val audio: String? = null,
    val bytes: Long? = null,
    val filename: String? = null,
    val detected: Boolean = false,
) : Serializable {
    enum class Kind { DIRECT, REAL_DEBRID }
    enum class Availability { UNKNOWN, READY, PREPARING, UNAVAILABLE }
    val badges: String get() = listOfNotNull(
        height?.let { if (it == 2160) "4K" else "${it}p" }, codec, hdr, audio,
        if (detected) "Detected during playback" else null,
        bytes?.takeIf { it > 0 }?.let { String.format(Locale.US, "%.1f GB", it / 1_000_000_000.0) },
        if (kind == Kind.REAL_DEBRID) when (availability) {
            Availability.READY -> "Ready in your cloud"
            Availability.PREPARING -> "Preparing"
            Availability.UNAVAILABLE -> "Unavailable"
            Availability.UNKNOWN -> "Availability unverified"
        } else null,
    ).joinToString(" · ")

    companion object {
        fun parse(text: String): SourceDetails {
            val s = text.lowercase(Locale.ROOT)
            return SourceDetails(
                release = text,
                height = Regex("(?<![0-9])(2160|1440|1080|720|480)p").find(s)?.groupValues?.get(1)?.toInt()
                    ?: if (Regex("\\b4k\\b").containsMatchIn(s)) 2160 else null,
                codec = when {
                    Regex("\\b(av1|av01)\\b").containsMatchIn(s) -> "AV1"
                    Regex("\\b(hevc|[hx][ ._-]?265)\\b").containsMatchIn(s) -> "HEVC"
                    Regex("\\b(avc|[hx][ ._-]?264)\\b").containsMatchIn(s) -> "H.264"
                    else -> null
                },
                hdr = when {
                    Regex("\\b(dovi|dv|dolby[ ._-]?vision)\\b").containsMatchIn(s) -> "Dolby Vision"
                    s.contains("hdr10+") -> "HDR10+"
                    s.contains("hdr") -> "HDR"
                    else -> null
                },
                audio = when {
                    s.contains("atmos") -> "Atmos"
                    s.contains("truehd") -> "TrueHD"
                    s.contains("dts") -> "DTS"
                    Regex("\\b(eac3|e-ac-3|ddp)\\b").containsMatchIn(s) -> "E-AC-3"
                    s.contains("aac") -> "AAC"
                    else -> null
                },
            )
        }
    }
}
