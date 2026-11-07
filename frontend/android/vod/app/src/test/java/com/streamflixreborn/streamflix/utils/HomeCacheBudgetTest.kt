package com.streamflixreborn.streamflix.utils

import com.streamflixreborn.streamflix.providers.Provider
import java.io.File
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [35], application = HomeCacheTestApplication::class)
@org.robolectric.annotation.ConscryptMode(org.robolectric.annotation.ConscryptMode.Mode.OFF)
class HomeCacheBudgetTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun provider(name: String): Provider = Proxy.newProxyInstance(
        Provider::class.java.classLoader, arrayOf(Provider::class.java)
    ) { _, method, _ -> when(method.name) { "getName" -> name; "getBaseUrl" -> ""; else -> null } } as Provider

    @Before fun reset() {
        UserPreferences.setup(context)
        HomeCacheStore.clearDiskCache(context)
    }

    @Test fun memoryPressurePreservesDiskAndSavedData() {
        val source = provider("test")
        val saved = File(context.filesDir, "saved-library.json").apply { writeText("saved") }
        HomeCacheStore.write(context, source, emptyList())
        HomeCacheStore.trimMemory()
        assertNotNull(HomeCacheStore.read(context, source))
        HomeCacheStore.clearDiskCache(context)
        assertEquals("saved", saved.readText())
        assertNull(HomeCacheStore.read(context, source))
    }

    @Test fun olderProvidersAreEvictedFromRamAndCanReloadFromDisk() {
        val sources = (1..3).map { provider("test$it") }
        sources.forEach { HomeCacheStore.write(context, it, emptyList()) }
        // Remove only the first disk fixture. If it was retained indefinitely
        // in RAM this would still return a cached value.
        File(context.filesDir, "home-cache/test1.json").delete()
        assertNull(HomeCacheStore.read(context, sources.first()))
        assertNotNull(HomeCacheStore.read(context, sources.last()))
    }

    @Test fun oversizedAndExpiredCacheAreNotParsed() {
        val file = File(context.filesDir, "home-cache/large.json")
        file.parentFile!!.mkdirs()
        java.io.RandomAccessFile(file, "rw").use { it.setLength(4L * 1024 * 1024 + 1) }
        assertNull(HomeCacheStore.read(context, provider("large")))
        file.writeText("[]")
        file.setLastModified(System.currentTimeMillis() - 7L * 60 * 60 * 1000)
        assertNull(HomeCacheStore.read(context, provider("large")))
    }

    @Test fun oversizedReplacementInvalidatesOldDiskSnapshot() {
        val source=provider("replace")
        HomeCacheStore.write(context,source,emptyList())
        val huge=com.streamflixreborn.streamflix.models.Category(name="x".repeat(4*1024*1024+1),list=emptyList())
        HomeCacheStore.write(context,source,listOf(huge))
        HomeCacheStore.trimMemory()
        assertNull(HomeCacheStore.read(context,source))
    }

    @Test fun memoryTrimDoesNotWaitForDiskWork() {
        val field=HomeCacheStore::class.java.getDeclaredField("ioLock").apply { isAccessible=true }
        val lock=field.get(HomeCacheStore)
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val completed=java.util.concurrent.CountDownLatch(1)
        val worker=Thread { synchronized(lock) { entered.countDown();release.await() } }.apply { start() }
        assertTrue(entered.await(5,java.util.concurrent.TimeUnit.SECONDS))
        val trim=Thread { HomeCacheStore.trimMemory();completed.countDown() }.apply { start() }
        try { assertTrue("Trim must not wait for disk/parser monitor",completed.await(2,java.util.concurrent.TimeUnit.SECONDS)) }
        finally { release.countDown();worker.join(5000);trim.join(5000) }
    }
}


/** Install the context used by provider constructors without starting sync/network jobs. */
class HomeCacheTestApplication : com.streamflixreborn.streamflix.StreamFlixApp() {
    override fun onCreate() {
        com.streamflixreborn.streamflix.StreamFlixApp::class.java.getDeclaredField("instance").apply {
            isAccessible = true
            set(null, this@HomeCacheTestApplication)
        }
        UserPreferences.setup(this)
    }
}
