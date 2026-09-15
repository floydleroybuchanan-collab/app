package com.streamflixreborn.streamflix.charm

import android.view.View
import android.widget.LinearLayout
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.RecyclerView
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow

object CharmCatalogControls {
    private data class Selection(val items: List<AppAdapter.Item>, val filter: String="All", val sort: Int=0)
    fun submit(grid: RecyclerView, items: List<AppAdapter.Item>) {
        val prior=grid.getTag(R.id.charm_catalog_state) as? Selection
        grid.setTag(R.id.charm_catalog_state,Selection(items,prior?.filter?:"All",prior?.sort?:0));render(grid)
    }
    private fun render(grid: RecyclerView) {
        val state=grid.getTag(R.id.charm_catalog_state) as? Selection ?: return
        val items=when(state.filter) {
            "Highest rated" -> state.items.sortedByDescending { when(it) {is Movie->it.rating?:0.0;is TvShow->it.rating?:0.0;else->0.0} }
            "Newest release" -> state.items.sortedByDescending { when(it) {is Movie->it.released?.timeInMillis?:0L;is TvShow->it.released?.timeInMillis?:0L;else->0L} }
            "Continue watching" -> state.items.filter { when(it) {is Movie->it.watchHistory!=null;is TvShow->it.lastPlayedAtMillis!=null;else->false} }
            else -> state.items
        }
        val sorted=when(state.sort) {
            1 -> items.sortedBy { when(it) {is Movie->it.title.lowercase();is TvShow->it.title.lowercase();else->""} }
            2 -> items.sortedByDescending { when(it) {is Movie->it.title.lowercase();is TvShow->it.title.lowercase();else->""} }
            3 -> items.sortedByDescending { when(it) {is Movie->it.released?.timeInMillis?:0L;is TvShow->it.released?.timeInMillis?:0L;else->0L} }
            else -> items
        }
        (grid.adapter as? AppAdapter)?.submitList(sorted)
    }
    fun controls(fragment: Fragment, grid: RecyclerView): View {
        val row=LinearLayout(grid.context).apply { orientation=LinearLayout.HORIZONTAL }
        listOf("All","Highest rated","Newest release","Continue watching","Sort","Genres").forEach { label ->
            row.addView(CharmVodPageLayout.chip(grid,label).apply {
                textSize=12f;isSelected=label=="All"
                setOnClickListener {
                    if(label=="Genres") { CharmGenreMenu.show(fragment);return@setOnClickListener }
                    if(label=="Sort") {
                        CharmDialogBuilder(context).setTitle("Sort library").setItems(arrayOf("Source order","Title A–Z","Title Z–A","Newest release")) { _,which ->
                            (grid.getTag(R.id.charm_catalog_state) as? Selection)?.let {grid.setTag(R.id.charm_catalog_state,it.copy(sort=which));render(grid)}
                        }.setNegativeButton("Cancel",null).show()
                    } else {
                        (grid.getTag(R.id.charm_catalog_state) as? Selection)?.let {grid.setTag(R.id.charm_catalog_state,it.copy(filter=label));render(grid)}
                        for(i in 0 until row.childCount)row.getChildAt(i).isSelected=row.getChildAt(i)===this
                    }
                }
            },LinearLayout.LayoutParams(-2,-2).apply {marginEnd=8})
        }
        return row
    }
}
