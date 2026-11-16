package com.streamflixreborn.streamflix.charm

import android.os.Bundle
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.constraintlayout.widget.ConstraintSet
import androidx.navigation.NavController
import com.streamflixreborn.streamflix.R

/**
 * Phone Home: the platform buttons (Netflix, Disney+, ...) in a swipeable row above the shelves,
 * as in the approved design. Each opens that platform's page. Phone host only.
 */
object VodPhoneHomeStrip {
    fun attach(root: ConstraintLayout, list: View, providerLogo: View, nav: NavController) {
        val context = root.context
        val density = context.resources.displayMetrics.density
        fun dp(n: Int) = (n * density + .5f).toInt()
        providerLogo.visibility = View.GONE
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(12), dp(8), dp(12), dp(4))
        }
        VodPlatformCatalog.pagePlatforms.forEach { platform ->
            row.addView(VodPlatformBadgeView(context, platform).apply {
                asRemoteTarget("Open ${platform.label}", {
                    nav.navigate(R.id.platform_titles, Bundle().apply { putString("platformId", platform.id) })
                })
            }, LinearLayout.LayoutParams(dp(104), dp(72)).apply { marginEnd = dp(8) })
        }
        val strip = HorizontalScrollView(context).apply {
            id = View.generateViewId()
            isHorizontalScrollBarEnabled = false
            addView(row)
        }
        root.addView(strip, ConstraintLayout.LayoutParams(ConstraintLayout.LayoutParams.MATCH_CONSTRAINT,
            ConstraintLayout.LayoutParams.WRAP_CONTENT))
        ConstraintSet().apply {
            clone(root)
            connect(strip.id, ConstraintSet.TOP, ConstraintSet.PARENT_ID, ConstraintSet.TOP)
            connect(strip.id, ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START)
            connect(strip.id, ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END)
            connect(list.id, ConstraintSet.TOP, strip.id, ConstraintSet.BOTTOM)
            applyTo(root)
        }
    }
}
