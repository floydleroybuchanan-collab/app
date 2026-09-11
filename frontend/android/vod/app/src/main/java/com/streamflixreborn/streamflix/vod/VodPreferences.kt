package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.StreamFlixApp

object VodPreferences {
    private val prefs get() = StreamFlixApp.instance.getSharedPreferences("charm-vod-playback", 0)
    var chooseFirst: Boolean
        get() = prefs.getBoolean("choose-first", false)
        set(value) { prefs.edit().putBoolean("choose-first", value).apply() }
    var debridSearch: Boolean
        get() = prefs.getBoolean("debrid-search", true)
        set(value) { prefs.edit().putBoolean("debrid-search", value).apply() }
    var engine: String
        get() = prefs.getString("engine", "media3") ?: "media3"
        set(value) { prefs.edit().putString("engine", value).apply() }
}
