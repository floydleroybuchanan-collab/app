package com.streamflixreborn.streamflix.fragments.search

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.database.AppDatabase
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.providers.IptvProvider
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.utils.ParentalControlUtils
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// DEFINICIONES DE ESTADO Y RESULTADOS (Fuera de la clase para mejor acceso)
sealed class State {
    data object Searching : State()
    data object SearchingMore : State()
    data class SuccessSearching(val results: List<AppAdapter.Item>, val hasMore: Boolean) : State()
    data class FailedSearching(val error: Exception) : State()
    data object GlobalSearching : State()
    data class SuccessGlobalSearching(val providerResults: List<ProviderResult>) : State()
}

data class ProviderResult(
    val provider: Provider,
    val state: State,
) {
    sealed class State {
        data object Loading : State()
        data class Success(val results: List<AppAdapter.Item>) : State()
        data class Error(val error: Exception) : State()
    }
}


class SearchViewModel(database: AppDatabase) : ViewModel() {

    private val _state = MutableStateFlow<State>(State.Searching)
    @OptIn(ExperimentalCoroutinesApi::class)
    val state: Flow<State> = combine(
        _state,
        _state.transformLatest { state ->
            when (state) {
                is State.SuccessSearching -> {
                    val movies = state.results
                        .filterIsInstance<Movie>()
                    if (movies.isEmpty()) {
                        emit(emptyList())
                    } else {
                        emitAll(database.movieDao().getByIds(movies.map { it.id }))
                    }
                }
                else -> emit(emptyList<Movie>())
            }
        },
        _state.transformLatest { state ->
            when (state) {
                is State.SuccessSearching -> {
                    val tvShows = state.results
                        .filterIsInstance<TvShow>()
                    if (tvShows.isEmpty()) {
                        emit(emptyList())
                    } else {
                        emitAll(database.tvShowDao().getByIds(tvShows.map { it.id }))
                    }
                }
                else -> emit(emptyList<TvShow>())
            }
        },
    ) { state, moviesDb, tvShowsDb ->
        when (state) {
            is State.SuccessSearching -> {
                val moviesById = moviesDb.associateBy { it.id }
                val tvShowsById = tvShowsDb.associateBy { it.id }

                State.SuccessSearching(
                    results = state.results.map { item ->
                        when (item) {
                            is Movie -> moviesById[item.id]
                                ?.takeIf { !item.isSame(it) }
                                ?.let { item.copy().merge(it) }
                                ?: item
                            is TvShow -> tvShowsById[item.id]
                                ?.takeIf { !item.isSame(it) }
                                ?.let { item.copy().merge(it) }
                                ?: item
                            else -> item
                        }
                    },
                    hasMore = state.hasMore
                )
            }
            else -> state
        }
    }.flowOn(Dispatchers.IO)

    var query = ""
    private var page = 1

    private var searchJob: Job? = null
    private var pageJob: Job? = null
    private var searchedProvider: Provider? = null

    init { search(query) }

    fun search(query: String): Job {
        searchJob?.cancel()
        pageJob?.cancel()
        this.query = query.trim()
        page = 1
        val submittedQuery = this.query
        val provider = UserPreferences.currentProvider
        searchedProvider = provider
        return viewModelScope.launch {
            _state.value = State.Searching
            try {
                requireNotNull(provider) { "Choose a catalog before searching." }
                val results = withContext(Dispatchers.IO) {
                    ParentalControlUtils.filterItems(provider.search(submittedQuery))
                }
                _state.value = State.SuccessSearching(results, results.isNotEmpty())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e("SearchViewModel", "Search failed", e)
                _state.value = State.FailedSearching(e)
            }
        }.also { searchJob = it }
    }

    fun loadMore() {
        if (pageJob?.isActive == true) return
        val currentState = _state.value as? State.SuccessSearching ?: return
        if (!currentState.hasMore) return
        val provider = searchedProvider ?: return
        val submittedQuery = query
        val nextPage = page + 1
        pageJob = viewModelScope.launch {
            _state.value = State.SearchingMore
            try {
                val results = withContext(Dispatchers.IO) {
                    ParentalControlUtils.filterItems(provider.search(submittedQuery, nextPage))
                }
                val keys = currentState.results.map { it.searchIdentityKey() }.toHashSet()
                val unique = results.filter { keys.add(it.searchIdentityKey()) }
                page = nextPage
                _state.value = State.SuccessSearching(currentState.results + unique, results.isNotEmpty())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e("SearchViewModel", "More results failed", e)
                // Retain usable results when only a later page fails.
                _state.value = currentState.copy(hasMore = false)
            }
        }
    }

    fun searchGlobal(query: String, currentLanguage: String): Job {
        searchJob?.cancel()
        pageJob?.cancel()
        this.query = query.trim()
        val submittedQuery = this.query
        val targets = SearchCatalog.targets(UserPreferences.currentProvider, currentLanguage, Provider.providers.keys)
        return viewModelScope.launch {
            _state.value = State.GlobalSearching
            val results = targets.map { ProviderResult(it, ProviderResult.State.Loading) }.toMutableList()
            _state.value = State.SuccessGlobalSearching(results.toList())
            val mutex = Mutex()
            targets.forEachIndexed { index, provider ->
                launch {
                    val result = try {
                        val items = withContext(Dispatchers.IO) {
                            ParentalControlUtils.filterItems(provider.search(submittedQuery).onEach {
                                when (it) {
                                    is Movie -> it.providerName = provider.name
                                    is TvShow -> it.providerName = provider.name
                                }
                            })
                        }
                        ProviderResult(provider, ProviderResult.State.Success(items))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        ProviderResult(provider, ProviderResult.State.Error(e))
                    }
                    mutex.withLock {
                        results[index] = result
                        _state.value = State.SuccessGlobalSearching(results.sortedBy {
                            when (val state = it.state) {
                                is ProviderResult.State.Success -> if (state.results.isNotEmpty()) 0 else 2
                                is ProviderResult.State.Loading -> 1
                                is ProviderResult.State.Error -> 3
                            }
                        })
                    }
                }
            }
        }.also { searchJob = it }
    }

}

private fun AppAdapter.Item.searchIdentityKey(): String = when (this) {
    is Movie -> "movie:$id"
    is TvShow -> "tvshow:$id"
    else -> "${this::class.java.name}:${hashCode()}"
}
