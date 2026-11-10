package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.navigation.findNavController
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.format
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** The Sources and Episodes panels built into every title page. */
object VodTitlePanels {
    const val FIRST_SOURCE = "vod_first_source"
    const val FIRST_EPISODE = "vod_first_episode"

    private fun View.px(value: Int) = (value * resources.displayMetrics.density + .5f).toInt()

    private fun card(host: ViewGroup, title: String, art: Int): LinearLayout {
        val card = LinearLayout(host.context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(12), px(9), px(12), px(9))
            background = VodGlass.surface(0xFFB68AF5.toInt(), px(16).toFloat(), px(1), false)
            clipChildren = false
            clipToPadding = false
        }
        card.addView(LinearLayout(host.context).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(context).apply { setImageResource(art) }, LinearLayout.LayoutParams(px(22), px(22)))
            addView(TextView(context).apply {
                text = title; textSize = 15f; setTextColor(Color.WHITE); setTypeface(typeface, Typeface.BOLD)
                setPadding(px(8), 0, 0, 0)
            })
        })
        host.addView(card, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        host.visibility = View.VISIBLE
        VodMotion.stagger(card, 0)
        return card
    }

    private fun row(card: LinearLayout, lead: String, label: String, trail: String, tag: String?, click: (View) -> Unit) {
        val item = LinearLayout(card.context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            isClickable = true
            this.tag = tag
            contentDescription = label
            setPadding(px(9), 0, px(9), 0)
            setOnClickListener(click)
            setOnFocusChangeListener { view, focused ->
                view.background = if (focused) VodGlass.surface(0xFFA82BF2.toInt(), px(9).toFloat(), px(1), true) else null
                VodHomeShelf.liftCard(view, false)
            }
        }
        fun text(value: String, size: Float) = TextView(card.context).apply {
            text = value; textSize = size; setTextColor(Color.WHITE); maxLines = 1; ellipsize = TextUtils.TruncateAt.END
        }
        item.addView(text(lead, 13f), LinearLayout.LayoutParams(card.px(if (lead.length > 2) 62 else 24), -2))
        item.addView(text(label, 13f), LinearLayout.LayoutParams(0, -2, 1f))
        item.addView(text(trail, 12f))
        card.addView(item, LinearLayout.LayoutParams(-1, card.px(30)).apply { topMargin = card.px(3) })
    }

    private fun once(host: ViewGroup, key: String): Boolean {
        if (host.getTag(R.id.ll_movie_panels) == key) return false
        host.setTag(R.id.ll_movie_panels, key)
        host.removeAllViews()
        host.visibility = View.GONE
        return true
    }

    fun movie(host: ViewGroup, movie: Movie, watch: View) {
        if (!once(host, "movie:" + movie.id)) return
        host.post {
            val owner = host.findViewTreeLifecycleOwner() ?: return@post
            owner.lifecycleScope.launch {
                // Skip the source lookup for titles the viewer only passes through.
                delay(700L)
                val type = Video.Type.Movie(movie.id, movie.title, movie.released?.format("yyyy-MM-dd") ?: "", movie.poster ?: movie.banner ?: "", movie.imdbId)
                val servers = withContext(Dispatchers.IO) {
                    val provider = UserPreferences.currentProvider ?: return@withContext emptyList<Video.Server>()
                    withTimeoutOrNull(8_000L) { runCatching { provider.getServers(movie.id, type) }.getOrNull() }.orEmpty()
                }
                if (servers.isEmpty()) return@launch
                val panel = card(host, "Sources (${servers.size})", R.drawable.vod_action_sources)
                servers.take(5).forEachIndexed { index, server ->
                    row(panel, if (index == 0) "◉" else "○", server.name, if (index == 0) "★ Best" else "", if (index == 0) FIRST_SOURCE else null) {
                        VodSourceRequest.chosen = server.id
                        VodSourceRequest.pending = true
                        watch.performClick()
                    }
                }
            }
        }
    }

    private fun episodeType(show: TvShow, episode: com.streamflixreborn.streamflix.models.Episode, season: com.streamflixreborn.streamflix.models.Season) =
        Video.Type.Episode(
            episode.id, episode.number, episode.title, episode.poster, episode.overview,
            Video.Type.Episode.TvShow(show.id, show.title, show.poster, show.banner, show.released?.format("yyyy-MM-dd"), show.imdbId),
            Video.Type.Episode.Season(season.number, season.title),
        )

    fun show(host: ViewGroup, show: TvShow, watch: View) {
        if (!once(host, "tv:" + show.id)) return
        val season = show.episodeToWatch?.season?.let { wanted -> show.seasons.firstOrNull { it.number == wanted.number } }
            ?: show.seasons.firstOrNull() ?: return
        host.post {
            val owner = host.findViewTreeLifecycleOwner() ?: return@post
            owner.lifecycleScope.launch {
                delay(700L)
                val episodes = season.episodes.ifEmpty {
                    withContext(Dispatchers.IO) {
                        val provider = UserPreferences.currentProvider ?: return@withContext emptyList()
                        withTimeoutOrNull(8_000L) { runCatching { provider.getEpisodesBySeason(season.id) }.getOrNull() }.orEmpty()
                    }
                }
                if (episodes.isEmpty()) return@launch
                val panel = card(host, "Episodes · Season ${season.number}", R.drawable.vod_action_episodes)
                episodes.take(5).forEachIndexed { index, episode ->
                    val name = episode.title ?: "Episode ${episode.number}"
                    row(panel, "S${season.number} · E${episode.number}", name, "▶", if (index == 0) FIRST_EPISODE else null) { view ->
                        view.findNavController().navigate(R.id.action_global_player, Bundle().apply {
                            putString("id", episode.id)
                            putString("title", show.title)
                            putString("subtitle", "S${season.number} · E${episode.number}  $name")
                            putSerializable("videoType", episodeType(show, episode, season))
                        })
                    }
                }
                // The Watch button plays this episode, so its sources are the ones offered.
                val next = show.episodeToWatch ?: return@launch
                val servers = withContext(Dispatchers.IO) {
                    val provider = UserPreferences.currentProvider ?: return@withContext emptyList<Video.Server>()
                    withTimeoutOrNull(8_000L) { runCatching { provider.getServers(next.id, episodeType(show, next, season)) }.getOrNull() }.orEmpty()
                }
                if (servers.isNotEmpty()) {
                    val sources = card(host, "Sources (${servers.size}) · E${next.number}", R.drawable.vod_action_sources)
                    (sources.layoutParams as LinearLayout.LayoutParams).marginStart = host.px(10)
                    servers.take(5).forEachIndexed { index, server ->
                        row(sources, if (index == 0) "◉" else "○", server.name, if (index == 0) "★ Best" else "", if (index == 0) FIRST_SOURCE else null) {
                            VodSourceRequest.chosen = server.id
                            VodSourceRequest.pending = true
                            watch.performClick()
                        }
                    }
                }
            }
        }
    }
}
