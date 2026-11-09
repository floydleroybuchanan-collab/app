package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.AttributeSet
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.DrawableCompat
import com.streamflixreborn.streamflix.R

/**
 * Charming MediaLab's original *slim* VOD icon rail.
 * This never expands into the upstream provider/header/sidebar menu.
 * The drawer reached by BACK belongs to the outer Charming MediaLab host.
 */
class VodIconRail @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : LinearLayout(context, attrs) {
    private data class Entry(val id: Int, val icon: Int, val description: String)
    private val entries = listOf(
        Entry(R.id.home, R.drawable.ic_menu_home, "VOD home"),
        Entry(R.id.search, R.drawable.ic_menu_search, "Search"),
        Entry(R.id.movies, R.drawable.ic_menu_movie, "Movies"),
        Entry(R.id.tv_shows, R.drawable.ic_menu_tv, "TV shows"),
        Entry(R.id.favorites, R.drawable.ic_favorite_enable, "My list"),
        Entry(R.id.genre_hub, R.drawable.ic_menu_movie, "Genres"),
        Entry(R.id.platforms, R.drawable.ic_menu_tv, "Platforms"),
    )
    private val buttons = linkedMapOf<Int, ImageView>()
    private var lastId = R.id.home
    var onNavigate: ((Int) -> Unit)? = null

    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        isFocusable = false
        clipChildren = false
        clipToPadding = false
        setPadding(dp(7), dp(12), dp(7), dp(10))
        setBackgroundColor(Color.rgb(15, 11, 28))
        addView(ImageView(context).apply {
            setImageResource(R.drawable.medialab_rail)
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "Charming MediaLab"
            isFocusable = false
        }, LayoutParams(dp(48), dp(59)).apply { bottomMargin = dp(16) })
        entries.forEach { item ->
            val icon = ImageView(context).apply {
                id = View.generateViewId()
                isFocusable = true
                isFocusableInTouchMode = false
                isClickable = true
                contentDescription = item.description
                scaleType = ImageView.ScaleType.FIT_CENTER
                setPadding(dp(13), dp(13), dp(13), dp(13))
                ContextCompat.getDrawable(context, item.icon)?.mutate()?.let {
                    val drawable = DrawableCompat.wrap(it)
                    DrawableCompat.setTint(drawable, Color.rgb(202, 185, 223))
                    setImageDrawable(drawable)
                }
                background = backgroundFor(false)
                onFocusChangeListener = OnFocusChangeListener { v, focused ->
                    if (focused) lastId = item.id
                    background = backgroundFor(focused)
                    imageTintList = ColorStateList.valueOf(
                        if (focused) Color.WHITE else Color.rgb(202, 185, 223)
                    )
                    v.animate().cancel()
                    v.animate().scaleX(if (focused) 1.09f else 1f)
                        .scaleY(if (focused) 1.09f else 1f)
                        .translationZ(if (focused) dp(9).toFloat() else 0f)
                        .setDuration(140L).start()
                }
                setOnClickListener { onNavigate?.invoke(item.id) }
            }
            addView(icon, LayoutParams(dp(54), dp(52)).apply { bottomMargin = dp(6) })
            buttons[item.id] = icon
        }
    }

    fun focusLastAction(): Boolean {
        return (buttons[lastId]?.takeIf { it.visibility == View.VISIBLE }
            ?: buttons.values.firstOrNull { it.visibility == View.VISIBLE })?.requestFocus() == true
    }

    fun setAvailable(movies: Boolean, shows: Boolean) {
        buttons[R.id.movies]?.visibility = if (movies) View.VISIBLE else View.GONE
        buttons[R.id.tv_shows]?.visibility = if (shows) View.VISIBLE else View.GONE
        if (buttons[lastId]?.visibility == View.GONE) lastId = R.id.home
    }

    private fun backgroundFor(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xAD9C65D9.toInt(), 0xC04A236D.toInt())
        else intArrayOf(0x281D1936, 0x1A352047),
    ).apply {
        cornerRadius = dp(13).toFloat()
        setStroke(dp(if (focused) 2 else 1), if (focused) 0xFFCF9CF9.toInt() else 0x374A3567)
    }
    private fun dp(x: Int) = (x * resources.displayMetrics.density + .5f).toInt()
}
