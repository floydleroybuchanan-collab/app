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
        Action(R.id.genre_hub, "Genres", R.drawable.ic_menu_movie),
        Action(R.id.platforms, "Platforms", R.drawable.ic_menu_tv),
    )
    private val strip = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        clipChildren = false
        clipToPadding = false
        setPadding(dp(25), dp(13), dp(35), dp(13))
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
                textSize = 15.5f
                setTextColor(Color.rgb(239, 226, 255))
                setTypeface(typeface, Typeface.BOLD)
                setPadding(dp(15), 0, dp(15), 0)
                isFocusable = true
                isFocusableInTouchMode = false
                isClickable = true
                background = glassBackground(false)
                elevation = dp(5).toFloat()
                val colors = when(action.id) {
                    R.id.home -> intArrayOf(0xFF10BCE9.toInt(),0xFFFC7C37.toInt())
                    R.id.search -> intArrayOf(0xFF16C3F4.toInt(),0xFFD54CFB.toInt())
                    R.id.movies -> intArrayOf(0xFFF76A39.toInt(),0xFFDB3DCC.toInt())
                    R.id.tv_shows -> intArrayOf(0xFF25D4E6.toInt(),0xFFF659CB.toInt())
                    R.id.favorites -> intArrayOf(0xFFF83E88.toInt(),0xFFF69D30.toInt())
                    R.id.genre_hub -> intArrayOf(0xFFFFA13C.toInt(),0xFFD84BF2.toInt())
                    else -> intArrayOf(0xFF25C4F8.toInt(),0xFF9B4CFF.toInt())
                }
                val icon = GlassGlyphDrawable(context,action.icon,colors[0],colors[1]).apply {
                    setBounds(0,0,dp(35),dp(35))
                }
                setCompoundDrawables(icon, null, null, null)
                compoundDrawablePadding = dp(9)
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
            strip.addView(button, LinearLayout.LayoutParams(dp(150), dp(50)).apply {
                rightMargin = if (index == actions.lastIndex) 0 else dp(12)
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
        if (focused) intArrayOf(0x95BE8BD9.toInt(), 0x9B703A9D.toInt(), 0xA343207D.toInt())
        else intArrayOf(0x3EFFFFFF, 0x517B429A, 0x5E421D61),
    ).apply {
        cornerRadius = dp(16).toFloat()
        setStroke(dp(if (focused) 2 else 1), if (focused) Color.rgb(245, 215, 255) else 0x8FCFA6E6.toInt())
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + .5f).toInt()
}
