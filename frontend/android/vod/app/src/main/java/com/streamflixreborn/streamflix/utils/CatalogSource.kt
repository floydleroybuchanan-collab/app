package com.streamflixreborn.streamflix.utils

import androidx.navigation.NavController
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.fragments.search.SearchCatalog
import com.streamflixreborn.streamflix.models.Category
import com.streamflixreborn.streamflix.models.Episode
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.providers.Provider

/** Source identity belongs to the retained screen, not the last result opened. */
object CatalogSource {
    private const val SOURCE_KEY = "medialab.catalog.source"
    private val installed = java.util.WeakHashMap<NavController, Boolean>()

    // Preserve the query/results backstack. Returning from a result belonging to
    // another provider restores the source needed by that screen's actions too.
    fun install(nav: NavController) {
        if (installed.put(nav, true) == true) return
        nav.addOnDestinationChangedListener { controller, _, _ ->
            val state = controller.currentBackStackEntry?.savedStateHandle
                ?: return@addOnDestinationChangedListener
            val saved = state.get<String>(SOURCE_KEY)
            if (saved == null) {
                UserPreferences.currentProvider?.name?.let { state[SOURCE_KEY] = it }
            } else if (saved != UserPreferences.currentProvider?.name) {
                provider(saved)?.let { UserPreferences.currentProvider = it }
            }
        }
    }

    fun provider(name: String): Provider? =
        UserPreferences.currentProvider?.takeIf { it.name == name }
            ?: SearchCatalog.resolve(name, Provider.providers.keys)

    fun <T : AppAdapter.Item> stamp(items: List<T>, name: String?): List<T> {
        if (name == null) return items
        items.forEach { item ->
            when (item) {
                is Movie -> if (item.providerName.isNullOrBlank()) item.providerName = name
                is TvShow -> if (item.providerName.isNullOrBlank()) item.providerName = name
                is Episode -> item.tvShow?.let { stamp(listOf(it), name) }
                is Category -> stamp(item.list, name)
            }
        }
        return items
    }
}
