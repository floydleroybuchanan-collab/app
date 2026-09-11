package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.models.Video
import org.junit.Assert.*
import org.junit.Test

class TorrentFilesTest {
    private val movie = Video.Type.Movie("id", "Movie", "2024", "", "tt123")
    private val episode = Video.Type.Episode("id", 2, "", "", "", Video.Type.Episode.TvShow("show", "Show", "", "", "", "tt123"), Video.Type.Episode.Season(1, ""))
    @Test fun movieDoesNotGuessBetweenSeveralVideos() {
        val files = listOf(TorrentFiles.File(1, "/movie.mkv", 100, true), TorrentFiles.File(2, "/extra.mkv", 50, true))
        assertNull(TorrentFiles.choose(files, null, movie))
        assertEquals(1, TorrentFiles.choose(files, 0, movie)?.id)
    }
    @Test fun packSelectsCorrectEpisodeEvenWhenIndexerPointsAtAnotherOne() {
        val files = listOf(TorrentFiles.File(1, "/Show.S01E01.mkv", 100, true), TorrentFiles.File(2, "/Show.S01E02.mkv", 90, true))
        assertEquals(2, TorrentFiles.choose(files, 0, episode)?.id)
    }
    @Test fun missingEpisodeNeverFallsBackToLargestFile() {
        assertNull(TorrentFiles.choose(listOf(TorrentFiles.File(1, "/Show.S01E20.mkv", 1000, true)), 0, episode))
    }
    @Test fun sampleAndNonVideoAreExcluded() {
        assertNull(TorrentFiles.choose(listOf(TorrentFiles.File(1, "/sample.mkv", 100, true), TorrentFiles.File(2, "/readme.txt", 20, true)), null, movie))
    }
    @Test fun formatHintsRemainDistinctFromAvailability() {
        val details = SourceDetails.parse("Film.2160p.AV1.HDR10+.DTS.mkv")
        assertEquals(2160, details.height)
        assertEquals("AV1", details.codec)
        assertEquals("HDR10+", details.hdr)
        assertEquals(SourceDetails.Availability.UNKNOWN, details.availability)
    }
}
