package com.streamflixreborn.streamflix.utils

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class BoundedProviderCacheTest {
    @Test fun recentlyUsedEntrySurvivesCapacityEvictionAndCallerKeepsItsValue() {
        val cache = BoundedProviderCache<String, String>(2, 1000) { 0 }
        cache["a"] = "first"
        cache["b"] = "second"
        val published = cache["a"]
        cache["c"] = "third"
        assertEquals("first", cache["a"])
        assertNull(cache["b"])
        cache.clear()
        assertEquals("first", published)
        assertEquals(0, cache.size())
    }
    @Test fun unrelatedAccessSweepsExpiredEntriesAndReloadReplacesThem() {
        var time = 0L
        val cache = BoundedProviderCache<String, String>(10, 100) { time }
        cache["a"] = "old"
        time = 100
        cache["b"] = "fresh"
        assertEquals(1, cache.size())
        assertNull(cache["a"])
        cache["a"] = "reloaded"
        assertEquals("reloaded", cache["a"])
    }
    @Test fun concurrentReadersAndWritersKeepTheBound() {
        val cache = BoundedProviderCache<Int, Int>(24, 60_000)
        val executor = Executors.newFixedThreadPool(4)
        try {
            val futures = (0..3).map { worker -> executor.submit {
                repeat(500) { index ->
                    val key = worker * 500 + index
                    cache[key] = key
                    cache[key]
                    cache.remove(key - 1)
                }
            } }
            futures.forEach { it.get(10, TimeUnit.SECONDS) }
            assertTrue(cache.size() <= 24)
        } finally { executor.shutdownNow() }
    }
    @Test fun directLookupRejectsExpiryBetweenBulkSweeps() {
        var time = 0L
        val cache = BoundedProviderCache<String, String>(10, 1500) { time }
        cache["a"] = "old"
        time = 1000
        cache["b"] = "new" // Sweeps, but a is not expired yet.
        time = 1500 // Next bulk sweep is not due until2000.
        assertNull(cache["a"])
        assertEquals("new", cache["b"])
    }
}
