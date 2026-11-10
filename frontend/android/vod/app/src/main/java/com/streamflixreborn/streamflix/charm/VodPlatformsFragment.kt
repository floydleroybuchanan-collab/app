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
    private data class CatalogSnapshot(
        val originals: Map<String, List<Show>>,
        val allowed: List<Show>,
        val canDiscoverNetworks: Boolean,
    )
    private fun dp(n: Int) = (n * resources.displayMetrics.density + .5f).toInt()
    private val platformId: String? get() = arguments?.getString("platformId")

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        val context = requireContext()
        val root = ScrollView(context).apply {
            isFillViewport = true
            isFocusable = false
            setBackgroundColor(0xFF120A20.toInt())
            clipChildren = false
            clipToPadding = false
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
                            CatalogSnapshot(emptyMap(), emptyList(), false)
                        } else {
                            val categories = HomeCacheStore.read(requireContext().applicationContext, provider)
                                ?: runCatching { provider.getHome() }.getOrDefault(emptyList())
                            val shows = categories.asSequence().flatMap { it.list.asSequence() }
                                .filterIsInstance<Show>().take(5000).toList()
                            val allowed = ParentalControlUtils.filterItems(shows).filterIsInstance<Show>()
                            val verified = VodPlatformCatalog.match(allowed.asSequence(), maxPerPlatform = 60)
                            // Home shelves are a preview, NOT a provider's entire
                            // VOD library. On a selected, empty Originals page,
                            // query at most six verified seed titles in two small
                            // batches. Only exact title+year matches are admitted.
                            // No image preload, duplicate player or persistent
                            // cache is created by these optional lookups.
                            val searched = if (currentPlatformId != null &&
                                verified[currentPlatformId].isNullOrEmpty()) {
                                val found = mutableListOf<Show>()
                                for (batch in VodPlatformCatalog.searchSeeds(currentPlatformId).chunked(3)) {
                                    batch.map { title ->
                                        async {
                                            withTimeoutOrNull(2_200L) {
                                                runCatching {
                                                    provider.search(title, 1).filterIsInstance<Show>().take(40)
                                                }.getOrDefault(emptyList())
                                            } ?: emptyList()
                                        }
                                    }.awaitAll().forEach(found::addAll)
                                }
                                ParentalControlUtils.filterItems(found).filterIsInstance<Show>()
                            } else emptyList()
                            val matching = if (currentPlatformId != null && searched.isNotEmpty()) {
                                VodPlatformCatalog.match(searched.asSequence(), maxPerPlatform = 60)
                                    [currentPlatformId].orEmpty()
                            } else emptyList()
                            val originals = if (currentPlatformId != null && matching.isNotEmpty()) {
                                val joined = (verified[currentPlatformId].orEmpty() + matching)
                                    .distinctBy { show ->
                                        when (show) {
                                            is Movie -> "movie/" + show.id
                                            is TvShow -> "series/" + show.id
                                        }
                                    }.take(60)
                                verified + (currentPlatformId to joined)
                            } else verified
                            CatalogSnapshot(
                                originals,
                                allowed + searched,
                                // TMDb IDs are trustworthy only with the TMDb provider.
                                provider is TmdbProvider && UserPreferences.enableTmdb &&
                                    (BuildConfig.TMDB_API_KEY.isNotBlank() || UserPreferences.tmdbApiKey.isNotBlank()),
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
            val platforms = VodPlatformCatalog.platforms.filter {
                currentPlatformId == null || it.id == currentPlatformId
            }
            platforms.forEach { platform ->
                val items = snapshot.originals[platform.id].orEmpty()
                if (items.isNotEmpty()) {
                    shown++
                    addPlatformRow(current, platform,
                        if (currentPlatformId == null) items.take(14) else items, currentPlatformId == null)
                }
            }

            if (snapshot.canDiscoverNetworks && snapshot.allowed.isNotEmpty()) {
                val networksStatus = label("Checking TV network associations...", 14f).apply {
                    setTextColor(0xFFC7B3D8.toInt())
                }
                current.addView(networksStatus)
                val allowed = snapshot.allowed
                val networks = try {
                    withTimeoutOrNull(15_000L) {
                        withContext(Dispatchers.IO) { loadNetworkSeries(allowed) }
                    }
                } catch (error: Exception) {
                    Log.w("CharmVodPlatforms", "Optional network metadata unavailable", error)
                    null
                }
                if (body == null) return@launch
                current.removeView(networksStatus)
                platforms.forEach { platform ->
                    val associated = networks?.get(platform.id).orEmpty()
                    if (associated.isNotEmpty()) {
                        shown++
                        addPlatformRow(current, platform,
                            if (currentPlatformId == null) associated.take(14) else associated,
                            currentPlatformId == null,
                            platform.label.substringBefore(" Originals") + " • Network series")
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
        VodPlatformCatalog.platforms.chunked(4).forEach { group ->
            val row = LinearLayout(requireContext()).apply {
                orientation = LinearLayout.HORIZONTAL
                clipChildren = false
                clipToPadding = false
            }
            group.forEach { platform ->
                val tile = LinearLayout(requireContext()).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    isFocusable = true
                    isClickable = true
                    contentDescription = "Browse ${platform.label}"
                    setPadding(dp(6), dp(7), dp(6), dp(7))
                }
                val badge = VodPlatformBadgeView(requireContext(), platform, small = true)
                tile.addView(badge, LinearLayout.LayoutParams(dp(106), dp(45)))
                tile.addView(label(platform.label.substringBefore(" Originals"), 13f).apply {
                    gravity = Gravity.CENTER
                    maxLines = 1
                    isFocusable = false
                })
                tile.background = badge.glass(false)
                tile.setOnFocusChangeListener { _, focused -> tile.background = badge.glass(focused) }
                tile.setOnClickListener {
                    findNavController().navigate(R.id.platform_titles,
                        Bundle().apply { putString("platformId", platform.id) })
                }
                row.addView(tile, LinearLayout.LayoutParams(0, dp(110), 1f).apply {
                    rightMargin = dp(10)
                    bottomMargin = dp(12)
                })
            }
            column.addView(row)
        }
    }

    /**
     * Bounded TMDb network discovery for titles already present in the user's
     * selected TMDb VOD source. Network credits must never be called Originals.
     * Results are intentionally not stored in a new long-lived memory cache.
     */
    private suspend fun loadNetworkSeries(allowed: List<Show>): Map<String, List<Show>> = coroutineScope {
        val library = allowed.filterIsInstance<TvShow>()
            .mapNotNull { show -> show.id.toIntOrNull()?.let { it to show } }.toMap()
        if (library.isEmpty()) return@coroutineScope emptyMap()

        val networkIds = mapOf(
            "netflix" to TMDb3.Network.NetworkId.NETFLIX.id,
            "disney" to TMDb3.Network.NetworkId.DISNEY_PLUS.id,
            "apple" to TMDb3.Network.NetworkId.APPLE_TV.id,
            "hulu" to TMDb3.Network.NetworkId.HULU.id,
            "max" to TMDb3.Network.NetworkId.HBO.id,
            "prime" to TMDb3.Network.NetworkId.AMAZON.id,
            "paramount" to TMDb3.Network.NetworkId.PARAMOUNT_PLUS.id,
            "peacock" to TMDb3.Network.NetworkId.PEACOCK.id,
        )
        networkIds.map { (platform, networkId) ->
            async {
                val series = mutableListOf<Show>()
                // Up to three pages per service, five seconds max per query.
                // Auth/API errors degrade to the curated originals list.
                for (page in 1..3) {
                    val response = withTimeoutOrNull(5_000L) {
                        runCatching {
                            TMDb3.Discover.tv(mapOf(
                                TMDb3.Params.Key.WITH_NETWORKS to networkId.toString(),
                                TMDb3.Params.Key.PAGE to page.toString(),
                                TMDb3.Params.Key.LANGUAGE to "en-US",
                            )).results
                        }.getOrNull()
                    } ?: break
                    response.forEach { remote ->
                        val local = library[remote.id] ?: return@forEach
                        if (VodPlatformCatalog.find(local) == null && series.none { (it as TvShow).id == local.id }) {
                            series += local
                        }
                    }
                    if (series.size >= 40) break
                }
                platform to series.take(40)
            }
        }.awaitAll().toMap()
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
            setPadding(dp(4), dp(15), 0, dp(6))
            clipChildren = false
        }
        val badge = VodPlatformBadgeView(requireContext(), platform, small = true)
        header.addView(badge, LinearLayout.LayoutParams(dp(116), dp(50)))
        header.addView(label(rowLabel, 20f), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            leftMargin = dp(14)
        })
        if (viewAll) {
            val button = label("View All  ›", 15f).apply {
                isFocusable = true
                isClickable = true
                setTextColor(Color.WHITE)
                setTypeface(typeface, Typeface.BOLD)
                contentDescription = "View all ${platform.label}"
                elevation = dp(7).toFloat()
                background = badge.viewAllGlass(false)
                setPadding(dp(22), dp(12), dp(22), dp(12))
                onFocusChangeListener = View.OnFocusChangeListener { v, focused ->
                    // Each button uses its matching platform palette and neon
                    // glass edge, never a generic purple outline.
                    v.background = badge.viewAllGlass(focused)
                    v.animate().cancel()
                    v.animate().scaleX(if (focused) 1.08f else 1f).scaleY(if (focused) 1.08f else 1f)
                        .translationZ(if (focused) dp(10).toFloat() else 0f)
                        .setDuration(140L).start()
                }
                setOnClickListener {
                    findNavController().navigate(R.id.platform_titles,
                        Bundle().apply { putString("platformId", platform.id) })
                }
            }
            header.addView(button)
        }
        column.addView(header)
        val posters = RecyclerView(requireContext()).apply {
            layoutManager = LinearLayoutManager(requireContext(), RecyclerView.HORIZONTAL, false)
            adapter = PosterAdapter(items)
            isFocusable = false
            clipChildren = false
            clipToPadding = false
            setPadding(dp(6), dp(7), dp(8), dp(13))
            setHasFixedSize(true)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        column.addView(posters, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(223)))
    }

    private inner class PosterAdapter(private val shows: List<Show>) :
        RecyclerView.Adapter<PosterAdapter.PosterHolder>() {
        inner class PosterHolder(val frame: FrameLayout, val poster: ImageView, val caption: TextView) :
            RecyclerView.ViewHolder(frame)

        override fun getItemCount() = shows.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PosterHolder {
            val f = FrameLayout(parent.context).apply {
                isFocusable = true
                isClickable = true
                clipChildren = false
                clipToPadding = false
                background = GradientDrawable().apply {
                    cornerRadius = dp(14).toFloat()
                    setColor(0xFF302344.toInt())
                    setStroke(dp(1), 0xFF704D91.toInt())
                }
            }
            val pic = ImageView(parent.context).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                clipToOutline = true
            }
            f.addView(pic, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(172)))
            val title = TextView(parent.context).apply {
                setTextColor(Color.WHITE)
                textSize = 12f
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                setPadding(dp(7), dp(4), dp(7), dp(3))
            }
            f.addView(title, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(41), Gravity.BOTTOM))
            f.layoutParams = RecyclerView.LayoutParams(dp(126), dp(215)).apply {
                rightMargin = dp(13)
            }
            f.onFocusChangeListener = View.OnFocusChangeListener { v, focused ->
                v.animate().cancel()
                v.animate().scaleX(if (focused) 1.075f else 1f)
                    .scaleY(if (focused) 1.075f else 1f)
                    .translationZ(if (focused) dp(9).toFloat() else 0f)
                    .setDuration(145L).start()
            }
            return PosterHolder(f, pic, title)
        }
        override fun onBindViewHolder(holder: PosterHolder, position: Int) {
            val show = shows[position]
            val title = when(show) { is Movie -> show.title; is TvShow -> show.title }
            val imageUrl = when(show) { is Movie -> show.poster; is TvShow -> show.poster }
            holder.caption.text = title
            holder.frame.contentDescription = title
            // Glide owns lifecycle + disk/memory cache; 126x172 avoids full bitmap decode.
            Glide.with(holder.poster).load(imageUrl).override(dp(126), dp(172)).centerCrop().into(holder.poster)
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
        scroll = null
        body = null
        super.onDestroyView()
    }
}
