package com.streamflixreborn.streamflix.vod

/** Reject characters that could make HTTP header validation echo a pasted secret. */
internal object DebridInput {
    fun token(value: String): String {
        val token = value.trim()
        require(token.isNotEmpty() && token.length <= 4096 && token.all { it.code in 33..126 }) {
            "Paste only your personal Real-Debrid API token, without spaces or extra text."
        }
        return token
    }
}
