package com.streamflixreborn.streamflix.fragments.search

import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.providers.IptvProvider
import com.streamflixreborn.streamflix.providers.TmdbProvider
import org.junit.Assert.*
import org.junit.Test

class SearchCatalogTest {
    private open class Catalog(override val name: String, override val language: String = "en") : Provider by TmdbProvider(language)
    private class Channels : Catalog("Channels"), IptvProvider

    @Test fun globalSearchIncludesTheBrowseCatalogOnce() {
        val current = TmdbProvider("en")
        val targets = SearchCatalog.targets(current, "en", listOf(Catalog("Other"), Catalog("French", "fr"), Channels()))
        assertEquals(listOf("TMDb (en)", "Other"), targets.map { it.name })
        assertSame(current, targets.first())
    }

    @Test fun globalSearchCanReturnToCatalogAfterOpeningAnotherProvider() {
        val other = Catalog("Other")
        val targets = SearchCatalog.targets(other, "en", listOf(other))
        assertEquals(listOf("Other", "TMDb (en)"), targets.map { it.name })
        val restored = SearchCatalog.resolve("TMDb (en)", listOf(other))
        assertTrue(restored is TmdbProvider)
        assertEquals("en", restored?.language)
        assertSame(other, SearchCatalog.resolve("Other", listOf(other)))
        assertNull(SearchCatalog.resolve("Unknown", listOf(other)))
    }

    @Test fun channelSearchDoesNotMixMovieCatalogs() {
        val current = Channels()
        assertEquals(listOf(current), SearchCatalog.targets(current, "en", listOf(current, Catalog("Other"))))
    }

    @Test fun brandingChangesOnlyTheVisibleLabel() {
        val original = "Streamflix (en)"
        assertEquals("Charming MediaLab (en)", SearchCatalog.displayName(original))
        assertEquals("Charming MediaLab", SearchCatalog.displayName("TMDb (en)"))
        assertEquals("Other", SearchCatalog.displayName("Other"))
        assertEquals("Streamflix (en)", original)
    }
}
