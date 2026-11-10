package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.BuildConfig
import com.streamflixreborn.streamflix.providers.TmdbProvider
import com.streamflixreborn.streamflix.utils.TMDb3
import com.streamflixreborn.streamflix.utils.TMDb3.original
import com.streamflixreborn.streamflix.utils.TMDb3.w500
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.Show
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.utils.HomeCacheStore
import com.streamflixreborn.streamflix.utils.ParentalControlUtils
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * TV-first platform-originals discovery. Only verified original/exclusive
 * entries intersecting the selected provider's already-available catalog
 * appear; nothing claims that a streamer provides playback by itself.
 * No separate WebView, no stream links, no duplicate poster bitmap cache.
 */
class VodPlatformsFragment : Fragment() {
    private var scroll: ScrollView? = null
    private var body: LinearLayout? = null
    private val posterRows = mutableListOf<RecyclerView>()
    private data class CatalogSnapshot(
        val originals: Map<String, List<Show>>,
        val allowed: List<Show>,
        val tmdbLanguage: String?,
    )
    private data class PlatformTitles(val movies: List<Show>, val series: List<Show>)
    private fun dp(n: Int) = (n * resources.displayMetrics.density + .5f).toInt()
    private val platformId: String? get() = arguments?.getString("platformId")

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        val context = requireContext()
        val root = VodPageScrollView(context).apply {
            isFillViewport = true
            isFocusable = false
            setBackgroundColor(0xFF120A20.toInt())
            // Rows and focused posters stay inside the page, under the top bar.
            clipChildren = true
            clipToPadding = true
        }
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(18), dp(24), dp(28))
            clipChildren = false
            clipToPadding = false
        }
        root.addView(column, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        scroll = root
        body = column
        return root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val column = body ?: return
        val currentPlatformId = platformId
        column.addView(label(if (currentPlatformId == null) "Platforms" else
            VodPlatformCatalog.byId(currentPlatformId)?.label?.substringBefore(" Originals") ?: "Platforms", 29f))
        column.addView(label("Explore platforms and titles in your selected VOD library. Network credit does not mean original or playback availability.", 14f).apply {
            setTextColor(0xFFC7B3D8.toInt())
        })

        // The platform selectors are available immediately. A remote catalog
        // must NEVER block the user from opening another platform page.
        if (currentPlatformId == null) {
            column.addView(label("Browse platforms", 20f))
            addPlatformShortcuts(column)
        }
        column.addView(label("Titles found in your VOD library", 20f))
        val status = label("Checking your selected VOD catalog...", 15f).apply {
            setTextColor(0xFFC7B3D8.toInt())
        }
        column.addView(status)
        val loading = ProgressBar(requireContext()).apply { isIndeterminate = true }
        column.addView(loading, LinearLayout.LayoutParams(dp(42), dp(42)).apply { topMargin = dp(12) })

        viewLifecycleOwner.lifecycleScope.launch {
            val started = SystemClock.elapsedRealtime()
            // Slow/cold catalogs are optional discovery; the page itself
            // remains fully navigable while this bounded lookup executes.
            val snapshot = try {
                withTimeoutOrNull(12_000L) {
                    withContext(Dispatchers.IO) {
                        val provider = UserPreferences.currentProvider
                        if (provider == null) {
                            CatalogSnapshot(emptyMap(), emptyList(), null)
                        } else {
                            val categories = HomeCacheStore.read(requireContext().applicationContext, provider)
                                ?: runCatching { provider.getHome() }.getOrDefault(emptyList())
                            val shows = categories.asSequence().flatMap { it.list.asSequence() }
                                .filterIsInstance<Show>().take(5000).toList()
                            val allowed = ParentalControlUtils.filterItems(shows).filterIsInstance<Show>()
                            val verified = VodPlatformCatalog.match(allowed.asSequence(), maxPerPlatform = 60)
                            CatalogSnapshot(
                                verified,
                                allowed,
                                // TMDb credits identify titles only with the TMDb provider.
                                (provider as? TmdbProvider)?.takeIf {
                                    UserPreferences.enableTmdb &&
                                        (BuildConfig.TMDB_API_KEY.isNotBlank() || UserPreferences.tmdbApiKey.isNotBlank())
                                }?.language,
                            )
                        }
                    }
                }
            } catch (error: Exception) {
                Log.e("CharmVodPlatforms", "Catalog discovery failed", error)
                null
            }
            val current = body ?: return@launch
            current.removeView(loading)
            Log.i("CharmVodPlatforms", "Catalog discovery finished after ${SystemClock.elapsedRealtime() - started}ms; available=${snapshot != null}")
            if (snapshot == null) {
                status.text = "Catalog lookup took too long or failed. Platform buttons remain available; return here to retry."
                return@launch
            }

            status.text = "Showing titles available in your selected VOD catalog."
            var shown = 0
            val platforms = VodPlatformCatalog.pagePlatforms.filter {
                currentPlatformId == null || it.id == currentPlatformId
            }.ifEmpty { listOfNotNull(VodPlatformCatalog.byId(currentPlatformId)) }
            // One section per platform keeps its rows together as results arrive.
            val sections = platforms.associate { platform ->
                platform.id to LinearLayout(requireContext()).apply {
                    orientation = LinearLayout.VERTICAL
                    clipChildren = false
                    clipToPadding = false
                    current.addView(this)
                }
            }
            val curatedIds = hashSetOf<String>()
            val language = snapshot.tmdbLanguage
            fun addOriginals(platform: VodPlatformCatalog.Platform, found: List<Show>) {
                val items = (snapshot.originals[platform.id].orEmpty() + found).distinctBy { showId(it) }
                if (items.isEmpty()) return
                shown++
                items.forEach { curatedIds += showId(it) }
                addPlatformRow(sections.getValue(platform.id), platform,
                    if (currentPlatformId == null) items.take(14) else items, currentPlatformId == null)
            }
            if (language == null) platforms.forEach { addOriginals(it, emptyList()) }
            if (language != null) {
                val networksStatus = label("Checking each platform's own titles...", 14f).apply {
                    setTextColor(0xFFC7B3D8.toInt())
                }
                current.addView(networksStatus)
                val pages = if (currentPlatformId == null) 1 else 3
                val discovered = try {
                    withTimeoutOrNull(15_000L) {
                        withContext(Dispatchers.IO) { discoverPlatformTitles(platforms, language, pages) }
                    }
                } catch (error: Exception) {
                    Log.w("CharmVodPlatforms", "Platform credits unavailable", error)
                    null
                }
                if (body == null) return@launch
                current.removeView(networksStatus)
                platforms.forEach { platform ->
                    val titles = discovered?.get(platform.id)
                    // A verified original always sits in the Originals row, and
                    // a network credit alone never claims to be one.
                    val credited = titles?.let { it.movies + it.series }.orEmpty()
                    addOriginals(platform, credited.filter { VodPlatformCatalog.find(it)?.id == platform.id })
                    if (titles == null) return@forEach
                    val name = platform.label.substringBefore(" Originals")
                    val section = sections.getValue(platform.id)
                    val limit = if (currentPlatformId == null) 14 else Int.MAX_VALUE
                    val movies = titles.movies.filter { VodPlatformCatalog.find(it) == null && showId(it) !in curatedIds }.take(limit)
                    if (movies.isNotEmpty()) {
                        shown++
                        addPlatformRow(section, platform, movies, currentPlatformId == null, "$name • Movies")
                    }
                    val series = titles.series.filter { VodPlatformCatalog.find(it) == null && showId(it) !in curatedIds }.take(limit)
                    if (series.isNotEmpty()) {
                        shown++
                        addPlatformRow(section, platform, series, currentPlatformId == null, "$name • Network series")
                    }
                }
            }
            if (shown == 0) {
                current.addView(label("No matching titles found in the selected VOD library. Choose another platform above, or check the VOD source in Settings.", 17f).apply {
                    setTextColor(0xFFC7B3D8.toInt())
                    setPadding(dp(10), dp(30), dp(10), dp(10))
                })
            }
        }
    }

    /** Immediate keyboard/remote accessible choices, regardless of API speed. */
    private fun addPlatformShortcuts(column: LinearLayout) {
        val strip = android.widget.HorizontalScrollView(requireContext()).apply {
            isHorizontalScrollBarEnabled = false
            isFocusable = false
            isSmoothScrollingEnabled = true
            clipChildren = true
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val row = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.HORIZONTAL
            clipChildren = false
            clipToPadding = false
            setPadding(dp(18), dp(22), dp(18), dp(22))
        }
        VodPlatformCatalog.pagePlatforms.forEachIndexed { index, platform ->
            val open = {
                findNavController().navigate(R.id.platform_titles,
                    Bundle().apply { putString("platformId", platform.id) })
                Unit
            }
            val tile = LinearLayout(requireContext()).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                clipChildren = false
                clipToPadding = false
            }
            fun reveal() {
                val start = tile.left - dp(26)
                val end = tile.right + dp(26)
                when {
                    start < strip.scrollX -> strip.smoothScrollTo(start, 0)
                    end > strip.scrollX + strip.width -> strip.smoothScrollTo(end - strip.width, 0)
                }
            }
            tile.addView(VodPlatformBadgeView(requireContext(), platform).apply {
                enableFlare()
                asRemoteTarget("Browse ${platform.label}", open, ::reveal)
            }, LinearLayout.LayoutParams(dp(116), dp(80)))
            tile.addView(VodPlatformBadgeView(requireContext(), platform, pill = true).apply {
                asRemoteTarget("View all ${platform.label}", open, ::reveal)
            }, LinearLayout.LayoutParams(dp(116), dp(32)))
            row.addView(tile, LinearLayout.LayoutParams(dp(138), ViewGroup.LayoutParams.WRAP_CONTENT))
            VodMotion.stagger(tile, index)
        }
        strip.addView(row)
        column.addView(strip)
    }

    private fun artwork(resource: Int) = ImageView(requireContext()).apply {
        setImageResource(resource)
        scaleType = ImageView.ScaleType.FIT_CENTER
        isFocusable = false
    }

    private fun showId(show: Show): String = when (show) {
        is Movie -> "movie:" + show.id
        is TvShow -> "tv:" + show.id
    }

    /**
     * Titles credited to each platform as maker or original network. Every TMDb
     * result is playable with the TMDb provider, so nothing is filtered against
     * the much smaller home catalog. Nothing here is cached beyond the page.
     */
    private suspend fun discoverPlatformTitles(
        platforms: List<VodPlatformCatalog.Platform>,
        language: String,
        pages: Int,
    ): Map<String, PlatformTitles> = coroutineScope {
        platforms.mapNotNull { platform ->
            val origin = VodPlatformCatalog.origin(platform.id) ?: return@mapNotNull null
            async {
                val movies = origin.companies?.let { companies ->
                    fetchPages(pages) { page ->
                        TMDb3.Discover.movie(mapOf(
                            TMDb3.Params.Key.WITH_COMPANIES to companies,
                            TMDb3.Params.Key.PAGE to page.toString(),
                            TMDb3.Params.Key.LANGUAGE to language,
                        )).results.map { remote ->
                            Movie(
                                id = remote.id.toString(),
                                title = remote.title,
                                overview = remote.overview,
                                released = remote.releaseDate,
                                rating = remote.voteAverage.toDouble(),
                                poster = remote.posterPath?.w500,
                                banner = remote.backdropPath?.original,
                            )
                        }
                    }
                }.orEmpty()
                val series = origin.networks?.let { networks ->
                    fetchPages(pages) { page ->
                        TMDb3.Discover.tv(mapOf(
                            TMDb3.Params.Key.WITH_NETWORKS to networks,
                            TMDb3.Params.Key.PAGE to page.toString(),
                            TMDb3.Params.Key.LANGUAGE to language,
                        )).results.map { remote ->
                            TvShow(
                                id = remote.id.toString(),
                                title = remote.name,
                                overview = remote.overview,
                                released = remote.firstAirDate,
                                rating = remote.voteAverage.toDouble(),
                                poster = remote.posterPath?.w500,
                                banner = remote.backdropPath?.original,
                            )
                        }
                    }
                }.orEmpty()
                platform.id to PlatformTitles(
                    ParentalControlUtils.filterItems(movies).filterIsInstance<Show>(),
                    ParentalControlUtils.filterItems(series).filterIsInstance<Show>(),
                )
            }
        }.awaitAll().toMap()
    }

    private suspend fun <T> fetchPages(pages: Int, load: suspend (Int) -> List<T>): List<T> {
        val all = mutableListOf<T>()
        for (page in 1..pages) {
            val results = withTimeoutOrNull(5_000L) { runCatching { load(page) }.getOrNull() } ?: break
            all += results
        }
        return all
    }

    private fun label(value: String, size: Float): TextView = TextView(requireContext()).apply {
        text = value
        textSize = size
        setTextColor(Color.WHITE)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(6), dp(7), dp(4), dp(8))
    }

    private fun addPlatformRow(column: LinearLayout, platform: VodPlatformCatalog.Platform, items: List<Show>, viewAll: Boolean, rowLabel: String = platform.label) {
        val header = LinearLayout(requireContext()).apply {
            gravity = Gravity.CENTER_VERTICAL
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(12), 0, dp(6))
            clipChildren = false
        }
        val art = VodPlatformArt.of(platform.id)
        val badge = VodPlatformBadgeView(requireContext(), platform, small = true)
        if (art != null) header.addView(artwork(art.button), LinearLayout.LayoutParams(dp(80), dp(55)))
        else header.addView(badge, LinearLayout.LayoutParams(dp(104), dp(44)))
        header.addView(label(rowLabel, 17f), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            leftMargin = dp(12)
        })
        if (viewAll) {
            val open = View.OnClickListener {
                findNavController().navigate(R.id.platform_titles,
                    Bundle().apply { putString("platformId", platform.id) })
            }
            if (art != null) {
                header.addView(VodPlatformBadgeView(requireContext(), platform, pill = true).apply {
                    asRemoteTarget("View all ${platform.label}", { open.onClick(this) })
                    // LEFT returns to this row's posters instead of leaving the page.
                    setOnKeyListener { _, code, event ->
                        code == android.view.KeyEvent.KEYCODE_DPAD_LEFT && event.action == android.view.KeyEvent.ACTION_DOWN &&
                            rowUnder(this)?.requestFocus() == true
                    }
                }, LinearLayout.LayoutParams(dp(112), dp(32)))
            } else {
                header.addView(label("View All  ›", 13f).apply {
                    isFocusable = true
                    isClickable = true
                    gravity = Gravity.CENTER
                    contentDescription = "View all ${platform.label}"
                    background = badge.viewAllGlass(false)
                    setPadding(dp(18), dp(8), dp(18), dp(8))
                    onFocusChangeListener = View.OnFocusChangeListener { v, focused ->
                        v.background = badge.viewAllGlass(focused)
                        VodHomeShelf.liftCard(v, focused)
                    }
                    setOnClickListener(open)
                })
            }
        }
        column.addView(header)
        val posters = RecyclerView(requireContext()).apply {
            layoutManager = LinearLayoutManager(requireContext(), RecyclerView.HORIZONTAL, false)
            adapter = PosterAdapter(items)
            isFocusable = false
            clipChildren = false
            clipToPadding = false
            setPadding(dp(6), dp(9), dp(8), dp(11))
            setHasFixedSize(true)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        posterRows += posters
        column.addView(posters, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(212)))
    }

    private fun screenTop(view: View) = IntArray(2).also(view::getLocationOnScreen)[1]

    private fun rowUnder(button: View): RecyclerView? =
        posterRows.filter { screenTop(it) >= screenTop(button) }.minByOrNull(::screenTop)

    /** UP/DOWN go to the same column in the next row; only the far right reaches View All. */
    private fun movePosterFocus(card: View, code: Int): Boolean {
        val step = when (code) {
            android.view.KeyEvent.KEYCODE_DPAD_UP -> -1
            android.view.KeyEvent.KEYCODE_DPAD_DOWN -> 1
            else -> return false
        }
        val row = card.parent as? RecyclerView ?: return false
        val cardCenter = card.left + card.width / 2
        if (step < 0 && cardCenter > row.width * 3 / 4) return false
        val ordered = posterRows.sortedBy(::screenTop)
        val target = ordered.getOrNull(ordered.indexOf(row) + step) ?: return false
        val next = (0 until target.childCount).map(target::getChildAt)
            .minByOrNull { kotlin.math.abs(it.left + it.width / 2 - cardCenter) } ?: return false
        return next.requestFocus()
    }

    private inner class PosterAdapter(private val shows: List<Show>) :
        RecyclerView.Adapter<PosterAdapter.PosterHolder>() {
        inner class PosterHolder(val frame: FrameLayout, val poster: ImageView, val caption: TextView) :
            RecyclerView.ViewHolder(frame)

        override fun getItemCount() = shows.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PosterHolder {
            val resting = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(0xFF2B1B40.toInt())
                setStroke(dp(1), 0xFF5D3A85.toInt())
            }
            val raised = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(0xFF2B1B40.toInt())
                setStroke(dp(2), Color.WHITE)
            }
            val f = FrameLayout(parent.context).apply {
                isFocusable = true
                isClickable = true
                background = resting
                outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
                clipToOutline = true
            }
            val pic = ImageView(parent.context).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
            }
            f.addView(pic, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(154)))
            val title = TextView(parent.context).apply {
                setTextColor(Color.WHITE)
                textSize = 12f
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                setPadding(dp(7), dp(4), dp(7), dp(3))
            }
            f.addView(title, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38), Gravity.BOTTOM))
            f.layoutParams = RecyclerView.LayoutParams(dp(113), dp(192)).apply {
                rightMargin = dp(12)
            }
            f.setOnKeyListener { v, code, event ->
                event.action == android.view.KeyEvent.ACTION_DOWN && movePosterFocus(v, code)
            }
            f.onFocusChangeListener = View.OnFocusChangeListener { v, focused ->
                v.background = if (focused) raised else resting
                VodHomeShelf.liftCard(v, focused)
            }
            return PosterHolder(f, pic, title)
        }
        override fun onBindViewHolder(holder: PosterHolder, position: Int) {
            val show = shows[position]
            val title = when(show) { is Movie -> show.title; is TvShow -> show.title }
            val imageUrl = when(show) { is Movie -> show.poster; is TvShow -> show.poster }
            holder.caption.text = title
            holder.frame.contentDescription = title
            // Decoded at the poster's own size, so a full-size bitmap is never held.
            Glide.with(holder.poster).load(imageUrl).override(dp(113), dp(154)).centerCrop().into(holder.poster)
            holder.frame.setOnClickListener {
                val id = if (show is Movie) R.id.movie else R.id.tv_show
                findNavController().navigate(id, Bundle().apply { putString("id", when(show) {
                    is Movie -> show.id
                    is TvShow -> show.id
                }) })
            }
        }
        override fun onViewRecycled(holder: PosterHolder) {
            Glide.with(holder.poster).clear(holder.poster)
            super.onViewRecycled(holder)
        }
    }

    override fun onDestroyView() {
        posterRows.clear()
        scroll = null
        body = null
        super.onDestroyView()
    }
}
