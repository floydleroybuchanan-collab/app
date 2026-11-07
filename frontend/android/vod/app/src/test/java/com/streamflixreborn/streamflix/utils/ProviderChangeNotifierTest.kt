package com.streamflixreborn.streamflix.utils

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Test

class ProviderChangeNotifierTest {
    @Test fun oneInvalidationReachesEveryExistingCollector() = runBlocking {
        val home = async(start = CoroutineStart.UNDISPATCHED) { ProviderChangeNotifier.providerChangeFlow.first(); "home" }
        val movies = async(start = CoroutineStart.UNDISPATCHED) { ProviderChangeNotifier.providerChangeFlow.first(); "movies" }
        ProviderChangeNotifier.notifyProviderChanged()
        withTimeout(1000) {
            assertEquals("home", home.await())
            assertEquals("movies", movies.await())
        }
    }
}
