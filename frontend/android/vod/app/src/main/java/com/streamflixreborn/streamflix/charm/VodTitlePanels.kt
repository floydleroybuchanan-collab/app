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
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.models.Episode
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.Season
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.format
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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

    private fun episodeType(show: TvShow, episode: Episode, season: Season) =
        Video.Type.Episode(
            episode.id, episode.number, episode.title, episode.poster, episode.overview,
            Video.Type.Episode.TvShow(show.id, show.title, show.poster, show.banner, show.released?.format("yyyy-MM-dd"), show.imdbId),
            Video.Type.Episode.Season(season.number, season.title),
        )

    /** One line of a scrolling panel list. */
    private class Line(
        val lead: String,
        val label: String,
        val trail: String,
        val tag: String? = null,
        val onFocus: (() -> Unit)? = null,
        val click: (View) -> Unit = {},
    )

    private class LineHolder(val item: LinearLayout, val lead: TextView, val label: TextView, val trail: TextView) :
        RecyclerView.ViewHolder(item)

    /** Rows are recycled, so a season with hundreds of episodes holds only the visible ones. */
    private class Lines : RecyclerView.Adapter<LineHolder>() {
        var lines: List<Line> = emptyList()
        var marked = -1

        fun submit(next: List<Line>, mark: Int = -1) {
            lines = next
            marked = mark
            @Suppress("NotifyDataSetChanged")
            notifyDataSetChanged()
        }

        override fun getItemCount() = lines.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): LineHolder {
            fun text(size: Float) = TextView(parent.context).apply {
                textSize = size; setTextColor(Color.WHITE); maxLines = 1; ellipsize = TextUtils.TruncateAt.END
            }
            val lead = text(13f)
            val label = text(13f)
            val trail = text(12f)
            val item = LinearLayout(parent.context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                isFocusable = true
                isClickable = true
                setPadding(px(9), 0, px(9), 0)
                addView(lead, LinearLayout.LayoutParams(px(44), -2))
                addView(label, LinearLayout.LayoutParams(0, -2, 1f))
                addView(trail)
                layoutParams = RecyclerView.LayoutParams(-1, px(ROW_DP)).apply { topMargin = px(ROW_GAP_DP) }
            }
            return LineHolder(item, lead, label, trail)
        }

        private fun glow(view: View) = VodGlass.surface(0xFFA82BF2.toInt(), view.px(9).toFloat(), view.px(1), true)

        override fun onBindViewHolder(holder: LineHolder, position: Int) {
            val line = lines[position]
            holder.lead.text = line.lead
            holder.label.text = line.label
            holder.trail.text = line.trail
            paint(holder, position == marked)
            holder.item.tag = line.tag
            holder.item.contentDescription = line.label
            holder.item.setOnClickListener(line.click)
            holder.item.setOnFocusChangeListener { view, focused ->
                view.background = if (focused) glow(view) else null
                if (focused) line.onFocus?.invoke()
            }
            holder.item.background = if (holder.item.isFocused) glow(holder.item) else null
        }

        fun paint(holder: LineHolder, on: Boolean) {
            val color = if (on) MARK else Color.WHITE
            holder.lead.setTextColor(color)
            holder.label.setTextColor(color)
            holder.label.setTypeface(null, if (on) Typeface.BOLD else Typeface.NORMAL)
        }

        /** Moves the highlight without rebinding, so the focused row keeps focus. */
        fun mark(list: RecyclerView, index: Int) {
            val old = marked
            marked = index
            (list.findViewHolderForAdapterPosition(old) as? LineHolder)?.let { paint(it, false) }
            (list.findViewHolderForAdapterPosition(index) as? LineHolder)?.let { paint(it, true) }
        }
    }

    private const val ROW_DP = 30
    private const val ROW_GAP_DP = 3
    private const val VISIBLE_ROWS = 8
    private const val MARK = 0xFFE9C8FF.toInt()
    private const val SEASON_PREVIEW_MS = 260L
    private const val KEPT_SEASONS = 3

    /** A list that scrolls inside its glass box and never grows past it. */
    private fun list(card: LinearLayout, lines: Lines): RecyclerView {
        val list = RecyclerView(card.context).apply {
            layoutManager = LinearLayoutManager(context)
            adapter = lines
            itemAnimator = null
            overScrollMode = View.OVER_SCROLL_NEVER
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
            isVerticalScrollBarEnabled = false
            setHasFixedSize(true)
        }
        card.addView(list, LinearLayout.LayoutParams(-1, card.px(VISIBLE_ROWS * (ROW_DP + ROW_GAP_DP))).apply { topMargin = card.px(3) })
        return list
    }

    private fun focusRow(list: RecyclerView, index: Int) {
        list.scrollToPosition(index)
        list.post { list.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
    }

    /**
     * Seasons on the left, the chosen season's episodes on the right. Both lists
     * scroll inside their boxes; resting on a season shows its episodes.
     */
    fun show(host: ViewGroup, show: TvShow, watch: View) {
        if (!once(host, "tv:" + show.id)) return
        val seasons = show.seasons
        if (seasons.isEmpty()) return
        val resume = show.episodeToWatch
        val first = resume?.season?.let { wanted -> seasons.indexOfFirst { it.number == wanted.number } }
            ?.takeIf { it >= 0 } ?: 0
        host.post {
            val owner = host.findViewTreeLifecycleOwner() ?: return@post
            val scope = owner.lifecycleScope
            val context = host.context.applicationContext
            val seasonsCard = card(host, "Seasons (${seasons.size})", R.drawable.vod_action_episodes)
            val episodesCard = card(host, "Episodes", R.drawable.vod_action_episodes)
            (episodesCard.layoutParams as LinearLayout.LayoutParams).apply { weight = 2.2f; marginStart = host.px(10) }
            val episodesTitle = (episodesCard.getChildAt(0) as ViewGroup).getChildAt(1) as TextView
            val seasonLines = Lines()
            val episodeLines = Lines()
            val seasonList = list(seasonsCard, seasonLines)
            val episodeList = list(episodesCard, episodeLines)
            // The few seasons last looked at stay in memory; older ones are fetched again.
            val kept = object : LinkedHashMap<String, List<Episode>>(4, .75f, true) {
                override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<Episode>>?) = size > KEPT_SEASONS
            }
            var shown = -1
            var loading: Job? = null
            var preview: Runnable? = null

            fun play(view: View, season: Season, episode: Episode) {
                val name = episode.title ?: "Episode ${episode.number}"
                view.findNavController().navigate(R.id.action_global_player, Bundle().apply {
                    putString("id", episode.id)
                    putString("title", show.title)
                    putString("subtitle", "S${season.number} · E${episode.number}  $name")
                    putSerializable("videoType", episodeType(show, episode, season))
                })
            }

            fun open(index: Int, focusEpisodes: Boolean) {
                val season = seasons.getOrNull(index) ?: return
                if (index == shown && loading?.isActive != true) {
                    if (focusEpisodes && episodeLines.itemCount > 0) focusRow(episodeList, episodeLines.marked.coerceAtLeast(0))
                    return
                }
                shown = index
                seasonLines.mark(seasonList, index)
                episodesTitle.text = "Episodes · " + seasonName(season)
                loading?.cancel()
                loading = scope.launch {
                    val episodes = kept[season.id] ?: run {
                        episodeLines.submit(listOf(Line("", "Loading…", "")))
                        val loaded = withContext(Dispatchers.IO) { episodesOf(context, show, season) }
                        if (loaded.isNotEmpty()) kept[season.id] = loaded
                        loaded
                    }
                    if (episodes.isEmpty()) {
                        episodeLines.submit(listOf(Line("", "No episodes found", "")))
                        return@launch
                    }
                    val next = episodes.indexOfFirst { resume != null && it.id == resume.id }
                    val start = if (next >= 0) next else 0
                    episodeLines.submit(episodes.mapIndexed { at, episode ->
                        Line(
                            lead = "E${episode.number}",
                            label = episode.title ?: "Episode ${episode.number}",
                            trail = progress(episode, at == next),
                            tag = if (at == start) FIRST_EPISODE else null,
                        ) { view -> play(view, season, episode) }
                    }, mark = next)
                    if (focusEpisodes) focusRow(episodeList, start) else episodeList.scrollToPosition(start)
                }
            }

            seasonLines.submit(seasons.mapIndexed { index, season ->
                Line(
                    lead = "S${season.number}",
                    label = seasonName(season),
                    trail = "›",
                    onFocus = {
                        // Passing over seasons does not fetch each one; resting on one does.
                        preview?.let { seasonList.removeCallbacks(it) }
                        preview = Runnable { open(index, false) }.also { seasonList.postDelayed(it, SEASON_PREVIEW_MS) }
                    },
                ) {
                    preview?.let { seasonList.removeCallbacks(it) }
                    open(index, true)
                }
            }, mark = first)
            seasonList.scrollToPosition(first)
            seasonList.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(view: View) = Unit
                override fun onViewDetachedFromWindow(view: View) {
                    preview?.let { seasonList.removeCallbacks(it) }
                    loading?.cancel()
                }
            })
            open(first, false)
        }
    }

    private fun seasonName(season: Season) =
        season.title?.takeIf { it.isNotBlank() } ?: if (season.number == 0) "Specials" else "Season ${season.number}"

    private fun progress(episode: Episode, next: Boolean): String {
        val history = episode.watchHistory
        return when {
            episode.isWatched -> "✓ Watched"
            history != null && history.durationMillis > 0L ->
                "▶ ${(history.lastPlaybackPositionMillis * 100L / history.durationMillis).coerceIn(1L, 99L)}%"
            next -> "▶ Up next"
            else -> "▶"
        }
    }

    /** The season's episodes with what was watched, saved the same way the old season page saved them. */
    private suspend fun episodesOf(context: android.content.Context, show: TvShow, season: Season): List<Episode> {
        val provider = UserPreferences.currentProvider ?: return emptyList()
        val episodes = season.episodes.ifEmpty {
            withTimeoutOrNull(10_000L) { runCatching { provider.getEpisodesBySeason(season.id) }.getOrNull() }.orEmpty()
        }.sortedBy { it.number }
        if (episodes.isEmpty()) return episodes
        runCatching {
            val database = com.streamflixreborn.streamflix.database.AppDatabase.getInstance(context)
            val byId = episodes.associateBy { it.id }
            episodes.map { it.id }.chunked(400).forEach { chunk ->
                database.episodeDao().getByIds(chunk).forEach { saved -> byId[saved.id]?.merge(saved) }
            }
            val showRef = TvShow(show.id)
            val seasonRef = Season(season.id)
            episodes.forEach { it.tvShow = showRef; it.season = seasonRef }
            database.episodeDao().insertAll(episodes)
        }
        return episodes
    }
}
