package com.streamflixreborn.streamflix.charm

import android.os.Bundle
import android.view.ViewGroup
import android.widget.GridLayout
import android.widget.ScrollView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.models.Genre
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object CharmGenreMenu {
    fun show(fragment: Fragment, available: List<Genre>? = null) {
        fragment.viewLifecycleOwner.lifecycleScope.launch {
            val genres = try { available ?: withContext(Dispatchers.IO) { UserPreferences.currentProvider?.search("")?.filterIsInstance<Genre>().orEmpty() } }
            catch (_: Exception) { emptyList() }
            if (!fragment.isAdded) return@launch
            val context = fragment.requireContext()
            val grid = GridLayout(context).apply { columnCount=3; setPadding(18,18,18,18) }
            val scroll = ScrollView(context).apply { addView(grid) }
            val dialog = CharmDialogBuilder(context).setTitle("Explore a genre").setView(scroll).setNegativeButton("Close",null).create()
            if (genres.isEmpty()) grid.addView(android.widget.TextView(context).apply { text="Genres are unavailable for this source. Try searching by title.";setPadding(20,20,20,20) })
            genres.forEach { genre ->
                grid.addView(CharmVodPageLayout.chip(grid,genre.name).apply {
                    setOnClickListener { dialog.dismiss(); fragment.findNavController().navigate(R.id.genre, Bundle().apply { putString("id",genre.id);putString("name",genre.name) }) }
                }, GridLayout.LayoutParams().apply { width=0; height=ViewGroup.LayoutParams.WRAP_CONTENT; columnSpec=GridLayout.spec(GridLayout.UNDEFINED,1f);setMargins(6,6,6,6) })
            }
            dialog.show()
            dialog.window?.setLayout((context.resources.displayMetrics.widthPixels*.62f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
        }
    }
}
