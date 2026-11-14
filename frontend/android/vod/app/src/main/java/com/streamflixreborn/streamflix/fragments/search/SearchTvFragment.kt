package com.streamflixreborn.streamflix.fragments.search

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.KeyEvent
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.flowWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.leanback.widget.OnChildViewHolderSelectedListener
import androidx.recyclerview.widget.RecyclerView
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.database.AppDatabase
import com.streamflixreborn.streamflix.databinding.FragmentSearchTvBinding
import com.streamflixreborn.streamflix.models.Category
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.utils.CacheUtils
import com.streamflixreborn.streamflix.utils.LoggingUtils
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.VoiceRecognitionHelper
import com.streamflixreborn.streamflix.utils.hideKeyboard
import com.streamflixreborn.streamflix.utils.viewModelsFactory
import kotlinx.coroutines.launch
import androidx.navigation.fragment.findNavController
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.providers.IptvProvider

class SearchTvFragment : Fragment() {

    private companion object {
        const val LIVE_PAUSE_MS = 380L
        const val LIVE_MIN_LETTERS = 2
    }

    private var hasAutoCleared409: Boolean = false
    private var _binding: FragmentSearchTvBinding? = null
    private val binding get() = _binding!!

    private val database by lazy { AppDatabase.getInstance(requireContext()) }
    private val viewModel by viewModelsFactory { SearchViewModel(database, browseWhenEmpty = false) }
    private var isGlobalSearchChecked: Boolean = false
    private var currentGridColumns: Int = 1
    /** 0 = everything, 1 = movies only, 2 = series only. */
    private var resultFilter: Int = 0
    private var lastResults: List<AppAdapter.Item> = emptyList()
    private var lastHasMore: Boolean = false

    private val appAdapter by lazy {
        AppAdapter().apply {
            onMovieClickListener = { movie ->
                com.streamflixreborn.streamflix.charm.VodSearchRecents.add(requireContext(), viewModel.query)
                switchProviderIfNeeded(movie.providerName)
                findNavController().navigate(
                    SearchTvFragmentDirections.actionSearchToMovie(id = movie.id)
                )
            }
            onTvShowClickListener = { tvShow ->
                com.streamflixreborn.streamflix.charm.VodSearchRecents.add(requireContext(), viewModel.query)
                switchProviderIfNeeded(tvShow.providerName)
                findNavController().navigate(
                    SearchTvFragmentDirections.actionSearchToTvShow(
                        id = tvShow.id,
                        poster = tvShow.poster,
                        banner = tvShow.banner,
                    )
                )
            }
        }
    }

    private lateinit var voiceHelper: VoiceRecognitionHelper

    private fun switchProviderIfNeeded(providerName: String?) {
        val targetName = providerName?.takeIf { it.isNotBlank() } ?: return
        if (targetName == UserPreferences.currentProvider?.name) return

        val targetProvider = Provider.providers.keys.find { it.name == targetName } ?: return
        UserPreferences.currentProvider = targetProvider
        Toast.makeText(
            requireContext(),
            getString(R.string.switching_to_provider, targetName),
            Toast.LENGTH_SHORT,
        ).show()
    }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSearchTvBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        initializeSearch()

        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.state.flowWithLifecycle(lifecycle, Lifecycle.State.STARTED).collect { state ->

                when (state) {
                    is State.Searching, is State.GlobalSearching -> {
                        binding.isLoading.apply {
                            root.visibility = View.VISIBLE
                            pbIsLoading.visibility = View.VISIBLE
                            gIsLoadingRetry.visibility = View.GONE
                        }
                        appAdapter.isLoading = false
                        appAdapter.setOnLoadMoreListener(null)
                    }
                    is State.SearchingMore -> appAdapter.isLoading = true
                    is State.SuccessSearching -> {
                        displaySearch(state.results, state.hasMore)
                        appAdapter.isLoading = false
                        binding.vgvSearch.visibility = View.VISIBLE
                        binding.isLoading.root.visibility = View.GONE
                    }
                    is State.SuccessGlobalSearching -> {
                        displayGlobalSearch(state.providerResults)
                        appAdapter.isLoading = false
                        binding.vgvSearch.visibility = View.VISIBLE
                        binding.isLoading.root.visibility = View.GONE
                    }
                    is State.FailedSearching -> {
                        val code = (state.error as? retrofit2.HttpException)?.code()
                        if (code == 409 && !hasAutoCleared409) {
                            hasAutoCleared409 = true
                            CacheUtils.clearAppCache(requireContext())
                            Toast.makeText(requireContext(), getString(R.string.clear_cache_done_409), Toast.LENGTH_SHORT).show()
                            if (appAdapter.isLoading) appAdapter.isLoading = false
                            viewModel.search(viewModel.query)
                            return@collect
                        }
                        Toast.makeText(requireContext(), state.error.message ?: "", Toast.LENGTH_SHORT).show()
                        if (appAdapter.isLoading) {
                            appAdapter.isLoading = false
                        } else {
                            binding.isLoading.apply {
                                pbIsLoading.visibility = View.GONE
                                gIsLoadingRetry.visibility = View.VISIBLE
                                btnIsLoadingRetry.setOnClickListener { viewModel.search(viewModel.query) }
                                btnIsLoadingClearCache.setOnClickListener {
                                    CacheUtils.clearAppCache(requireContext())
                                    Toast.makeText(requireContext(), getString(R.string.clear_cache_done), Toast.LENGTH_SHORT).show()
                                    viewModel.search(viewModel.query)
                                }
                                btnIsLoadingErrorDetails.setOnClickListener {
                                    LoggingUtils.showErrorDialog(requireContext(), state.error)
                                }
                                binding.vgvSearch.visibility = View.INVISIBLE
                                binding.etSearch.nextFocusDownId = binding.isLoading.btnIsLoadingRetry.id
                                binding.isLoading.btnIsLoadingRetry.nextFocusUpId = binding.etSearch.id
                            }
                        }
                    }
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        binding.etSearch.removeCallbacks(liveSearch)
        voiceHelper.stopRecognition()
        _binding = null
    }

    /** Results appear while typing: a short pause after two letters searches. */
    private val liveSearch = Runnable {
        val current = _binding ?: return@Runnable
        if (isGlobalSearchChecked) return@Runnable
        val typed = current.etSearch.text?.toString().orEmpty().trim()
        if (typed == viewModel.query.trim()) return@Runnable
        if (typed.isEmpty() || typed.length >= LIVE_MIN_LETTERS) viewModel.search(typed)
    }

    private fun showRecents() {
        val current = _binding ?: return
        val empty = current.etSearch.text.isNullOrBlank()
        com.streamflixreborn.streamflix.charm.VodSearchRecents.show(current.llSearchRecents, empty) { query ->
            current.etSearch.setText(query)
            current.etSearch.setSelection(query.length)
            current.etSearch.removeCallbacks(liveSearch)
            viewModel.search(query)
        }
        val recents = current.llSearchRecents.visibility == View.VISIBLE
        current.tvSearchHint.visibility = if (empty) View.VISIBLE else View.GONE
        current.tvSearchHint.text = if (recents) "Recent searches" else "Type two letters or more. Movies and series show up as you type."
        val filters = current.llSearchFilter.visibility == View.VISIBLE
        current.llGlobalSearch.nextFocusDownId = when {
            recents -> current.llSearchRecents.id
            filters -> current.llSearchFilter.id
            else -> current.vgvSearch.id
        }
    }

    /** The row a result in the top line goes Up to. */
    private fun aboveResultsId(): Int {
        val current = _binding ?: return View.NO_ID
        return if (current.llSearchFilter.visibility == View.VISIBLE) current.llSearchFilter.id else current.llGlobalSearch.id
    }

    private fun submitSearch(): Boolean {
        val query = binding.etSearch.text?.toString().orEmpty()
        binding.etSearch.removeCallbacks(liveSearch)
        com.streamflixreborn.streamflix.charm.VodSearchRecents.add(requireContext(), query)
        hideKeyboard()

        if (isGlobalSearchChecked) {
            if (query.isBlank()) {
                Toast.makeText(requireContext(), getString(R.string.search_empty_query), Toast.LENGTH_SHORT).show()
                return true
            }
            val currentLanguage = UserPreferences.currentProvider?.language ?: "es"
            viewModel.searchGlobal(query, currentLanguage)
        } else {
            viewModel.search(query)
        }
        return true
    }

    private fun initializeSearch() {
        val isIptv = UserPreferences.currentProvider is IptvProvider
        val hintStringRes = if (isIptv) R.string.search_input_hint_iptv else R.string.search_input_hint
        binding.etSearch.hint = getString(hintStringRes)

        binding.llGlobalSearch.nextFocusUpId = binding.etSearch.id
        binding.vgvSearch.nextFocusUpId = binding.llGlobalSearch.id

        binding.llGlobalSearch.setOnClickListener {
            isGlobalSearchChecked = !isGlobalSearchChecked
            binding.ivGlobalSearchSwitch.setImageResource(
                if (isGlobalSearchChecked) R.drawable.ic_switch_on else R.drawable.ic_switch_off
            )
        }

        binding.etSearch.apply {
            setOnEditorActionListener { _, actionId, event ->
                val isSubmitAction =
                    actionId == EditorInfo.IME_ACTION_SEARCH ||
                        actionId == EditorInfo.IME_ACTION_DONE ||
                        actionId == EditorInfo.IME_NULL
                val isSubmitKey =
                    event?.action == KeyEvent.ACTION_DOWN &&
                        (event.keyCode == KeyEvent.KEYCODE_ENTER ||
                            event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER)

                if (isSubmitAction || isSubmitKey) {
                    return@setOnEditorActionListener submitSearch()
                }
                return@setOnEditorActionListener false
            }

            setOnKeyListener { _, keyCode, event ->
                if (event.action != KeyEvent.ACTION_DOWN) {
                    return@setOnKeyListener false
                }

                if (keyCode == KeyEvent.KEYCODE_BACK) {
                    return@setOnKeyListener focusSearchContent()
                }

                if (
                    keyCode == KeyEvent.KEYCODE_ENTER ||
                    keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER ||
                    keyCode == KeyEvent.KEYCODE_SEARCH
                ) {
                    return@setOnKeyListener submitSearch()
                }

                false
            }

            addTextChangedListener(object : TextWatcher {
                override fun afterTextChanged(s: Editable?) {
                    binding.etSearch.removeCallbacks(liveSearch)
                    binding.etSearch.postDelayed(liveSearch, if (s.isNullOrBlank()) 0L else LIVE_PAUSE_MS)
                    showRecents()
                    if (s.isNullOrBlank()) {
                                val isIptv = UserPreferences.currentProvider is IptvProvider
        val hintStringRes = if (isIptv) R.string.search_input_hint_iptv else R.string.search_input_hint
        binding.etSearch.hint = getString(hintStringRes)
                    }
                }
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            })
        }

        val blink = AlphaAnimation(1f, 0.3f).apply {
            duration = 500
            repeatCount = Animation.INFINITE
            repeatMode = Animation.REVERSE
        }

        voiceHelper = VoiceRecognitionHelper(
            fragment = this,
            onResult = { query ->
                binding.btnSearchVoice.clearAnimation()
                binding.etSearch.setText(query)
                viewModel.search(query)
            },
            onError = { msg ->
                Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show()
                binding.btnSearchVoice.clearAnimation()
                        val isIptv = UserPreferences.currentProvider is IptvProvider
        val hintStringRes = if (isIptv) R.string.search_input_hint_iptv else R.string.search_input_hint
        binding.etSearch.hint = getString(hintStringRes)
            },
            onListeningStateChanged = { isListening ->
                binding.btnSearchVoice.startAnimation(blink)
                binding.etSearch.hint = getString(R.string.voice_prompt)
            }
        )

        binding.btnSearchVoice.apply {
            requestFocus()
            visibility = if (voiceHelper.isAvailable()) View.VISIBLE else View.GONE
            setOnClickListener { if (!voiceHelper.isListening) voiceHelper.startWithPermissionCheck() }
        }

        listOf(binding.btnSearchClear, binding.btnSearchVoice, binding.llGlobalSearch).forEach { view ->
            view.setOnKeyListener { _, keyCode, event ->
                if (event.action == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_BACK) {
                    focusSearchContent()
                } else {
                    false
                }
            }
        }

        binding.btnSearchClear.setOnClickListener {
            binding.etSearch.setText("")
                    val isIptv = UserPreferences.currentProvider is IptvProvider
        val hintStringRes = if (isIptv) R.string.search_input_hint_iptv else R.string.search_input_hint
        binding.etSearch.hint = getString(hintStringRes)
            viewModel.search("")
        }

        binding.vgvSearch.apply {
            adapter = appAdapter.apply {
                stateRestorationPolicy = RecyclerView.Adapter.StateRestorationPolicy.PREVENT_WHEN_EMPTY
            }
            setItemSpacing(resources.getDimension(R.dimen.search_spacing).toInt())
            addOnChildViewHolderSelectedListener(object : OnChildViewHolderSelectedListener() {
                override fun onChildViewHolderSelected(
                    parent: RecyclerView,
                    child: RecyclerView.ViewHolder?,
                    position: Int,
                    subposition: Int,
                ) {
                    child?.itemView?.nextFocusUpId =
                        if (position in 0 until currentGridColumns) aboveResultsId()
                        else View.NO_ID
                }
            })
        }

        com.streamflixreborn.streamflix.charm.VodSearchRecents.glass(binding.clSearch, binding.etSearch)
        com.streamflixreborn.streamflix.charm.VodSearchRecents.glass(binding.llGlobalSearch, binding.llGlobalSearch)
        showRecents()

        binding.root.requestFocus()
    }

    private fun focusSearchContent(): Boolean {
        val hasResults = appAdapter.itemCount > 0 && binding.vgvSearch.visibility == View.VISIBLE
        return when {
            hasResults -> {
                binding.vgvSearch.requestFocus()
            }
            binding.llGlobalSearch.visibility == View.VISIBLE -> {
                binding.llGlobalSearch.requestFocus()
            }
            else -> false
        }
    }

    private fun displaySearch(list: List<AppAdapter.Item>, hasMore: Boolean) {
        lastResults = list
        lastHasMore = hasMore
        currentGridColumns = 6
        binding.vgvSearch.setNumColumns(currentGridColumns)

        // Posters only: movies and series. The grid wraps to a new line every six
        // posters and scrolls inside its own area, however many results there are.
        val movies = list.count { it is Movie }
        val series = list.count { it is TvShow }
        // The choice is offered only when both kinds were found.
        if (movies == 0 || series == 0) resultFilter = 0
        com.streamflixreborn.streamflix.charm.VodSearchRecents.filters(
            binding.llSearchFilter,
            if (movies > 0 && series > 0) listOf("All (${movies + series})", "Movies ($movies)", "Series ($series)") else emptyList(),
            resultFilter,
        ) { choice ->
            if (choice != resultFilter) {
                resultFilter = choice
                displaySearch(lastResults, lastHasMore)
            }
        }
        binding.vgvSearch.nextFocusUpId = aboveResultsId()
        showRecents()

        appAdapter.submitList(list.filter {
            when (resultFilter) {
                1 -> it is Movie
                2 -> it is TvShow
                else -> it is Movie || it is TvShow
            }
        }.onEach {
            when (it) {
                is Movie -> it.itemType = AppAdapter.Type.MOVIE_GRID_TV_ITEM
                is TvShow -> it.itemType = AppAdapter.Type.TV_SHOW_GRID_TV_ITEM
            }
        })

        if (hasMore && viewModel.query != "") {
            appAdapter.setOnLoadMoreListener { viewModel.loadMore() }
        } else {
            appAdapter.setOnLoadMoreListener(null)
        }
    }

    private fun displayGlobalSearch(providerResults: List<ProviderResult>) {
        val categories = providerResults.map { providerResult ->
            val headerTitle = when (val state = providerResult.state) {
                is ProviderResult.State.Loading -> "${providerResult.provider.name} - ${getString(R.string.searching)}"
                is ProviderResult.State.Error -> "${providerResult.provider.name} - ${getString(R.string.search_error)}"
                is ProviderResult.State.Success -> {
                    val count = state.results.size
                    val resultText = if (count == 1) getString(R.string.result) else getString(R.string.results)
                    "${providerResult.provider.name} - $count $resultText"
                }
            }

            val items = (providerResult.state as? ProviderResult.State.Success)?.results?.onEach {
                when (it) {
                    is Movie -> it.itemType = AppAdapter.Type.MOVIE_TV_ITEM
                    is TvShow -> it.itemType = AppAdapter.Type.TV_SHOW_TV_ITEM
                }
            } ?: emptyList()

            Category(name = headerTitle, list = items).apply {
                itemType = AppAdapter.Type.CATEGORY_TV_ITEM
            }
        }

        com.streamflixreborn.streamflix.charm.VodSearchRecents.filters(binding.llSearchFilter, emptyList(), 0) {}
        binding.vgvSearch.nextFocusUpId = aboveResultsId()
        currentGridColumns = 1
        binding.vgvSearch.setNumColumns(currentGridColumns) // La lista de categorías es una sola columna vertical
        appAdapter.submitList(categories)
        appAdapter.setOnLoadMoreListener(null)
    }
}
