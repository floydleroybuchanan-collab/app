package com.streamflixreborn.streamflix.activities.main

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.viewModels
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.flowWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.navOptions
import com.streamflixreborn.streamflix.BuildConfig
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.database.AppDatabase
import com.streamflixreborn.streamflix.databinding.ActivityMainTvBinding
import com.streamflixreborn.streamflix.fragments.player.PlayerTvFragment
import com.streamflixreborn.streamflix.charm.VodFocusCoordinator
import com.streamflixreborn.streamflix.ui.UpdateAppTvDialog
import com.streamflixreborn.streamflix.providers.IptvProvider
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.providers.Cine24hProvider
import com.streamflixreborn.streamflix.providers.FilmyOnlineCcProvider
import com.streamflixreborn.streamflix.providers.ZaluknijProvider
import com.streamflixreborn.streamflix.providers.GuardaSerieProvider
import com.streamflixreborn.streamflix.utils.AppLanguageManager
import com.streamflixreborn.streamflix.utils.ThemeManager
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.getCurrentFragment
import com.streamflixreborn.streamflix.providers.AnimeOnlineNinjaProvider
import kotlinx.coroutines.launch

class MainTvActivity : FragmentActivity() {

    private var _binding: ActivityMainTvBinding? = null
    private val binding get() = _binding!!

    private val viewModel by viewModels<MainViewModel>()

    private lateinit var updateAppDialog: UpdateAppTvDialog
    private var vodFocusCoordinator: VodFocusCoordinator? = null

    override fun attachBaseContext(newBase: android.content.Context) {
        super.attachBaseContext(AppLanguageManager.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Il setup delle preferenze è già avvenuto in StreamFlixApp
        setTheme(ThemeManager.tvThemeRes(UserPreferences.selectedTheme))
        
        super.onCreate(savedInstanceState)
        
        // Inizializza il provider con il context dell'attività per gestire eventuali bypass visibili
        AnimeOnlineNinjaProvider.init(this)
        Cine24hProvider.init(this)
        FilmyOnlineCcProvider.init(this)
        ZaluknijProvider.init(this)
        GuardaSerieProvider.init(this)

        _binding = ActivityMainTvBinding.inflate(layoutInflater)
        setContentView(binding.root)
        window.setBackgroundDrawableResource(R.color.charm_vod_canvas)
        applyThemeNavigationChrome()

        val navHostFragment = this.supportFragmentManager
            .findFragmentById(binding.vodGlassActionsFragment.id) as NavHostFragment
        val navController = navHostFragment.navController

        adjustLayoutDelta(null, null)

        if (BuildConfig.APP_LAYOUT == "mobile" || (BuildConfig.APP_LAYOUT != "tv" && !packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK))) {
            finish()
            startActivity(Intent(this, MainMobileActivity::class.java))
            return
        }

        if (savedInstanceState == null) {
            if (intent.getBooleanExtra("openVodSettings", false)) {
                navController.navigate(R.id.settings)
            } else {
                UserPreferences.currentProvider?.let { navController.navigate(R.id.home) }
            }
        }

        binding.vodGlassActions.onNavigate = { destination ->
            if (navController.currentDestination?.id != destination) {
                navController.navigate(destination, null, navOptions {
                    launchSingleTop = true
                    popUpTo(R.id.home) { inclusive = false }
                })
            }
        }
        vodFocusCoordinator = VodFocusCoordinator(binding, navHostFragment, navController).also { it.install() }
        updateNavigationVisibility()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            binding.vodGlassActionsFragment.isFocusedByDefault = true
        }

        navController.addOnDestinationChangedListener { _, destination, _ ->
            when (destination.id) {
                R.id.search, R.id.home, R.id.movies, R.id.tv_shows,
                R.id.favorites, R.id.genre_hub, R.id.platforms, R.id.settings -> {
                    binding.vodGlassActions.visibility = View.VISIBLE
                    updateNavigationVisibility()
                }
                else -> binding.vodGlassActions.visibility = View.GONE
            }
        }

        lifecycleScope.launch {
            viewModel.state.flowWithLifecycle(lifecycle, Lifecycle.State.STARTED).collect { state ->
                when (state) {
                    is MainViewModel.State.SuccessCheckingUpdate -> {
                        updateAppDialog = UpdateAppTvDialog(this@MainTvActivity, state.newReleases).also {
                            it.setOnUpdateClickListener { _ ->
                                if (!it.isLoading) viewModel.downloadUpdate(this@MainTvActivity, state.asset)
                            }
                            it.show()
                        }
                    }
                    MainViewModel.State.DownloadingUpdate -> if (::updateAppDialog.isInitialized) updateAppDialog.isLoading = true
                    is MainViewModel.State.SuccessDownloadingUpdate -> {
                        viewModel.installUpdate(this@MainTvActivity, state.apk)
                        if (::updateAppDialog.isInitialized) updateAppDialog.hide()
                    }
                    MainViewModel.State.InstallingUpdate -> if (::updateAppDialog.isInitialized) updateAppDialog.isLoading = true
                    is MainViewModel.State.FailedUpdate -> {
                        Toast.makeText(this@MainTvActivity, state.error.message ?: "Update failed", Toast.LENGTH_SHORT).show()
                    }
                    else -> {}
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when (navController.currentDestination?.id) {
                    R.id.home -> finishToMainDrawer()
                    R.id.settings, R.id.search, R.id.movies, R.id.tv_shows, R.id.favorites,
                    R.id.genre_hub, R.id.platforms -> {
                        // These are VOD top-level destinations. BACK exits to
                        // Charming MediaLab's main drawer, never the icon rail.
                        // Movie/episode/season/player details below continue to
                        // use navigateUp() and their saved content focus anchor.
                        finishToMainDrawer()
                    }
                    else -> {
                        val handled = (getCurrentFragment() as? PlayerTvFragment)?.onBackPressed() ?: false
                        if (!handled && !navController.navigateUp()) finishToMainDrawer()
                    }
                }
            }
        })
        if (savedInstanceState == null) binding.vodGlassActionsFragment.post { binding.vodGlassActionsFragment.requestFocus() }
    }

    /** A root VOD BACK returns to the host main navigation drawer, not the icon rail. */
    private fun finishToMainDrawer() {
        setResult(RESULT_OK, Intent().putExtra("openMainDrawer", true))
        finish()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (vodFocusCoordinator?.onKey(event) == true) return true
        return super.dispatchKeyEvent(event)
    }

    override fun onDestroy() {
        vodFocusCoordinator?.dispose()
        vodFocusCoordinator = null
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        viewModel.checkUpdate()
    }

    private fun applyThemeNavigationChrome() {
        val palette = ThemeManager.palette(UserPreferences.selectedTheme)
        window.statusBarColor = palette.systemBar
        window.navigationBarColor = palette.systemBar
        binding.vodGlassActions.setBackgroundColor(palette.tvNavBackground)
    }
    
    private fun updateNavigationVisibility() {
        val provider = UserPreferences.currentProvider
        binding.vodGlassActions.setAvailable(
            provider?.let { Provider.supportsMovies(it) } ?: true,
            provider?.let { Provider.supportsTvShows(it) } ?: true,
        )
    }

    fun adjustLayoutDelta(deltaX: Int?, deltaY: Int?) {
        val uDeltaX = deltaX ?: UserPreferences.paddingX
        val uDeltaY = deltaY ?: UserPreferences.paddingY
        binding.root.setPadding(uDeltaX, uDeltaY, uDeltaX, uDeltaY)
    }

    private fun navigateToProviderHome(navController: androidx.navigation.NavController) {
        if (!navController.popBackStack(R.id.home, false)) {
            navController.navigate(
                R.id.home,
                null,
                navOptions {
                    launchSingleTop = true
                    popUpTo(R.id.providers) {
                        inclusive = true
                    }
                }
            )
        }
    }
}
