package com.streamflixreborn.streamflix.charm

import android.os.Bundle
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.OnBackPressedCallback
import androidx.constraintlayout.widget.ConstraintSet
import androidx.fragment.app.Fragment
import androidx.navigation.NavController
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.navOptions
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.databinding.ActivityMainTvBinding
import com.streamflixreborn.streamflix.fragments.player.PlayerTvFragment
import com.streamflixreborn.streamflix.providers.AnimeOnlineNinjaProvider
import com.streamflixreborn.streamflix.providers.Cine24hProvider
import com.streamflixreborn.streamflix.providers.FilmyOnlineCcProvider
import com.streamflixreborn.streamflix.providers.GuardaSerieProvider
import com.streamflixreborn.streamflix.providers.ZaluknijProvider
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.providers.Provider

/**
 * Native VOD belongs to the SAME Charming MediaLab MainActivity and process.
 * It is rendered as a child of the React Native /vod route, not launched as
 * a second Activity, app or independent launcher.
 *
 * Child NavHostFragment retains all existing VOD detail/episode/player logic.
 * The app-level PurpleTvShell owns the sole visible icon rail and main drawer.
 */
class VodRootFragment : Fragment() {
    var onHostBack: (() -> Unit)? = null
    var onHostIconRail: (() -> Boolean)? = null
    var onImmersiveChanged: ((Boolean) -> Unit)? = null

    private var _binding: ActivityMainTvBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var coordinator: VodFocusCoordinator? = null
    private var navigation: NavController? = null
    private var requestedSection = "home"

    companion object {
        fun create(section: String = "home") = VodRootFragment().apply {
            arguments = Bundle().apply { putString("startSection", section) }
        }
    }

    override fun onCreateView(inflater: LayoutInflater, parent: ViewGroup?, saved: Bundle?): View {
        _binding = ActivityMainTvBinding.inflate(inflater, parent, false)
        return binding.root
    }

    override fun onViewCreated(view: View, saved: Bundle?) {
        super.onViewCreated(view, saved)
        requestedSection = arguments?.getString("startSection") ?: "home"
        val b = binding
        b.ivSplashOverlay.dismiss()
        b.ivSplashOverlay.visibility = View.GONE
        b.navMain.visibility = View.GONE

        // No second icon rail: give VOD all the space beneath the existing
        // Charming MediaLab host rail; recalculation is a single ConstraintSet.
        ConstraintSet().apply {
            clone(b.root)
            connect(b.vodGlassActions.id, ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START)
            connect(b.navMainFragment.id, ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START)
            applyTo(b.root)
        }
        b.root.setPadding(UserPreferences.paddingX, UserPreferences.paddingY,
            UserPreferences.paddingX, UserPreferences.paddingY)

        // Providers use this activity context, but never spawn another player
        // process or another React runtime.
        AnimeOnlineNinjaProvider.init(requireContext())
        Cine24hProvider.init(requireContext())
        FilmyOnlineCcProvider.init(requireContext())
        ZaluknijProvider.init(requireContext())
        GuardaSerieProvider.init(requireContext())
        CharmVodDefaults.apply()

        val navHost = childFragmentManager.findFragmentById(b.navMainFragment.id) as? NavHostFragment
            ?: NavHostFragment.create(R.navigation.nav_main_graph_tv).also {
                childFragmentManager.beginTransaction().replace(b.navMainFragment.id, it).commitNow()
            }
        val controller = navHost.navController
        navigation = controller

        coordinator = VodFocusCoordinator(b, navHost, controller).also {
            it.onHostRailFocus = { onHostIconRail?.invoke() == true }
            it.install()
        }

        controller.addOnDestinationChangedListener { _, destination, _ ->
            onImmersiveChanged?.invoke(destination.id == R.id.player)
        }
        if (saved == null) {
            when {
                requestedSection == "settings" -> controller.navigate(R.id.settings)
                UserPreferences.currentProvider != null -> controller.navigate(R.id.home)
            }
        }
        requireActivity().onBackPressedDispatcher.addCallback(viewLifecycleOwner,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (isVisible && _binding?.root?.hasFocus() == true) {
                        navigateBack()
                    } else {
                        isEnabled = false
                        requireActivity().onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        )
        b.navMainFragment.post { b.navMainFragment.requestFocus() }
    }

    fun onRemoteKey(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 &&
            event.keyCode == KeyEvent.KEYCODE_BACK) return navigateBack()
        return coordinator?.onKey(event) == true
    }

    fun navigateTo(section: String) {
        requestedSection = section
        val controller = navigation ?: return
        val destination = when (section) {
            "settings" -> R.id.settings
            "search" -> R.id.search
            "movies" -> R.id.movies
            "shows" -> R.id.tv_shows
            "favorites" -> R.id.favorites
            "genres" -> R.id.genre_hub
            "platforms" -> R.id.platforms
            else -> R.id.home
        }
        if (controller.currentDestination?.id != destination) {
            controller.navigate(destination, null, navOptions {
                launchSingleTop = true
                popUpTo(R.id.home) { inclusive = false }
            })
        }
    }

    fun navigateBack(): Boolean {
        val controller = navigation ?: return false
        when (controller.currentDestination?.id) {
            R.id.home, R.id.settings, R.id.search, R.id.movies, R.id.tv_shows,
            R.id.favorites, R.id.genre_hub, R.id.platforms -> {
                onHostBack?.invoke()
                return true
            }
            else -> {
                val player = (childFragmentManager.findFragmentById(binding.navMainFragment.id)
                    as? NavHostFragment)?.childFragmentManager?.primaryNavigationFragment as? PlayerTvFragment
                if (player?.onBackPressed() == true) return true
                if (controller.navigateUp()) return true
                onHostBack?.invoke()
                return true
            }
        }
    }

    fun adjustLayoutDelta(x: Int?, y: Int?) {
        val b = _binding ?: return
        val nx = x ?: UserPreferences.paddingX
        val ny = y ?: UserPreferences.paddingY
        b.root.setPadding(nx, ny, nx, ny)
    }

    override fun onDestroyView() {
        coordinator?.dispose()
        coordinator = null
        navigation = null
        onImmersiveChanged?.invoke(false)
        _binding = null
        super.onDestroyView()
    }
}