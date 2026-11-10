package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.view.View
import android.widget.TextView
import androidx.annotation.DrawableRes
import androidx.core.content.ContextCompat
import androidx.leanback.widget.BaseGridView
import androidx.navigation.findNavController
import com.streamflixreborn.streamflix.R

/** A press of Sources asks the next player to open its source list once it is ready. */
object VodSourceRequest {
    var pending = false
    /** A source picked on the title page, applied once the player has its list. */
    var chosen: String? = null
    fun take(): Boolean = pending.also { pending = false }
}

/** Lets the VOD player ask the host app for screens it does not own. */
object VodHostActions {
    var openGuide: (() -> Unit)? = null
}

/** The same row of glass buttons on every movie and series page. */
object VodTitleActions {
    private const val PURPLE = 0xFFA82BF2.toInt()
    private const val BLUE = 0xFF38B9ED.toInt()
    private const val PINK = 0xFFFF4FA0.toInt()
    private const val AMBER = 0xFFFFB347.toInt()
    private const val GLASS = 0xFFB68AF5.toInt()

    private fun View.px(value: Int) = (value * resources.displayMetrics.density + .5f).toInt()

    private fun style(button: TextView, @DrawableRes art: Int, tint: Int, primary: Boolean = false) {
        ContextCompat.getDrawable(button.context, art)?.let { icon ->
            icon.setBounds(0, 0, button.px(26), button.px(26))
            button.setCompoundDrawablesRelative(null, icon, null, null)
        }
        button.compoundDrawablePadding = button.px(2)
        button.setPadding(button.px(2), button.px(5), button.px(2), button.px(4))
        button.textSize = 11.5f
        button.setTextColor(Color.WHITE)
        fun paint(focused: Boolean) {
            button.background = VodGlass.surface(tint, button.px(13).toFloat(), button.px(1), focused, primary)
        }
        paint(false)
        button.setOnFocusChangeListener { view, focused ->
            paint(focused)
            VodHomeShelf.liftCard(view, focused)
        }
    }

    private fun grid(view: View): BaseGridView? {
        var parent = view.parent
        while (parent != null) {
            if (parent is BaseGridView) return parent
            parent = parent.parent
        }
        return null
    }

    fun attach(
        watch: TextView, sources: TextView, myList: TextView, trailer: TextView,
        similar: TextView, back: TextView, favorite: View, isFavorite: () -> Boolean,
        episodes: TextView? = null,
        heart: TextView,
        panels: android.view.ViewGroup,
        heartKey: String,
        heartTitle: String,
        heartPoster: String?,
    ) {
        style(watch, R.drawable.vod_action_watch, PURPLE, primary = true)
        style(sources, R.drawable.vod_action_sources, BLUE)
        style(myList, R.drawable.vod_action_mylist, PINK)
        style(trailer, R.drawable.vod_action_trailer, AMBER)
        style(similar, R.drawable.vod_action_similar, GLASS)
        style(back, R.drawable.vod_action_back, GLASS)
        episodes?.let { style(it, R.drawable.vod_action_episodes, BLUE) }
        style(heart, R.drawable.vod_action_favorite, PINK)
        fun heartLabel() { heart.text = if (VodHearts.contains(heart.context, heartKey)) "Favorited" else "Favorite" }
        heartLabel()
        heart.setOnClickListener {
            VodHearts.toggle(heart.context, heartKey, heartTitle, heartPoster)
            heartLabel()
        }

        fun label() { myList.text = if (isFavorite()) "In My List" else "My List" }
        label()
        sources.setOnClickListener {
            if (panels.findViewWithTag<View>(VodTitlePanels.FIRST_SOURCE)?.requestFocus() == true) return@setOnClickListener
            // A series with nothing queued to watch has no Watch action; offer its episodes instead.
            if (watch.visibility != View.VISIBLE) {
                panels.findViewWithTag<View>(VodTitlePanels.FIRST_EPISODE)?.requestFocus()
                return@setOnClickListener
            }
            VodSourceRequest.pending = true
            watch.performClick()
        }
        myList.setOnClickListener {
            favorite.performClick()
            // The save runs in the background and updates the title when done.
            myList.postDelayed({ label() }, 350L)
            myList.postDelayed({ label() }, 1000L)
        }
        back.setOnClickListener { it.findNavController().navigateUp() }
        similar.setOnClickListener { view ->
            grid(view)?.let { it.setSelectedPositionSmooth((it.adapter?.itemCount ?: 1) - 1) }
        }
        episodes?.setOnClickListener { view ->
            if (panels.findViewWithTag<View>(VodTitlePanels.FIRST_EPISODE)?.requestFocus() != true) grid(view)?.setSelectedPositionSmooth(1)
        }
    }
}
