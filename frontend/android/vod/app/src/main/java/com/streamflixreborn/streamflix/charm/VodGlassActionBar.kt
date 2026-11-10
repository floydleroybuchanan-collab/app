package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.AttributeSet
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.streamflixreborn.streamflix.R

/**
 * Seven focusable glass artwork actions over ONE native VOD NavHost.
 * A row of big vertically stacked icons and labels matches the TV design;
 * it is not a second rail or a second navigation activity.
 */
class VodGlassActionBar @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : HorizontalScrollView(context, attrs) {
    private data class Action(
        val id: Int, val title: String, val art: String, val first: Int, val second: Int,
    )
    private val actions = listOf(
        Action(R.id.home, "Home", "home", 0xFF0DCBF9.toInt(), 0xFFFF6B4B.toInt()),
        Action(R.id.search, "Search", "search", 0xFF18C3FF.toInt(), 0xFFDD35F9.toInt()),
        Action(R.id.movies, "Movies", "movies", 0xFFFF7835.toInt(), 0xFFDE2ECB.toInt()),
        Action(R.id.tv_shows, "TV Shows", "shows", 0xFF0DD7F8.toInt(), 0xFFF03BBE.toInt()),
        Action(R.id.favorites, "My List", "favorites", 0xFFF4379E.toInt(), 0xFFFFAF35.toInt()),
        Action(R.id.genre_hub, "Genres", "genres", 0xFFFFA136.toInt(), 0xFFC02AF4.toInt()),
        Action(R.id.platforms, "Platforms", "platforms", 0xFF18C7FB.toInt(), 0xFFA942FA.toInt()),
    )
    private val strip = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        clipChildren = false
        clipToPadding = false
        setPadding(dp(8), dp(4), dp(12), dp(4))
    }
    private val buttons = LinkedHashMap<Int, View>()
    private var lastFocusedId = R.id.home
    var onNavigate: ((Int) -> Unit)? = null

    init {
        isHorizontalScrollBarEnabled = false
        isFillViewport = true
        isSmoothScrollingEnabled = true
        isFocusable = false
        clipChildren = false
        clipToPadding = false
        overScrollMode = View.OVER_SCROLL_NEVER
        setBackgroundColor(Color.TRANSPARENT)
        // Match the full-width seven-column header in the approved mockup;
        // minimum width preserves readable DPAD targets on compact TV displays.
        strip.minimumWidth = dp(7 * 112)
        addView(strip, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        actions.forEachIndexed { index, action ->
            val button = LinearLayout(context).apply {
                id = View.generateViewId()
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                isFocusable = true
                isFocusableInTouchMode = false
                isClickable = true
                contentDescription = action.title
                setPadding(dp(4), dp(3), dp(4), dp(5))
                clipChildren = false
                clipToPadding = false
                background = buttonGlass(false, action.first, action.second)
                elevation = dp(6).toFloat()
                val icon = ImageView(context).apply {
                    setImageDrawable(CharmingVodTopIcon(action.art, action.first, action.second))
                    scaleType = ImageView.ScaleType.FIT_CENTER
                    isFocusable = false
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                }
                addView(icon, LinearLayout.LayoutParams(dp(72), dp(73)))
                addView(TextView(context).apply {
                    text = action.title
                    gravity = Gravity.CENTER
                    textSize = 15.5f
                    setTextColor(Color.WHITE)
                    setTypeface(typeface, Typeface.BOLD)
                    isFocusable = false
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                    maxLines = 1
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24)))
                setOnClickListener { onNavigate?.invoke(action.id) }
                onFocusChangeListener = View.OnFocusChangeListener { view, focused ->
                    if (focused) lastFocusedId = action.id
                    background = buttonGlass(focused, action.first, action.second)
                    view.animate().cancel()
                    view.animate()
                        .scaleX(if (focused) 1.08f else 1f)
                        .scaleY(if (focused) 1.08f else 1f)
                        .translationZ(if (focused) dp(16).toFloat() else 0f)
                        .setDuration(140L)
                        .start()
                    if (focused) post {
                        val center = view.left + view.width / 2
                        smoothScrollTo((center - width / 2).coerceAtLeast(0), 0)
                    }
                }
            }
            strip.addView(button, LinearLayout.LayoutParams(0, dp(110), 1f).apply {
                rightMargin = if (index == actions.lastIndex) 0 else dp(5)
            })
            buttons[action.id] = button
        }
    }

    /** LEFT at the first glass button transfers to the existing host icon rail. */
    fun isFirstActionFocused(view: View): Boolean =
        buttons.values.firstOrNull { it.visibility == View.VISIBLE } === view

    fun focusLastAction(): Boolean {
        val preferred = buttons[lastFocusedId]?.takeIf { it.visibility == View.VISIBLE }
            ?: buttons.values.firstOrNull { it.visibility == View.VISIBLE }
        return preferred?.requestFocus() == true
    }

    fun setAvailable(showMovies: Boolean, showShows: Boolean) {
        buttons[R.id.movies]?.visibility = if (showMovies) View.VISIBLE else View.GONE
        buttons[R.id.tv_shows]?.visibility = if (showShows) View.VISIBLE else View.GONE
        if (buttons[lastFocusedId]?.visibility == View.GONE) lastFocusedId = R.id.home
    }

    private fun buttonGlass(focused: Boolean, a: Int, b: Int) =
        GradientDrawable(GradientDrawable.Orientation.TL_BR,
            if (focused) intArrayOf(a and 0x00FFFFFF or 0xC1000000.toInt(),
                b and 0x00FFFFFF or 0x9A000000.toInt(), 0xA72E1056.toInt())
            else intArrayOf(0x140F0821, 0x1B12072A, 0x1A180A2A)
        ).apply {
            cornerRadius = dp(16).toFloat()
            setStroke(dp(if (focused) 2 else 0), if (focused) 0xFFE6B5FF.toInt() else Color.TRANSPARENT)
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + .5f).toInt()
}
