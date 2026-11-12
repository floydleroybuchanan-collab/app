package com.streamflixreborn.streamflix.charm

import android.view.View
import androidx.recyclerview.widget.RecyclerView

/**
 * The "N Original" badge sits in a fixed corner of a title page, outside the
 * scrolling list, so it floated over the cast and "You may also like" rows.
 * Show it only while the page is at the top. Alpha only: the page code still
 * decides whether the title has a badge at all (visibility).
 */
object VodTitleBadge {
    fun hideWhenScrolled(list: RecyclerView, badge: View) {
        list.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                val target = if (recyclerView.canScrollVertically(-1)) 0f else 1f
                if (badge.alpha == target) return
                badge.animate().cancel()
                badge.animate().alpha(target).setDuration(150L).start()
            }
        })
    }
}
