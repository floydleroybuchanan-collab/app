package com.streamflixreborn.streamflix.charm

object MediaLabCodecPolicy {
    fun needsSynchronousCodec(manufacturer: String, brand: String, hardware: String, model: String): Boolean {
        val identity = listOf(manufacturer, brand, hardware, model).joinToString(" ").lowercase(java.util.Locale.ROOT)
        return Regex("\\b(onn|walmart|amlogic|meson)\\b").containsMatchIn(identity)
    }
}
