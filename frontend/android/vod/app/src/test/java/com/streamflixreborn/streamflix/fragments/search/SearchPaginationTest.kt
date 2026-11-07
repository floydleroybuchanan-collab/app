package com.streamflixreborn.streamflix.fragments.search

import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow
import org.junit.Assert.*
import org.junit.Test

class SearchPaginationTest {
    @Test fun repeatingProviderPageStopsRatherThanRequestingForever() {
        val first = Movie(id = "1", title = "First")
        val page = mergeSearchPage(listOf(first), listOf(first.copy()))
        assertEquals(listOf(first), page.results)
        assertFalse(page.hasMore)
    }
    @Test fun mixedPageKeepsNewResultsAndDistinctMediaTypes() {
        val movie = Movie(id = "1", title = "Movie")
        val show = TvShow(id = "1", title = "Show")
        val page = mergeSearchPage(listOf(movie), listOf(movie.copy(), show, show.copy()))
        assertEquals(listOf(movie, show), page.results)
        assertTrue(page.hasMore)
    }
    @Test fun emptyPageRetainsTheLibraryAndEndsPaging() {
        val movie = Movie(id = "1", title = "Movie")
        val page = mergeSearchPage(listOf(movie), emptyList())
        assertEquals(listOf(movie), page.results)
        assertFalse(page.hasMore)
    }
}
