package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.core.content.res.ResourcesCompat
import androidx.core.view.doOnLayout
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.leanback.widget.BaseGridView
import androidx.leanback.widget.VerticalGridView
import androidx.navigation.NavController
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.models.Genre
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow

/** Insets belong to scrolling content, never to the artwork or navigation host. */
object CharmVodPageLayout {
    private fun View.dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    fun observeArtwork(activity: FragmentActivity, root: View, backdrop: ImageView, nav: NavController) {
        var lastUrl: String? = null
        val listener = ViewTreeObserver.OnGlobalFocusChangeListener { _, focused ->
            if (nav.currentDestination?.id !in setOf(R.id.movies, R.id.tv_shows, R.id.search, R.id.genre, R.id.favorites, R.id.people, R.id.season)) return@OnGlobalFocusChangeListener
            var target = focused
            var url: String? = null
            while (target != null && url == null) {
                url = target.getTag(R.id.charm_artwork_url) as? String
                target = target.parent as? View
            }
            if (!url.isNullOrBlank() && url != lastUrl) {
                lastUrl = url
                Glide.with(activity).load(url).override(1280, 720).centerCrop().into(backdrop)
            }
        }
        root.viewTreeObserver.addOnGlobalFocusChangeListener(listener)
        activity.lifecycle.addObserver(object : androidx.lifecycle.DefaultLifecycleObserver {
            override fun onDestroy(owner: androidx.lifecycle.LifecycleOwner) {
                if (root.viewTreeObserver.isAlive) root.viewTreeObserver.removeOnGlobalFocusChangeListener(listener)
            }
        })
        nav.addOnDestinationChangedListener { _, destination, _ ->
            backdrop.alpha = if (destination.id == R.id.settings) .18f else 1f
        }
    }

    fun attach(fragment: Fragment, view: View) {
        if (fragment.javaClass.simpleName.contains("Settings")) return
        val root = view as? ConstraintLayout ?: return
        val grid = (0 until root.childCount).map { root.getChildAt(it) }.filterIsInstance<RecyclerView>().firstOrNull() ?: return
        if (grid.getTag(R.id.charm_page_setup) == true) return
        grid.setTag(R.id.charm_page_setup, true)
        val page = fragment.javaClass.simpleName
        val header = LinearLayout(root.context).apply { orientation = LinearLayout.VERTICAL }
        val title = when (page) {
            "MoviesTvFragment" -> "Movies"
            "TvShowsTvFragment" -> "TV shows"
            "SearchTvFragment" -> "Find your next favorite"
            "FavoritesTvFragment" -> "My list"
            "ProvidersTvFragment" -> "Choose your VOD source"
            else -> null
        }
        title?.let { label ->
            header.addView(TextView(root.context).apply {
                text = label; textSize = 28f; setTextColor(0xFFECEBF2.toInt())
                typeface = ResourcesCompat.getFont(context, R.font.charm_geist_semibold)
                setPadding(0, 0, 0, dp(14))
            })
        }
        // Existing search/genre/favorite controls keep their IDs, listeners and values.
        val controls = when (page) {
            "SearchTvFragment" -> listOf(R.id.cl_search)
            "GenreTvFragment" -> listOf(R.id.tv_genre_name)
            "SeasonTvFragment" -> listOf(R.id.tv_season_title)
            "FavoritesTvFragment" -> listOf(R.id.btn_favorites_reorder_mode, R.id.btn_favorites_reorder)
            else -> emptyList()
        }
        controls.mapNotNull { root.findViewById<View>(it) }.forEach { control ->
            (control.parent as? ViewGroup)?.removeView(control)
            header.addView(control, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = root.dp(10) })
        }
        if (fragment is com.streamflixreborn.streamflix.fragments.search.SearchTvFragment) {
            root.findViewById<View>(R.id.ll_global_search)?.let { header.addView(fragment.designFilters(it)) }
        }
        if (page == "PeopleTvFragment") {
            val portraitHeader = ConstraintLayout(root.context)
            val parts=(0 until root.childCount).map { root.getChildAt(it) }.filter { it !== grid && it.id != R.id.is_loading && it !is RecyclerView }
            parts.forEach { root.removeView(it);portraitHeader.addView(it) }
            header.addView(portraitHeader)
        }
        if (page == "MoviesTvFragment" || page == "TvShowsTvFragment") {
            header.addView(CharmCatalogControls.controls(fragment,grid))
            (grid as? VerticalGridView)?.setNumColumns(4)
        }
        if (header.childCount > 0) root.addView(header)
        grid.doOnLayout {
            val left = (root.width * .135f).toInt()
            val top = (root.width * .162f).toInt()
            val right = (root.width * .024f).toInt()
            (grid.layoutParams as? ConstraintLayout.LayoutParams)?.apply {
                startToEnd = ConstraintLayout.LayoutParams.UNSET
                startToStart = ConstraintLayout.LayoutParams.PARENT_ID
                endToEnd = ConstraintLayout.LayoutParams.PARENT_ID
                topToBottom = ConstraintLayout.LayoutParams.UNSET
                topToTop = ConstraintLayout.LayoutParams.PARENT_ID
                bottomToBottom = ConstraintLayout.LayoutParams.PARENT_ID
                marginStart = left; marginEnd = right; topMargin = 0
                width = 0; height = 0
                grid.layoutParams = this
            }
            val available = (root.width - left - right).coerceAtLeast(1)
            header.measure(View.MeasureSpec.makeMeasureSpec(available, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            if (header.childCount > 0) header.layoutParams = ConstraintLayout.LayoutParams(available, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                startToStart = ConstraintLayout.LayoutParams.PARENT_ID; topToTop = ConstraintLayout.LayoutParams.PARENT_ID
                marginStart = left; topMargin = top
            }
            grid.setPadding(0, top + if (header.childCount > 0) header.measuredHeight + root.dp(18) else 0, 0, root.dp(32))
            grid.clipToPadding = false
            grid.nextFocusLeftId = R.id.nav_main
            if (grid is VerticalGridView) {
                grid.windowAlignment = BaseGridView.WINDOW_ALIGN_LOW_EDGE
                grid.windowAlignmentOffset = top + root.dp(72)
                grid.windowAlignmentOffsetPercent = BaseGridView.WINDOW_ALIGN_OFFSET_PERCENT_DISABLED
            }
        }
        var distance = 0
        grid.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                distance = (distance + dy).coerceAtLeast(0)
                if (grid is VerticalGridView) header.translationY = -distance.toFloat()
            }
        })
        CharmDesign.styleTree(header)
    }

    fun chip(root: View, label: String) = TextView(root.context).apply {
        text = label; textSize = 13f; setTextColor(Color.WHITE)
        gravity = Gravity.CENTER; setPadding(dp(18), dp(10), dp(18), dp(10))
        isFocusable = true; isFocusableInTouchMode = true; isClickable = true
        setBackgroundResource(R.drawable.charm_vod_chip)
        typeface = ResourcesCompat.getFont(context, R.font.charm_geist_regular)
    }
}
