package com.streamflixreborn.streamflix.charm

import androidx.annotation.DrawableRes
import com.streamflixreborn.streamflix.R

/** Chooses the glass icon that fits a settings button from its name. */
object VodSettingIcons {
    private val rules = listOf(
        Regex("delete|remove|clear|disconnect") to R.drawable.vod_pref_trash,
        Regex("reset|refresh|update|sync|restart") to R.drawable.vod_pref_refresh,
        Regex("import|restore|download") to R.drawable.vod_pref_download,
        Regex("export|backup|upload") to R.drawable.vod_pref_upload,
        Regex("\\bpin\\b|parental|\\block|unlock|\\bage\\b|bypass|security|certificate") to R.drawable.vod_pref_shield,
        Regex("\\bapi\\b|\\bkey\\b|token|licen[cs]e") to R.drawable.vod_pref_key,
        Regex("subtitle|caption|subdl") to R.drawable.vod_pref_subtitles,
        Regex("audio|sound|volume") to R.drawable.vod_pref_audio,
        Regex("buffer|speed|quality") to R.drawable.vod_pref_speed,
        Regex("autoplay|player|playback|\\bplay\\b|decoder|engine|source") to R.drawable.vod_pref_play,
        Regex("theme|appearance|color|colour|scale|layout|padding") to R.drawable.vod_pref_palette,
        Regex("language|\\bdns\\b|\\bdoh\\b|network|proxy|\\bhost\\b|websocket") to R.drawable.vod_pref_globe,
        Regex("\\burl\\b|domain|portal|\\blink\\b") to R.drawable.vod_pref_link,
        Regex("account|\\bsign\\b|\\blogin\\b|\\buser\\b|connection|debrid") to R.drawable.vod_pref_person,
        Regex("cloud|supabase|tmdb") to R.drawable.vod_pref_cloud,
        Regex("provider|\\blist\\b|cache|database|server") to R.drawable.vod_pref_list,
        Regex("about|version|\\binfo\\b|instructions") to R.drawable.vod_pref_info,
    )

    @DrawableRes
    fun forSetting(key: String?, title: CharSequence?): Int {
        val name = "${key.orEmpty().replace('_', ' ')} ${title ?: ""}".lowercase()
        return rules.firstOrNull { it.first.containsMatchIn(name) }?.second ?: R.drawable.vod_pref_gear
    }
}
