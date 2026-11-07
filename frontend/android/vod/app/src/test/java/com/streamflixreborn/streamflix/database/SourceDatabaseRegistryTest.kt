package com.streamflixreborn.streamflix.database

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class SourceDatabaseRegistryTest {
    private class Database(val source: String) {
        var closed = false
        val saved = mutableListOf<String>()
    }

    @Test fun crossProviderDetailAndBackRetainSourceAndSavedData() {
        val cache = SourceDatabaseRegistry<Database>()
        val a = cache.get("A") { Database("A") }
        a.saved.add("favorite")
        val b = cache.get("B") { Database("B") }
        b.saved.add("different favorite")
        val restored = cache.get("A") { error("retained search database was replaced") }
        assertSame(a, restored)
        assertNotSame(a, b)
        assertFalse(a.closed)
        assertEquals(listOf("favorite"), restored.saved)
        assertEquals(listOf("different favorite"), b.saved)
    }

    @Test fun simultaneousSourceRequestsShareOneWrapper() {
        val cache = SourceDatabaseRegistry<Database>()
        val created = AtomicInteger()
        val pool = Executors.newFixedThreadPool(4)
        try {
            val results = pool.invokeAll((1..24).map { Callable {
                cache.get("A") { created.incrementAndGet(); Database("A") }
            } }).map { it.get() }
            assertEquals(1, created.get())
            results.forEach { assertSame(results.first(), it) }
        } finally { pool.shutdownNow() }
    }

    @Test fun explicitRestoreClosesAllWrappersAndReacquiresCleanly() {
        val cache = SourceDatabaseRegistry<Database>()
        val a = cache.get("A") { Database("A") }
        val b = cache.get("B") { Database("B") }
        cache.clear { it.closed = true }
        assertTrue(a.closed)
        assertTrue(b.closed)
        assertNotSame(a, cache.get("A") { Database("A") })
    }
}
