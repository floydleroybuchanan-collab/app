package com.streamflixreborn.streamflix.charm

import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.ContextThemeWrapper
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
import com.streamflixreborn.streamflix.utils.ThemeManager
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.models.Video

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
    var onRootReady: (() -> Unit)? = null
    var onRootError: ((String) -> Unit)? = null
    var onNeedsLayout: (() -> Unit)? = null
    var onHostGuide: (() -> Unit)? = null
    private var rootStartedAt = 0L
    private var readyAttempts = 0
    private var sizeAttempts = 0
    private var rootReadyReported = false

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
        rootStartedAt = SystemClock.elapsedRealtime()
        Log.i("CharmVodRoot", "Inflating embedded VOD root")
        // The original TV layout was built for Theme.Leanback. Keep that theme
        // scoped to VOD views; never change the shared React Native Activity.
        // Nested fragments inflate from the host Activity theme, so add the VOD
        // attributes it lacks. force=false never changes a value React relies on.
        requireActivity().theme.applyStyle(ThemeManager.tvThemeRes(UserPreferences.selectedTheme), false)
        val themedContext = ContextThemeWrapper(
            inflater.context, ThemeManager.tvThemeRes(UserPreferences.selectedTheme)
        )
        val vodInflater = inflater.cloneInContext(themedContext)
        _binding = ActivityMainTvBinding.inflate(vodInflater, parent, false)
        return binding.root
    }

    override fun onViewCreated(view: View, saved: Bundle?) {
        super.onViewCreated(view, saved)
        requestedSection = arguments?.getString("startSection") ?: "home"
        VodHostActions.openGuide = { onHostGuide?.invoke() }
        val b = binding
        // The embedded layout contains no rail or splash overlay. Charming MediaLab's
        // React shell is the sole owner of app navigation and rail focus.
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

        controller.addOnDestinationChangedListener { _, destination, args ->
            onImmersiveChanged?.invoke(destination.id == R.id.player)
            if (destination.id == R.id.player) {
                @Suppress("DEPRECATION")
                VodPlayerSimilar.attach(viewLifecycleOwner, b.root, args?.get("videoType") as? Video.Type, controller)
            }
        }
        // The graph starts at Home. Do not navigate there again: this used to
        // recreate the first destination and delay/blank the embedded dashboard.
        if (saved == null && requestedSection == "settings") {
            controller.navigate(R.id.settings)
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
        notifyWhenDrawn()
    }

    /**
     * NavHost existence is not proof of UI readiness. Require the actual
     * destination fragment to occupy the screen before reporting success.
     */
    private fun notifyWhenDrawn() {
        val b = _binding ?: return
        b.navMainFragment.post {
            if (!isAdded || _binding == null || rootReadyReported) return@post
            val navHost = childFragmentManager.findFragmentById(b.navMainFragment.id) as? NavHostFragment
            val destination = navigation?.currentDestination?.id
            val content = navHost?.childFragmentManager?.primaryNavigationFragment?.view
            val homeInflated = destination != R.id.home ||
                content?.findViewById<View>(R.id.charming_vod_dashboard) != null
            if (b.navMainFragment.width > 0 && b.navMainFragment.height > 0 &&
                content != null && content.width > 0 && content.height > 0 && homeInflated) {
                rootReadyReported = true
                if (!b.root.hasFocus()) b.vodGlassActions.focusLastAction()
                Log.i("CharmVodRoot", "VOD actual destination ready in ${SystemClock.elapsedRealtime() - rootStartedAt}ms")
                onRootReady?.invoke()
            } else if (((b.navMainFragment.width <= 0 || b.navMainFragment.height <= 0) && ++sizeAttempts <= 150) || ++readyAttempts <= 45) {
                // A view that has no size yet is still being laid out, not a failure.
                onNeedsLayout?.invoke()
                b.navMainFragment.postDelayed({ notifyWhenDrawn() }, 100L)
            } else {
                val message = "VOD destination did not draw: destination=$destination, " +
                    "container=${b.navMainFragment.width}x${b.navMainFragment.height}"
                Log.e("CharmVodRoot", message)
                onRootError?.invoke(message)
            }
        }
    }

    /** Native RIGHT from the unified app rail restores focus inside VOD. */
    fun restoreFocusFromRail(): Boolean = coordinator?.restoreFocusFromHost() == true

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
        onRootReady = null
        onRootError = null
        onNeedsLayout = null
        VodHostActions.openGuide = null
        _binding = null
        super.onDestroyView()
    }
}