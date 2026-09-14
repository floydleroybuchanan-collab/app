package com.streamflixreborn.streamflix.charm

import org.junit.Assert.*
import org.junit.Test

class CharmAudioOutputTest {
    @Test fun surroundMixRetainsDialogueAndEveryInputChannelWithoutClipping() {
        for (channels in 3..8) {
            val matrix = CharmAudioOutput.matrix(channels)
            assertEquals(2, matrix.outputChannelCount)
            for (input in 0 until channels) {
                assertTrue("Dropped input channel $input of $channels", matrix.getMixingCoefficient(input, 0) + matrix.getMixingCoefficient(input, 1) > 0f)
            }
            for (output in 0..1) {
                var fullScale = 0f
                for (input in 0 until channels) fullScale += matrix.getMixingCoefficient(input, output)
                assertTrue("Summed samples clip", fullScale <= 1.00001f)
            }
            if (channels != 4) {
                assertTrue(matrix.getMixingCoefficient(2, 0) > 0)
                assertEquals(matrix.getMixingCoefficient(2, 0), matrix.getMixingCoefficient(2, 1), 0.00001f)
            }
        }
    }
    @Test fun stereoChannelsStayIndependent() {
        val matrix = CharmAudioOutput.matrix(2)
        assertTrue(matrix.isIdentity)
        assertEquals(0f, matrix.getMixingCoefficient(0, 1), 0f)
        assertEquals(0f, matrix.getMixingCoefficient(1, 0), 0f)
    }
}
