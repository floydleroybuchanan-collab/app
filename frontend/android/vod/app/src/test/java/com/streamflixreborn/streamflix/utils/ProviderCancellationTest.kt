package com.streamflixreborn.streamflix.utils

import kotlinx.coroutines.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

class ProviderCancellationTest {
    @Test fun cancellationCannotBecomeAnEmptyProviderFallback() {
        val cancellation = CancellationException("Screen left")
        try {
            providerRunCatching<String> { throw cancellation }.getOrDefault("fallback")
            fail("Provider cancellation must propagate to its screen owner")
        } catch (actual: CancellationException) {
            assertSame(cancellation, actual)
        }
    }

    @Test fun ordinarySourceFailureStillAllowsTheNextSource() {
        val failure = IOException("Source unavailable")
        val result = providerRunCatching<String> { throw failure }
        assertSame(failure, result.exceptionOrNull())
        assertEquals("next", result.getOrDefault("next"))
    }

    @Test fun successfulSourceResultIsRetained() {
        assertEquals("stream", providerRunCatching { "stream" }.getOrThrow())
    }
}
