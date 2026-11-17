package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.Fragment

/**
 * The genre filter row (All / Drama / Comedy / ...) under a [VodPhoneHeader] title on a phone VOD
 * grid. Chips are built from whatever genres are actually present in the titles loaded so far (there
 * is no separate genre list to ask the provider for), so the row grows as paging loads more titles.
 * Phone host only; call this only when [VodPhoneHeader.attach] returned a non-null container.
 */
object VodPhoneGenreChips {
    /**
     * Adds the chip row to `container` (appended under the title). Returns a function the caller
     * passes every title list it gets from its ViewModel: it grows the chip set from those titles'
     * genres and re-applies whatever chip is currently selected via `onFilterChanged`.
     */
    fun <T> attach(fragment: Fragment, container: LinearLayout, genresOf: (T) -> List<String>, onFilterChanged: (String?) -> Unit): (List<T>) -> Unit {
        val context = fragment.requireContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), 0, dp(10), dp(8))
        }
        val scroller = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            addView(row)
        }
        container.addView(scroller)
        val known = linkedSetOf<String>()
        var selected: String? = null
        val chips = LinkedHashMap<String?, TextView>()
        fun style(chip: TextView, on: Boolean) {
            chip.setTextColor(Color.WHITE)
            chip.background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat()
                setColor(if (on) 0xCC9A5CF0.toInt() else 0x59965AEB)
                setStroke(dp(1), if (on) Color.WHITE else 0x80C8A8FF.toInt())
            }
        }
        fun addChip(label: String, value: String?) {
            val chip = TextView(context).apply {
                text = label
                textSize = 13f
                setPadding(dp(14), dp(7), dp(14), dp(7))
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    selected = value
                    chips.forEach { (v, c) -> style(c, v == selected) }
                    onFilterChanged(selected)
                }
            }
            style(chip, value == selected)
            chips[value] = chip
            row.addView(chip, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dp(8) })
        }
        addChip("All", null)
        return update@{ items ->
            val found = items.asSequence().flatMap { genresOf(it).asSequence() }
                .map { it.trim() }.filter { it.isNotEmpty() }.toSortedSet()
            val added = found - known
            if (added.isNotEmpty()) {
                known += added
                for (name in added.sorted()) addChip(name, name)
            }
            onFilterChanged(selected)
        }
    }
}
