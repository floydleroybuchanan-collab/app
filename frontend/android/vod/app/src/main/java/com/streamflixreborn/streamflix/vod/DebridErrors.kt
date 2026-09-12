package com.streamflixreborn.streamflix.vod

internal object DebridErrors {
    fun message(http: Int, code: Int): String = when (code) {
        16 -> "This host is not supported by Real-Debrid. Try the direct source."
        17, 19 -> "This host is temporarily unavailable on Real-Debrid. Try another source."
        18, 21, 23, 36 -> "Your Real-Debrid traffic or download limit has been reached."
        20 -> "This source requires Real-Debrid Premium."
        22 -> "Real-Debrid did not allow this network address."
        24, 28, 35 -> "This file is unavailable on Real-Debrid. Choose another source."
        5, 34 -> "Real-Debrid is busy. Wait before trying again."
        else -> when (http) {
            401 -> "Real-Debrid login expired or was revoked. Reconnect in VOD Settings."
            403 -> "Real-Debrid denied access. Check your account and premium status."
            429 -> "Real-Debrid is busy. Wait before trying again."
            else -> "Real-Debrid could not complete this request (HTTP " + http + ")."
        }
    }
}
