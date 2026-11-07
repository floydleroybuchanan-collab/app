package com.streamflixreborn.streamflix.utils

/** Reloadable lookups only: eviction never removes saved history or published catalog rows. */
internal class BoundedProviderCache<K, V>(
    private val maxEntries: Int,
    private val ttlMillis: Long,
    private val clock: () -> Long = { System.nanoTime() / 1_000_000 }
) {
    private data class Entry<V>(val value: V, val writtenAt: Long)
    private val entries = LinkedHashMap<K, Entry<V>>(16, 0.75f, true)
    private var lastSweepAt: Long? = null

    init { require(maxEntries > 0 && ttlMillis > 0) }

    private fun expire(now: Long, force: Boolean = false) {
        val previous = lastSweepAt
        if (!force && previous != null && now >= previous && now - previous < minOf(ttlMillis, 1000L)) return
        lastSweepAt = now
        val iterator = entries.values.iterator()
        while (iterator.hasNext()) {
            val age = now - iterator.next().writtenAt
            if (age >= ttlMillis || age < 0) iterator.remove()
        }
    }

    @Synchronized operator fun get(key: K): V? {
        val now = clock()
        expire(now)
        val entry = entries[key] ?: return null
        // Direct lookup always validates expiry, even between periodic bulk sweeps.
        val age = now - entry.writtenAt
        if (age >= ttlMillis || age < 0) { entries.remove(key); return null }
        return entry.value
    }

    @Synchronized operator fun set(key: K, value: V) {
        val now = clock()
        expire(now)
        entries[key] = Entry(value, now)
        while (entries.size > maxEntries) {
            val iterator = entries.entries.iterator()
            iterator.next()
            iterator.remove()
        }
    }

    @Synchronized fun remove(key: K): V? = entries.remove(key)?.value
    @Synchronized fun clear() { entries.clear(); lastSweepAt = null }
    @Synchronized fun size(): Int { expire(clock(), force = true); return entries.size }
}
