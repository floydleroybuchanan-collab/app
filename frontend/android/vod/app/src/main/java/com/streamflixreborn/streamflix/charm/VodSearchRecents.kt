package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.Color
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/** The last few things searched for, shown as glass chips while the search box is empty. */
object VodSearchRecents {
    private const val PREFS = "vod_search_recents"
    private const val KEY = "queries"
    private const val MAX = 6
    private const val MAX_LETTERS = 40
    private const val SEPARATOR = "\n"
    private const val TINT = 0xFFB68AF5.toInt()
    private const val FOCUS = 0xFFA82BF2.toInt()

    private fun View.px(value: Int) = (value * resources.displayMetrics.density + .5f).toInt()

    fun all(context: Context): List<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "").orEmpty()
            .split(SEPARATOR).filter { it.isNotBlank() }.take(MAX)

    fun add(context: Context, query: String) {
        val typed = query.trim().take(MAX_LETTERS).replace(SEPARATOR, " ")
        if (typed.length < 2) return
        val next = (listOf(typed) + all(context).filterNot { it.equals(typed, ignoreCase = true) }).take(MAX)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, next.joinToString(SEPARATOR)).apply()
    }

    /** Glass background that glows while [watched] has focus. */
    fun glass(surface: View, watched: View) {
        fun paint(focused: Boolean) {
            surface.background = VodGlass.surface(if (focused) FOCUS else TINT, surface.px(16).toFloat(), surface.px(1), focused)
        }
        paint(watched.isFocused)
        watched.setOnFocusChangeListener { _, focused -> paint(focused) }
    }

    /**
     * All / Movies / Series choice above the results. The chosen chip stays lit.
     * Chips are rebuilt only when a label or the choice changes.
     */
    fun filters(row: LinearLayout, labels: List<String>, selected: Int, pick: (Int) -> Unit) {
        if (labels.isEmpty()) {
            if (row.childCount > 0) row.removeAllViews()
            row.tag = null
            row.visibility = View.GONE
            return
        }
        val key = labels.joinToString("|") + "#" + selected
        row.visibility = View.VISIBLE
        if (row.tag == key) return
        val hadFocus = (0 until row.childCount).indexOfFirst { row.getChildAt(it).isFocused }
        row.tag = key
        row.removeAllViews()
        labels.forEachIndexed { index, label ->
            row.addView(TextView(row.context).apply {
                text = label
                textSize = 14f
                setTextColor(Color.WHITE)
                maxLines = 1
                gravity = Gravity.CENTER
                isFocusable = true
                isClickable = true
                setPadding(px(16), px(8), px(16), px(8))
                contentDescription = label
                setOnClickListener { pick(index) }
                fun paint(focused: Boolean) {
                    background = VodGlass.surface(if (focused) FOCUS else TINT, px(16).toFloat(), px(1), focused, active = index == selected)
                }
                paint(false)
                setOnFocusChangeListener { _, focused -> paint(focused) }
            }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = row.px(8) })
        }
        if (hadFocus >= 0) row.getChildAt(hadFocus)?.requestFocus()
    }

    /** Fills [row] with the recent searches when [visible]; hides it when there are none. */
    fun show(row: LinearLayout, visible: Boolean, pick: (String) -> Unit) {
        val queries = if (visible) all(row.context) else emptyList()
        if (queries.isEmpty()) {
            if (row.childCount > 0) row.removeAllViews()
            row.visibility = View.GONE
            return
        }
        if (row.visibility == View.VISIBLE && row.tag == queries) return
        row.tag = queries
        row.removeAllViews()
        queries.forEach { query ->
            row.addView(TextView(row.context).apply {
                text = query
                textSize = 14f
                setTextColor(Color.WHITE)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                gravity = Gravity.CENTER
                isFocusable = true
                isClickable = true
                maxWidth = px(170)
                setPadding(px(14), px(8), px(14), px(8))
                contentDescription = "Search again for $query"
                setOnClickListener { pick(query) }
                glass(this, this)
            }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = row.px(8) })
        }
        row.visibility = View.VISIBLE
    }
}
