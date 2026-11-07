package com.streamflixreborn.streamflix.charm

import org.junit.Assert.*
import org.junit.Test

class CharmPlaybackCoreTest {
    @Test fun liveProfilesKeepStartupWithinTheirBoundedWindow() {
        for (lowRam in listOf(false, true)) {
            for (profile in listOf("low_latency", "balanced", "stable", "unknown")) {
                val durations = CharmPlaybackCore.liveDurations(profile, lowRam)
                assertTrue(durations[1] >= durations[0])
                assertTrue(durations[0] >= durations[2])
                assertTrue(durations[0] >= durations[3])
                assertTrue(durations[1] <= if (lowRam) 15_000 else 30_000)
            }
        }
    }
    @Test fun smallDevicesHaveSmallerAllocationBudget() {
        assertEquals(16 * 1024 * 1024, CharmPlaybackCore.bufferBytes(true))
        assertEquals(48 * 1024 * 1024, CharmPlaybackCore.bufferBytes(false))
    }
}
