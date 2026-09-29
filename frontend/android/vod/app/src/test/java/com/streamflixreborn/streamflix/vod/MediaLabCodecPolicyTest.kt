package com.streamflixreborn.streamflix.vod
import com.streamflixreborn.streamflix.charm.MediaLabCodecPolicy
import org.junit.Assert.*
import org.junit.Test
class MediaLabCodecPolicyTest {
    @Test fun affectedTvHardwareKeepsCompatibility() {
        assertTrue(MediaLabCodecPolicy.needsSynchronousCodec("ONN", "Walmart", "amlogic", "Google TV"))
        assertTrue(MediaLabCodecPolicy.needsSynchronousCodec("Amazon", "Amazon", "meson", "AFT"))
    }
    @Test fun otherDevicesUsePlatformDefaults() {
        assertFalse(MediaLabCodecPolicy.needsSynchronousCodec("Google", "google", "tensor", "Pixel"))
        assertFalse(MediaLabCodecPolicy.needsSynchronousCodec("Samsung", "samsung", "qcom", "Galaxy"))
        assertFalse(MediaLabCodecPolicy.needsSynchronousCodec("NVIDIA", "nvidia", "tegra", "SHIELD"))
        assertFalse(MediaLabCodecPolicy.needsSynchronousCodec("", "", "", ""))
    }
}
