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
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.DrawableCompat
import com.streamflixreborn.streamflix.R

/**
 * GPU-light glass action bar for the existing View/Leanback VOD module.
 * The app does not enable Jetpack Compose in this module. This native View
 * equivalent preserves 10-foot readability, scale/elevation, remote focus,
 * and edge padding without adding an entire Compose runtime to the APK.
 */
class VodGlassActionBar @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : HorizontalScrollView(context, attrs) {

    private data class Action(val id: Int, val title: String, val icon: Int)
    private val actions = listOf(
        Action(R.id.home, "Home", R.drawable.ic_menu_home),
        Action(R.id.search, "Search", R.drawable.ic_menu_search),
        Action(R.id.movies, "Movies", R.drawable.ic_menu_movie),
        Action(R.id.tv_shows, "TV Shows", R.drawable.ic_menu_tv),
        Action(R.id.favorites, "My List", R.drawable.ic_favorite_enable),
        Action(R.id.settings, "Settings", R.drawable.ic_menu_settings),
    )
    private val strip = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        clipChildren = false
        clipToPadding = false
        setPadding(dp(40), dp(20), dp(40), dp(20))
    }
    private val buttons = LinkedHashMap<Int, TextView>()
    private var lastFocusedId = R.id.home
    var onNavigate: ((Int) -> Unit)? = null

    init {
        isHorizontalScrollBarEnabled = false
        isSmoothScrollingEnabled = true
        isFocusable = false
        clipChildren = false
        clipToPadding = false
        overScrollMode = View.OVER_SCROLL_NEVER
        setBackgroundColor(Color.TRANSPARENT)
        addView(strip, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT))
        actions.forEachIndexed { index, action ->
            val button = TextView(context).apply {
                id = View.generateViewId()
                text = action.title
                gravity = Gravity.CENTER
                textSize = 16f
                setTextColor(Color.rgb(239, 226, 255))
                setTypeface(typeface, Typeface.BOLD)
                setPadding(dp(15), 0, dp(15), 0)
                isFocusable = true
                isFocusableInTouchMode = false
                isClickable = true
                background = glassBackground(false)
                elevation = dp(5).toFloat()
                val icon = ContextCompat.getDrawable(context, action.icon)?.mutate()
                if (icon != null) {
                    val tinted = DrawableCompat.wrap(icon)
                    DrawableCompat.setTint(tinted, Color.WHITE)
                    tinted.setBounds(0, 0, dp(21), dp(21))
                    setCompoundDrawables(tinted, null, null, null)
                    compoundDrawablePadding = dp(10)
                }
                setOnClickListener { onNavigate?.invoke(action.id) }
                onFocusChangeListener = OnFocusChangeListener { view, hasFocus ->
                    if (hasFocus) lastFocusedId = action.id
                    background = glassBackground(hasFocus)
                    setTextColor(if (hasFocus) Color.WHITE else Color.rgb(239, 226, 255))
                    view.animate().cancel()
                    view.animate()
                        .scaleX(if (hasFocus) 1.10f else 1f)
                        .scaleY(if (hasFocus) 1.10f else 1f)
                        .translationY(if (hasFocus) -dp(5).toFloat() else 0f)
                        .translationZ(if (hasFocus) dp(17).toFloat() else 0f)
                        .setDuration(155L)
                        .start()
                    if (hasFocus) post {
                        val center = view.left + view.width / 2
                        smoothScrollTo((center - width / 2).coerceAtLeast(0), 0)
                    }
                }
            }
            strip.addView(button, LinearLayout.LayoutParams(dp(158), dp(60)).apply {
                rightMargin = if (index == actions.lastIndex) 0 else dp(16)
            })
            buttons[action.id] = button
        }
    }

    /** LEFT on the first visible VOD button enters the icon rail exactly once. */
    fun isFirstActionFocused(view: View): Boolean =
        buttons.values.firstOrNull { it.visibility == View.VISIBLE } === view

    fun focusLastAction(): Boolean {
        val view = buttons[lastFocusedId]?.takeIf { it.visibility == View.VISIBLE }
            ?: buttons.values.firstOrNull { it.visibility == View.VISIBLE }
        return view?.requestFocus() == true
    }

    fun setAvailable(showMovies: Boolean, showShows: Boolean) {
        buttons[R.id.movies]?.visibility = if (showMovies) View.VISIBLE else View.GONE
        buttons[R.id.tv_shows]?.visibility = if (showShows) View.VISIBLE else View.GONE
        if (buttons[lastFocusedId]?.visibility == View.GONE) lastFocusedId = R.id.home
    }

    private fun glassBackground(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xC69F61E9.toInt(), 0xC1783CB7.toInt(), 0xD35A248D.toInt())
        else intArrayOf(0x5CFFFFFF, 0x6C7F429E, 0x80421E62.toInt()),
    ).apply {
        cornerRadius = dp(14).toFloat()
        setStroke(dp(if (focused) 2 else 1), if (focused) Color.rgb(245, 215, 255) else 0x8FCFA6E6.toInt())
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + .5f).toInt()
}
