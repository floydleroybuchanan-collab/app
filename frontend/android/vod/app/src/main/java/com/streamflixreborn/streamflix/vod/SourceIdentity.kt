package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.utils.TMDb3
import com.streamflixreborn.streamflix.utils.UserPreferences
import java.io.IOException
import java.util.Locale

internal object SourceIdentity {
    fun valid(value: String?) = value?.takeIf { it.matches(Regex("tt[0-9]+")) }
    private fun normalized(value: String) = value.lowercase(Locale.ROOT).replace(Regex("[^\\p{L}\\p{N}]"), "")
    suspend fun imdb(type: Video.Type): String {
        valid(when(type) { is Video.Type.Movie -> type.imdbId; is Video.Type.Episode -> type.tvShow.imdbId })?.let { return it }
        if (!UserPreferences.enableTmdb) throw IOException("This title has no IMDb ID. Enable TMDb in Content and Safety to look it up.")
        val title = when(type) { is Video.Type.Movie -> type.title; is Video.Type.Episode -> type.tvShow.title }
        val year = when(type) { is Video.Type.Movie -> type.releaseDate; is Video.Type.Episode -> type.tvShow.releaseDate }?.take(4)?.toIntOrNull()
        val results = TMDb3.Search.multi(title).results
        val id = when(type) {
            is Video.Type.Movie -> {
                val match = results.filterIsInstance<TMDb3.Movie>().filter {
                    listOf(it.title, it.originalTitle).any { candidate -> normalized(candidate) == normalized(title) } &&
                        (year == null || it.releaseDate?.take(4)?.toIntOrNull() == year)
                }.distinctBy { it.id }.singleOrNull()
                    ?: throw IOException("Could not identify this movie uniquely for Real-Debrid search.")
                TMDb3.Movies.details(movieId = match.id, appendToResponse = listOf(TMDb3.Params.AppendToResponse.Movie.EXTERNAL_IDS)).externalIds?.imdbId
            }
            is Video.Type.Episode -> {
                val match = results.filterIsInstance<TMDb3.Tv>().filter {
                    listOf(it.name, it.originalName).any { candidate -> normalized(candidate) == normalized(title) } &&
                        (year == null || it.firstAirDate?.take(4)?.toIntOrNull() == year)
                }.distinctBy { it.id }.singleOrNull()
                    ?: throw IOException("Could not identify this TV show uniquely for Real-Debrid search.")
                TMDb3.TvSeries.details(seriesId = match.id, appendToResponse = listOf(TMDb3.Params.AppendToResponse.Tv.EXTERNAL_IDS)).externalIds?.imdbId
            }
        }
        return valid(id) ?: throw IOException("No IMDb ID is available for this title. Direct sources can still be used.")
    }
}
