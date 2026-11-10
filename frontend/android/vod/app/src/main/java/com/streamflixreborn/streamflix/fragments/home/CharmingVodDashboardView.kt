package com.streamflixreborn.streamflix.fragments.home

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.bumptech.glide.Glide
import com.streamflixreborn.streamflix.charm.VodGlass
import com.streamflixreborn.streamflix.charm.VodPlatformBadgeView
import com.streamflixreborn.streamflix.charm.VodPlatformCatalog
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.Show
import com.streamflixreborn.streamflix.models.TvShow
import java.util.Calendar

/**
 * The persistent top of the VOD home: featured hero, then twelve branded platforms
 * with their own View All actions. Poster shelves sit directly beneath it.
 * Sizes follow the approved 960x540 layout and scale with the screen.
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

    private val density = resources.displayMetrics.density
    private val screenScale =
        (resources.displayMetrics.heightPixels / density / 540f).coerceIn(0.8f, 1.5f)

    private fun dp(n: Float) = (n * screenScale * density + 0.5f).toInt()
    private fun dp(n: Int) = dp(n.toFloat())

    private val hero = FrameLayout(context)
    private val banner = ImageView(context)
    private val heroTitle = label("YOUR VOD LIBRARY", 25f, true).apply {
        maxLines = 2
        ellipsize = TextUtils.TruncateAt.END
    }
    private val heroQuality = label("", 10.5f, true).apply {
        gravity = Gravity.CENTER
        setPadding(dp(7), 0, dp(7), 0)
        background = GradientDrawable().apply {
            cornerRadius = dp(5).toFloat()
            setStroke(dp(1), 0xCCFFFFFF.toInt())
        }
        visibility = View.GONE
    }
    private val heroMetadata = label("MOVIES  |  SERIES  |  FAVORITES", 11f, false)
    private val heroDescription = label("Movies and series in your selected library", 11.5f, false).apply {
        maxLines = 2
        ellipsize = TextUtils.TruncateAt.END
    }
    private val heroDots = label("●  ○  ○  ○", 8f, true).apply { setTextColor(0xFFD9B3FF.toInt()) }
    private val watch = heroButton("▶  Watch Now", 0xFFA82BF2.toInt(), 0xFF5A14C4.toInt())
    private val myList = heroButton("＋  My List", 0xCC2A1B38.toInt(), 0xCC120A1C.toInt())

    init {
        orientation = VERTICAL
        isFocusable = false
        setPadding(dp(8), 0, dp(4), 0)
        setBackgroundColor(Color.TRANSPARENT)
        buildHero()
        buildPlatforms()
    }

    private fun buildHero() {
        hero.background = GradientDrawable().apply {
            setColor(0xFF160820.toInt())
            cornerRadius = dp(10).toFloat()
        }
        hero.outlineProvider = ViewOutlineProvider.BACKGROUND
        hero.clipToOutline = true
        banner.scaleType = ImageView.ScaleType.CENTER_CROP
        banner.isFocusable = false
        hero.addView(banner, FrameLayout.LayoutParams(-1, -1))
        hero.addView(View(context).apply {
            isFocusable = false
            background = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xF5090514.toInt(), 0xE00C0719.toInt(), 0x400C0719, 0x00000000),
            )
        }, FrameLayout.LayoutParams(-1, -1))

        val copy = LinearLayout(context).apply {
            orientation = VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(30), dp(10), dp(12), dp(10))
            isFocusable = false
        }
        val eyebrow = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        eyebrow.addView(View(context).apply { setBackgroundColor(0xFFA335F2.toInt()) }, LayoutParams(dp(2), dp(18)))
        eyebrow.addView(label("FEATURED", 9.5f, true).apply {
            letterSpacing = 0.34f
        }, LayoutParams(-2, -2).apply { leftMargin = dp(9) })
        copy.addView(eyebrow)
        copy.addView(heroTitle, LayoutParams(-1, -2).apply { topMargin = dp(3) })

        val meta = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        meta.addView(heroQuality, LayoutParams(-2, dp(16)).apply { rightMargin = dp(9) })
        meta.addView(heroMetadata)
        copy.addView(meta, LayoutParams(-1, -2).apply { topMargin = dp(4) })
        copy.addView(heroDescription, LayoutParams(-1, -2).apply { topMargin = dp(5) })

        val actions = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            clipChildren = false
            clipToPadding = false
        }
        actions.addView(watch, LayoutParams(dp(132), dp(27)))
        actions.addView(myList, LayoutParams(dp(104), dp(27)).apply { leftMargin = dp(16) })
        copy.addView(actions, LayoutParams(-1, dp(32)).apply { topMargin = dp(8) })

        hero.addView(copy, FrameLayout.LayoutParams((dp(880) * 0.46f).toInt(), -1, Gravity.START))
        hero.addView(heroDots, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = dp(4)
        })
        addView(hero, LayoutParams(-1, dp(197)))
        watch.setOnClickListener { onFeature?.invoke() }
        myList.setOnClickListener { onFavorites?.invoke() }
    }

    private fun buildPlatforms() {
        // All twelve scroll sideways inside this strip. Its bounds clip them,
        // so neither the buttons nor their glow can reach another part of the app.
        val scroll = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            isFocusable = false
            isSmoothScrollingEnabled = true
            clipChildren = true
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val tiles = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.TOP
            clipChildren = false
            clipToPadding = false
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }
        VodPlatformCatalog.platforms.forEach { platform ->
            val tile = LinearLayout(context).apply {
                orientation = VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                clipChildren = false
                clipToPadding = false
                isFocusable = false
            }
            val badge = VodPlatformBadgeView(context, platform, small = false).apply {
                isFocusable = true
                isClickable = true
                contentDescription = "Open ${platform.label}"
                setOnClickListener { onPlatform?.invoke(platform.id) }
                onFocusChangeListener = OnFocusChangeListener { _, focused ->
                    showFocus(focused)
                    if (focused) scroll.reveal(tile)
                }
            }
            tile.addView(badge, LayoutParams(dp(72), dp(44)))
            val viewAll = VodPlatformBadgeView(context, platform, small = false, pill = true)
            viewAll.asRemoteTarget(
                "View all ${platform.label}",
                onOpen = { onPlatform?.invoke(platform.id) },
                onFocused = { scroll.reveal(tile) },
            )
            tile.addView(viewAll, LayoutParams(dp(72), dp(18)).apply { topMargin = dp(1) })
            tiles.addView(tile, LayoutParams(dp(87), -2))
        }
        scroll.addView(tiles, FrameLayout.LayoutParams(-2, -2))
        addView(scroll, LayoutParams(-1, dp(75)).apply { topMargin = dp(1) })
    }

    /** Scrolls a whole tile into the strip, leaving room for its focus lift and glow. */
    private fun HorizontalScrollView.reveal(tile: View) {
        val start = tile.left - dp(4)
        val end = tile.right + dp(4)
        when {
            start < scrollX -> smoothScrollTo(start, 0)
            end > scrollX + width -> smoothScrollTo(end - width, 0)
        }
    }

    fun heroHasFocus(): Boolean = hero.hasFocus()

    /** Moves the dot marker; the fourth-of-four style matches the featured carousel. */
    fun setFeaturedPosition(index: Int, count: Int) {
        heroDots.visibility = if (count > 1) View.VISIBLE else View.INVISIBLE
        heroDots.text = (0 until count).joinToString("  ") { if (it == index) "●" else "○" }
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
        val quality = when (item) {
            is Movie -> item.quality
            is TvShow -> item.quality
            else -> null
        }
        val released = when (item) {
            is Movie -> item.released
            is TvShow -> item.released
            else -> null
        }
        val rating = when (item) {
            is Movie -> item.rating
            is TvShow -> item.rating
            else -> null
        }
        heroTitle.text = title ?: "YOUR VOD LIBRARY"
        heroDescription.text = description ?: "Browse movies, series and your favorite platforms"
        heroQuality.text = quality.orEmpty()
        heroQuality.visibility = if (quality.isNullOrBlank()) View.GONE else View.VISIBLE
        heroMetadata.text = listOfNotNull(
            released?.get(Calendar.YEAR)?.toString(),
            rating?.takeIf { it > 0 }?.let { "★ %.1f".format(it) },
            when (item) { is Movie -> "Movie"; is TvShow -> "Series"; else -> null },
        ).joinToString("   |   ")
        watch.isEnabled = item != null
        watch.alpha = if (item != null) 1f else 0.65f
        if (image != null) {
            Glide.with(banner).load(image.replace("/original/", "/w1280/")).into(banner)
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
        maxLines = 1
    }

    @Suppress("UNUSED_PARAMETER")
    private fun buttonGlass(a: Int, b: Int, focused: Boolean, glow: Boolean) =
        VodGlass.surface(a or 0xFF000000.toInt(), dp(14).toFloat(), dp(1), focused, glow)

    private fun heroButton(title: String, a: Int, b: Int): TextView =
        label(title, 12.5f, true).apply {
            val glow = a == 0xFFA82BF2.toInt()
            gravity = Gravity.CENTER
            isFocusable = true
            isClickable = true
            background = buttonGlass(a, b, false, glow)
            setOnFocusChangeListener { view, focused ->
                view.background = buttonGlass(a, b, focused, glow)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.065f else 1f)
                    .scaleY(if (focused) 1.065f else 1f)
                    .translationZ(if (focused) dp(9).toFloat() else 0f)
                    .setDuration(135).start()
            }
        }
}
