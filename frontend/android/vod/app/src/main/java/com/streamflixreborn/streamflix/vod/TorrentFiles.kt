package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.models.Video

internal object TorrentFiles {
    data class File(val id: Int, val path: String, val bytes: Long, val selected: Boolean)
    private val video = Regex("\\.(mkv|mp4|avi|mov|m4v|ts|webm|mpg|mpeg)$", RegexOption.IGNORE_CASE)
    fun choose(files: List<File>, index: Int?, type: Video.Type): File? {
        val candidates = files.filter { video.containsMatchIn(it.path) &&
            !Regex("(?i)\\bsample\\b").containsMatchIn(it.path) }
        if (type is Video.Type.Episode) {
            val season = type.season.number
            val episode = type.number
            val marker = Regex("(?i)(?<![a-z0-9])(?:s0*${season}[ ._-]*e0*${episode}|0*${season}x0*${episode})(?![0-9])")
            val matches = candidates.filter { marker.containsMatchIn(it.path.substringAfterLast('/')) }
            // Never select the largest file in a season pack as an episode fallback.
            return matches.singleOrNull() ?: files.getOrNull(index ?: -1)?.takeIf { it in matches }
        }
        files.getOrNull(index ?: -1)?.takeIf { it in candidates }?.let { return it }
        return candidates.singleOrNull()
    }
}
