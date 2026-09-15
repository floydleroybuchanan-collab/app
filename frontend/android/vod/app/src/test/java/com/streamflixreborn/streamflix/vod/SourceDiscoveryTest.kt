package com.streamflixreborn.streamflix.vod

import org.junit.Assert.*
import org.junit.Test

class SourceDiscoveryTest {
    @Test fun recordedLiveTorrentioResponsesProduceVisibleCachedCandidates() {
        for (name in listOf("spiderman", "lioness-s1e1", "lioness-s2e1")) {
            val body = javaClass.getResource("/discovery/$name.json")!!.readText()
            val rows = SourceDiscovery.parse(body, true)
            assertTrue("$name must have RD candidates", rows.isNotEmpty())
            assertTrue("$name must survive cached-only filtering", rows.any { SourceDiscovery.cached(it.details) })
            assertTrue(rows.all { it.details?.isDebrid == true && it.src.isEmpty() })
            assertFalse(rows.toString().contains("CHARM_NON_SECRET_TEST"))
        }
    }
    private val hash = "a".repeat(40)
    @Test fun configuredCachedResultDoesNotRetainCredentialUrl() {
        val rows = SourceDiscovery.parse("""{"streams":[{"name":"[RD+] Torrentio","title":"Movie.1080p","url":"https://torrentio.strem.fun/realdebrid/SECRET/$hash/null/2/Movie.mkv"}]}""", true)
        assertEquals(1, rows.size)
        assertEquals(2, rows.single().details?.fileIndex)
        assertTrue(SourceDiscovery.cached(rows.single().details))
        assertFalse(rows.single().toString().contains("SECRET"))
        assertEquals("", rows.single().src)
    }
    @Test fun downloadAndUnknownResultsNeverBecomeCached() {
        val rows = SourceDiscovery.parse("""{"streams":[{"name":"[RD Download] Torrentio","infoHash":"$hash","title":"Movie"}]}""", true)
        assertFalse(SourceDiscovery.cached(rows.single().details))
        assertFalse(SourceDiscovery.cached(SourceDetails()))
        assertFalse(SourceDiscovery.cached(null))
    }
    @Test fun publicResponseCannotClaimCachedStatus() {
        val rows = SourceDiscovery.parse("""{"streams":[{"name":"[RD+]","infoHash":"$hash"}]}""", false)
        assertFalse(SourceDiscovery.cached(rows.single().details))
    }
    @Test fun foreignAndMalformedResolveUrlsAreRejected() {
        val rows = SourceDiscovery.parse("""{"streams":[{"name":"[RD+]","url":"https://other.example/realdebrid/SECRET/$hash/null/2"},{"infoHash":"invalid"}]}""", true)
        assertTrue(rows.isEmpty())
    }
    @Test fun duplicateHashAndFileIsCollapsedButDistinctFilesRemain() {
        val rows = SourceDiscovery.parse("""{"streams":[{"infoHash":"$hash","fileIdx":0},{"infoHash":"$hash","fileIdx":0},{"infoHash":"$hash","fileIdx":1}]}""", false)
        assertEquals(2, rows.size)
    }
    @Test fun cloudVerificationCountsAsCached() {
        assertTrue(SourceDiscovery.cached(SourceDetails(availability = SourceDetails.Availability.READY)))
        assertFalse(SourceDiscovery.cached(SourceDetails(availability = SourceDetails.Availability.PREPARING)))
    }
}
