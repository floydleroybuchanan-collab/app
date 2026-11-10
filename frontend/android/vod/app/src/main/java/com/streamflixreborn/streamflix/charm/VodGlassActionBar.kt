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
        Action(R.id.home, "Home", "home", 0xFF8E2BF0.toInt(), 0xFF4A0FA0.toInt()),
        Action(R.id.search, "Search", "search", 0xFF10418F.toInt(), 0xFF061E4D.toInt()),
        Action(R.id.movies, "Movies", "movies", 0xFFB01227.toInt(), 0xFF5A0A16.toInt()),
        Action(R.id.tv_shows, "TV Shows", "shows", 0xFF123F90.toInt(), 0xFF081F4F.toInt()),
        Action(R.id.favorites, "My List", "favorites", 0xFF0E8A3A.toInt(), 0xFF06451E.toInt()),
        Action(R.id.genre_hub, "Genres", "genres", 0xFFA8740F.toInt(), 0xFF553A08.toInt()),
        Action(R.id.platforms, "Platforms", "platforms", 0xFF4A2AB0.toInt(), 0xFF241358.toInt()),
    )
    private var activeId = R.id.home
    private val strip = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        clipChildren = false
        clipToPadding = false
        setPadding(dp(52), dp(6), dp(52), dp(7))
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
        strip.minimumWidth = dp(7 * 92)
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
                setPadding(dp(4), dp(2), dp(4), dp(2))
                clipChildren = false
                clipToPadding = false
                background = buttonGlass(false, action.id == activeId, action.first, action.second)
                elevation = dp(6).toFloat()
                val icon = ImageView(context).apply {
                    setImageDrawable(CharmingVodTopIcon(action.art, action.first, action.second))
                    scaleType = ImageView.ScaleType.FIT_CENTER
                    isFocusable = false
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                }
                addView(icon, LinearLayout.LayoutParams(dp(25), dp(25)))
                addView(TextView(context).apply {
                    text = action.title
                    gravity = Gravity.CENTER
                    textSize = 11.5f
                    setTextColor(Color.WHITE)
                    setTypeface(typeface, Typeface.BOLD)
                    isFocusable = false
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                    maxLines = 1
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(16)))
                setOnClickListener { onNavigate?.invoke(action.id) }
                onFocusChangeListener = View.OnFocusChangeListener { view, focused ->
                    if (focused) lastFocusedId = action.id
                    background = buttonGlass(focused, action.id == activeId, action.first, action.second)
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
            strip.addView(button, LinearLayout.LayoutParams(0, dp(49), 1f).apply {
                rightMargin = if (index == actions.lastIndex) 0 else dp(13)
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

    /** Highlights the section on screen; the focused button still reads above it. */
    fun setActiveDestination(id: Int) {
        if (id == activeId) return
        activeId = id
        actions.forEach { action ->
            val button = buttons[action.id] ?: return@forEach
            button.background = buttonGlass(button.isFocused, action.id == activeId, action.first, action.second)
        }
    }

    @Suppress("UNUSED_PARAMETER")
    private fun buttonGlass(focused: Boolean, active: Boolean, a: Int, b: Int) =
        VodGlass.surface(a, dp(10).toFloat(), dp(1), focused, active)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + .5f).toInt()
}
