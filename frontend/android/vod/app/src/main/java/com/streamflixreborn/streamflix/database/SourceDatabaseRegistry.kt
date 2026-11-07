package com.streamflixreborn.streamflix.database

import java.lang.ref.WeakReference

/** Navigation owns wrappers; this registry only reuses live source identities. */
internal class SourceDatabaseRegistry<T : Any> {
    private val entries = mutableMapOf<String, WeakReference<T>>()

    @Synchronized
    fun get(source: String, create: () -> T): T {
        entries.entries.removeAll { it.value.get() == null }
        return entries[source]?.get() ?: create().also { entries[source] = WeakReference(it) }
    }

    /** Destructive database restore only, never ordinary source selection. */
    @Synchronized
    fun clear(close: (T) -> Unit) {
        entries.values.mapNotNull { it.get() }.forEach(close)
        entries.clear()
    }
}
