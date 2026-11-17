package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.Typeface
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.constraintlayout.widget.ConstraintSet
import androidx.fragment.app.Fragment

/**
 * A page title for a phone VOD screen that otherwise has nothing on it saying what page it is
 * (Movies, TV Shows, ...): the header Genres and Platforms already have. Pushes `content` down to
 * start below it, rather than floating over it, so [VodPhoneGenreChips] can add a chip row under the
 * title without covering the first grid row. Phone host only: on TV, or when the root is not a
 * ConstraintLayout, this is a no-op and returns null.
 */
object VodPhoneHeader {
    fun attach(fragment: Fragment, root: ViewGroup, content: View, title: String): LinearLayout? {
        if (fragment.parentFragment?.parentFragment !is VodRootMobileFragment) return null
        val constraintRoot = root as? ConstraintLayout ?: return null
        val context = fragment.requireContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val container = LinearLayout(context).apply {
            id = View.generateViewId()
            orientation = LinearLayout.VERTICAL
        }
        container.addView(TextView(context).apply {
            text = title
            textSize = 22f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(14), dp(10), dp(14), dp(4))
        })
        constraintRoot.addView(container, ConstraintLayout.LayoutParams(
            ConstraintLayout.LayoutParams.MATCH_CONSTRAINT, ConstraintLayout.LayoutParams.WRAP_CONTENT))
        ConstraintSet().apply {
            clone(constraintRoot)
            connect(container.id, ConstraintSet.TOP, ConstraintSet.PARENT_ID, ConstraintSet.TOP)
            connect(container.id, ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START)
            connect(container.id, ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END)
            // The content keeps whatever start/end/bottom it already had; only its top moves down,
            // so this does not disturb the existing grid/list constraints otherwise.
            connect(content.id, ConstraintSet.TOP, container.id, ConstraintSet.BOTTOM)
            applyTo(constraintRoot)
        }
        return container
    }
}
