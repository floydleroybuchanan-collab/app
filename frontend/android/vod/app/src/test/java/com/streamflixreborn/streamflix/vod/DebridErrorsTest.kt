package com.streamflixreborn.streamflix.vod

import org.junit.Assert.*
import org.junit.Test

class DebridErrorsTest {
    @Test fun missingCloudRecordsCanBeRecreatedButBlockedFilesCannot() {
        assertTrue(DebridErrors.missingCloudItem(404, 0))
        assertTrue(DebridErrors.missingCloudItem(400, 7))
        for (code in listOf(24, 28, 35, 20, 22, 34)) {
            assertFalse("Never recreate service error $code", DebridErrors.missingCloudItem(404, code))
        }
        for (http in listOf(401, 403, 410, 429, 503)) assertFalse(DebridErrors.missingCloudItem(http, 0))
    }

    @Test fun serviceErrorsAreMoreSpecificThanGenericHttpErrors() {
        assertTrue(DebridErrors.message(404, 28).contains("does not allow"))
        assertTrue(DebridErrors.message(404, 35).contains("blocked"))
        assertTrue(DebridErrors.message(404, 24).contains("file is unavailable"))
        assertTrue(DebridErrors.message(404, 0).contains("expired"))
        assertTrue(DebridErrors.message(401, 0).contains("Reconnect"))
    }
}
