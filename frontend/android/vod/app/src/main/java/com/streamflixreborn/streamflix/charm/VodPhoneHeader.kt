package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.Typeface
import android.view.ViewGroup
import android.widget.TextView
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.constraintlayout.widget.ConstraintSet
import androidx.fragment.app.Fragment

/**
 * A floating glass page title for a phone VOD screen that otherwise has nothing on it saying what
 * page it is (Movies, TV Shows, ...): the Live TV-style page header Genres and Platforms already
 * have. Floats over the top of the grid rather than pushing it down, so no layout XML needs editing.
 * Phone host only: on TV, or when the root is not a ConstraintLayout, this is a no-op.
 */
object VodPhoneHeader {
    fun attach(fragment: Fragment, root: ViewGroup, title: String) {
        if (fragment.parentFragment?.parentFragment !is VodRootMobileFragment) return
        val constraintRoot = root as? ConstraintLayout ?: return
        val context = fragment.requireContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val label = TextView(context).apply {
            id = android.view.View.generateViewId()
            text = title
            textSize = 22f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            setShadowLayer(dp(6).toFloat(), 0f, dp(2).toFloat(), 0x99000000.toInt())
            setPadding(dp(14), dp(8), dp(14), dp(8))
            elevation = dp(4).toFloat()
        }
        constraintRoot.addView(label, ConstraintLayout.LayoutParams(
            ConstraintLayout.LayoutParams.WRAP_CONTENT, ConstraintLayout.LayoutParams.WRAP_CONTENT))
        ConstraintSet().apply {
            clone(constraintRoot)
            connect(label.id, ConstraintSet.TOP, ConstraintSet.PARENT_ID, ConstraintSet.TOP, dp(4))
            connect(label.id, ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START, dp(8))
            applyTo(constraintRoot)
        }
    }
}
