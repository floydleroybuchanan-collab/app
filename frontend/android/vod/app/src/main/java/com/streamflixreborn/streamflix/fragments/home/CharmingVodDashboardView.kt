package com.streamflixreborn.streamflix.fragments.home

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.bumptech.glide.Glide
import com.streamflixreborn.streamflix.charm.VodPlatformBadgeView
import com.streamflixreborn.streamflix.charm.VodPlatformCatalog
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.Show
import com.streamflixreborn.streamflix.models.TvShow

/**
 * The persistent VOD home composition, matching the approved TV mockup:
 * hero banner -> ten branded platforms + their own View All actions ->
 * Trending Movies header. Existing Leanback poster shelves sit immediately
 * beneath this header; all titles and artwork come from the selected provider.
 *
 * Created synchronously, without awaiting a network request or a loading gate.
 * No second icon rail, Activity, WebView, player or hidden focus owner.
 */
class CharmingVodDashboardView @JvmOverloads constructor(
    context: Context, attrs: android.util.AttributeSet? = null,
) : LinearLayout(context, attrs) {
    var onFeature: (() -> Unit)? = null
    var onFavorites: (() -> Unit)? = null
    var onPlatform: ((String) -> Unit)? = null
    var onViewMovies: (() -> Unit)? = null

    private fun dp(n: Int) = (n * resources.displayMetrics.density + 0.5f).toInt()
    private val heightDp = (resources.displayMetrics.heightPixels / resources.displayMetrics.density).toInt()
    val dashboardHeightDp: Int
    private val hero = FrameLayout(context)
    private val banner = ImageView(context)
    private val heroTitle = label("YOUR VOD LIBRARY", 28f, true)
    private val heroDescription = label("Movies and series in your selected library", 13f, false)
    private val heroMetadata = label("MOVIES  •  SERIES  •  FAVORITES", 12f, false)
    private val heroDots = label("●  ○  ○  ○  ○", 13f, true)
    private val watch = action("▶  Watch Now", 0xFFAB32F5.toInt(), 0xFF6A19C8.toInt())
    private val myList = action("＋  My List", 0xFF4E335D.toInt(), 0xFF25142F.toInt())

    init {
        orientation = VERTICAL
        isFocusable = false
        clipChildren = false
        clipToPadding = false
        setPadding(dp(12), dp(1), dp(12), 0)
        background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0xFF180727.toInt(), 0xFF0E061B.toInt(), 0xFF160529.toInt()))
        val heroDp = (heightDp * 0.30f).toInt().coerceIn(150, 276)
        val platformDp = (heightDp * 0.245f).toInt().coerceIn(128, 194)
        dashboardHeightDp = heroDp + platformDp + 36

        hero.clipChildren = false
        hero.clipToPadding = false
        hero.background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(0xFF2E0C56.toInt(), 0xFF241246.toInt(), 0xFF160820.toInt())
        ).apply {
            cornerRadius = dp(19).toFloat()
            setStroke(dp(1), 0xC05321A1.toInt())
        }
        banner.scaleType = ImageView.ScaleType.CENTER_CROP
        banner.alpha = 0.93f
        banner.isFocusable = false
        hero.addView(banner, FrameLayout.LayoutParams(-1, -1))
        hero.addView(View(context).apply {
            isFocusable = false
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xF40C0719.toInt(), 0xD11A0A2F.toInt(), 0x4516072C, 0x12060413))
        }, FrameLayout.LayoutParams(-1, -1))
        val copy = LinearLayout(context).apply {
            orientation = VERTICAL
            gravity = Gravity.BOTTOM or Gravity.START
            setPadding(dp(29), 0, dp(12), dp(18))
            isFocusable = false
        }
        val eyebrow = label("A CHARMING MEDIALAB FEATURED TITLE", 10f, true).apply {
            letterSpacing = 0.22f
            setTextColor(0xFFECC9FF.toInt())
        }
        copy.addView(eyebrow)
        copy.addView(heroTitle, LayoutParams(-1, -2).apply { topMargin = dp(10) })
        copy.addView(heroMetadata, LayoutParams(-1, -2).apply { topMargin = dp(4) })
        copy.addView(heroDescription, LayoutParams(-1, -2).apply { topMargin = dp(4) })
        val actions = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        actions.addView(watch, LayoutParams(-2, dp(35)))
        actions.addView(myList, LayoutParams(-2, dp(35)).apply { leftMargin = dp(10) })
        copy.addView(actions, LayoutParams(-2, dp(42)).apply { topMargin = dp(6) })
        hero.addView(copy, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM or Gravity.START))
        hero.addView(heroDots, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = dp(7)
        })
        addView(hero, LayoutParams(-1, dp(heroDp)).apply { bottomMargin = dp(6) })
        watch.setOnClickListener { onFeature?.invoke() }
        myList.setOnClickListener { onFavorites?.invoke() }

        val platforms = LinearLayout(context).apply {
            orientation = VERTICAL
            isFocusable = false
            clipChildren = false
            clipToPadding = false
        }
        platforms.addView(label("▎PLATFORMS", 18f, true).apply {
            setTextColor(0xFFF8E4FF.toInt())
            letterSpacing = 0.03f
        }, LayoutParams(-1, dp(29)))
        val scroll = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            isFocusable = false
            clipChildren = false
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val tiles = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.TOP
            clipChildren = false
            clipToPadding = false
            setPadding(dp(3), dp(2), dp(12), 0)
        }
        val iconDp = (platformDp - 67).coerceIn(68, 104)
        val tileDp = iconDp + 12
        VodPlatformCatalog.platforms.forEach { platform ->
            val tile = LinearLayout(context).apply {
                orientation = VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                clipChildren = false
                clipToPadding = false
                isFocusable = false
            }
            val badge = VodPlatformBadgeView(context, platform, small = false)
            tile.addView(badge, LayoutParams(dp(iconDp), dp(iconDp)))
            val viewAll = action("View All  ›", platform.tint, 0xFF33104F.toInt()).apply {
                textSize = 12.5f
                contentDescription = "View all ${platform.label}"
                background = badge.viewAllGlass(false)
                onFocusChangeListener = OnFocusChangeListener { view, focused ->
                    view.background = badge.viewAllGlass(focused)
                    view.animate().cancel()
                    view.animate().scaleX(if (focused) 1.06f else 1f)
                        .scaleY(if (focused) 1.06f else 1f)
                        .translationZ(if (focused) dp(12).toFloat() else 0f)
                        .setDuration(135).start()
                }
            }
            viewAll.setOnClickListener { onPlatform?.invoke(platform.id) }
            tile.addView(viewAll, LayoutParams(dp(iconDp), dp(28)).apply { topMargin = dp(4) })
            tiles.addView(tile, LayoutParams(dp(tileDp), -2).apply { rightMargin = dp(1) })
        }
        scroll.addView(tiles, FrameLayout.LayoutParams(-2, -2))
        platforms.addView(scroll, LayoutParams(-1, 0, 1f))
        addView(platforms, LayoutParams(-1, dp(platformDp)))
        val moviesHeader = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        moviesHeader.addView(label("▎TRENDING MOVIES", 18f, true), LayoutParams(0, -2, 1f))
        val moreMovies = label("View All  ›", 13.5f, true).apply {
            isFocusable = true
            isClickable = true
            contentDescription = "View all movies"
            setPadding(dp(12), dp(5), dp(12), dp(5))
            background = buttonGlass(0xFF5B279F.toInt(), 0xFF291247.toInt(), false)
            setOnClickListener { onViewMovies?.invoke() }
            setOnFocusChangeListener { v, focused ->
                v.background = buttonGlass(0xFF9441D9.toInt(), 0xFF3F1964.toInt(), focused)
            }
        }
        moviesHeader.addView(moreMovies)
        addView(moviesHeader, LayoutParams(-1, dp(36)))
    }

    fun bindFeatured(item: Show?) {
        val title = when (item) {
            is Movie -> item.title
            is TvShow -> item.title
            else -> null
        }
        val description = when (item) {
            is Movie -> item.overview
            is TvShow -> item.overview
            else -> null
        }
        val image = when (item) {
            is Movie -> item.banner ?: item.poster
            is TvShow -> item.banner ?: item.poster
            else -> null
        }
        heroTitle.text = title ?: "YOUR VOD LIBRARY"
        heroDescription.text = description?.take(125) ?: "Browse movies, series and your favorite platforms"
        heroDescription.maxLines = 2
        watch.isEnabled = item != null
        watch.alpha = if (item != null) 1f else 0.65f
        if (image != null) {
            Glide.with(banner).load(image).into(banner)
        } else {
            Glide.with(banner).clear(banner)
        }
    }

    fun reportCatalogError() {
        heroDescription.text = "The VOD library could not be refreshed. Press Watch Now to retry."
        watch.text = "↻  Retry Library"
        watch.isEnabled = true
        watch.alpha = 1f
    }

    fun restoreWatchButton() {
        watch.text = "▶  Watch Now"
    }

    private fun label(value: String, size: Float, bold: Boolean) = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(Color.WHITE)
        setTypeface(typeface, if (bold) Typeface.BOLD else Typeface.NORMAL)
        isFocusable = false
        gravity = Gravity.CENTER_VERTICAL
        maxLines = 2
    }

    private fun buttonGlass(a: Int, b: Int, focused: Boolean) =
        GradientDrawable(GradientDrawable.Orientation.TL_BR,
            intArrayOf(if (focused) a else (a and 0x00FFFFFF or 0xD0000000.toInt()),
                if (focused) b else (b and 0x00FFFFFF or 0xB0000000.toInt()))
        ).apply {
            cornerRadius = dp(13).toFloat()
            setStroke(dp(if (focused) 2 else 1), if (focused) Color.WHITE else 0xA1EDB7FF.toInt())
        }

    private fun action(title: String, a: Int, b: Int): TextView =
        label(title, 14f, true).apply {
            gravity = Gravity.CENTER
            isFocusable = true
            isClickable = true
            setPadding(dp(12), 0, dp(12), 0)
            background = buttonGlass(a, b, false)
            setOnFocusChangeListener { view, focused ->
                view.background = buttonGlass(a, b, focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.065f else 1f)
                    .scaleY(if (focused) 1.065f else 1f)
                    .translationZ(if (focused) dp(9).toFloat() else 0f)
                    .setDuration(135).start()
            }
        }
}
