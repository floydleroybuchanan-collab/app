package com.streamflixreborn.streamflix.vod

internal object DebridErrors {
    fun missingCloudItem(http: Int, code: Int) = code == 7 || (code == 0 && http == 404)

    fun message(http: Int, code: Int): String = when (code) {
        16 -> "This host is not supported by Real-Debrid. Try the direct source."
        17, 19 -> "This host is temporarily unavailable on Real-Debrid. Try another source."
        18, 21, 23, 36 -> "Your Real-Debrid traffic or download limit has been reached."
        20 -> "This source requires Real-Debrid Premium."
        22 -> "Real-Debrid did not allow this network address."
        24 -> "This file is unavailable on Real-Debrid. Choose another source."
        28 -> "Real-Debrid does not allow this file. Choose another source."
        35 -> "Real-Debrid has blocked this file following an infringement report."
        7 -> "This Real-Debrid item no longer exists. Select the source again."
        25 -> "Real-Debrid is temporarily unavailable. Try again later."
        5, 34 -> "Real-Debrid is busy. Wait before trying again."
        else -> when (http) {
            401 -> "Real-Debrid login expired or was revoked. Reconnect in VOD Settings."
            403 -> "Real-Debrid denied access. Check your account and premium status."
            404, 410 -> "This playback link or cloud item has expired or been removed. Select the source again."
            429 -> "Real-Debrid is busy. Wait before trying again."
            else -> "Real-Debrid could not complete this request (HTTP " + http + ")."
        }
    }
}
