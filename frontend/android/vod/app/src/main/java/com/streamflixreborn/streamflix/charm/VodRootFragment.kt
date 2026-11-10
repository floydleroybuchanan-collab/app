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
    private var rootStartedAt = 0L
    private var readyAttempts = 0
    private var rootReadyReported = false
    private var hostActive = false

    /** Expo Tabs retain the Fragment; only the currently focused tab may own readiness/focus. */
    fun setHostActive(active: Boolean) {
        val changed = hostActive != active
        hostActive = active
        // Disarm focus restoration BEFORE the player is popped on tab blur;
        // otherwise its destination callback can reclaim focus from Live TV.
        coordinator?.setHostActive(active)
        if (!active && changed && navigation?.currentDestination?.id == R.id.player) {
            // Expo Tabs can keep the VOD Fragment RESUMED while it is hidden.
            // Leave playback before another tab starts its Live/Guide decoder:
            // navigateUp destroys PlayerTvFragment's View and releases Media3
            // (and its nested Nova Dialog) while retaining the last browse page.
            runCatching {
                if (navigation?.navigateUp() == false) navigation?.navigate(R.id.home)
            }.onFailure { Log.e("CharmVodRoot", "Could not release hidden VOD playback", it) }
        }
        if (active && changed) {
            if (!rootReadyReported) {
                readyAttempts = 0
                notifyWhenDrawn()
            } else {
                _binding?.root?.post {
                    if (hostActive && _binding != null && !binding.root.hasFocus())
                        coordinator?.restoreFocusFromHost()
                }
            }
        }
    }
    private var readyCheckPosted = false
    private val readinessLayoutListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
        if (!rootReadyReported) notifyWhenDrawn()
    }

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
        // Host AppTheme supplies VOD attribute fallbacks for nested fragments.
        val themedContext = ContextThemeWrapper(
            inflater.context, ThemeManager.tvThemeRes(UserPreferences.selectedTheme)
        )
        val vodInflater = inflater.cloneInContext(themedContext)
        _binding = ActivityMainTvBinding.inflate(vodInflater, parent, false)
        return binding.root
    }

    override fun onViewCreated(view: View, saved: Bundle?) {
        super.onViewCreated(view, saved)
        // Readiness belongs to each VIEW, not the retained Fragment instance.
        rootReadyReported = false
        readyAttempts = 0
        requestedSection = arguments?.getString("startSection") ?: "home"
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
            it.setHostActive(hostActive)
        }

        controller.addOnDestinationChangedListener { _, destination, _ ->
            onImmersiveChanged?.invoke(destination.id == R.id.player)
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
        // Fabric can attach this nested Fragment before the route receives its
        // first measured viewport. A layout event, not a fixed timer, starts
        // the destination readiness deadline.
        b.root.addOnLayoutChangeListener(readinessLayoutListener)
        b.navMainFragment.addOnLayoutChangeListener(readinessLayoutListener)
        notifyWhenDrawn()
    }

    /**
     * NavHost existence is not proof of UI readiness. Require the actual
     * destination fragment to occupy the screen before reporting success.
     */
    private fun notifyWhenDrawn() {
        val b = _binding ?: return
        if (rootReadyReported || readyCheckPosted) return
        readyCheckPosted = true
        b.navMainFragment.post {
            readyCheckPosted = false
            if (!isAdded || _binding !== b || rootReadyReported) return@post
            if (!hostActive) return@post
            // An inactive Expo Tabs route can be attached with a 0x0 viewport.
            // That is a layout lifecycle state, not a failed provider/destination.
            // Wait for the real measured root before starting the readiness budget.
            if (b.root.width <= 0 || b.root.height <= 0 || !b.root.isShown) return@post

            val navHost = childFragmentManager.findFragmentById(b.navMainFragment.id) as? NavHostFragment
            val destination = navigation?.currentDestination?.id
            val content = navHost?.childFragmentManager?.primaryNavigationFragment?.view
            val homeInflated = destination != R.id.home ||
                content?.findViewById<View>(R.id.charming_vod_dashboard) != null
            if (b.navMainFragment.width > 0 && b.navMainFragment.height > 0 &&
                content != null && content.width > 0 && content.height > 0 && homeInflated) {
                rootReadyReported = true
                b.root.removeOnLayoutChangeListener(readinessLayoutListener)
                b.navMainFragment.removeOnLayoutChangeListener(readinessLayoutListener)
                if (!b.root.hasFocus()) b.vodGlassActions.focusLastAction()
                Log.i("CharmVodRoot", "VOD actual destination ready in ${SystemClock.elapsedRealtime() - rootStartedAt}ms")
                onRootReady?.invoke()
            } else if (++readyAttempts <= 45) {
                if (b.navMainFragment.width <= 0 || b.navMainFragment.height <= 0) {
                    // Request a genuine native layout pass, not just invalidation.
                    b.navMainFragment.requestLayout()
                    b.root.requestLayout()
                }
                b.navMainFragment.postDelayed({ notifyWhenDrawn() }, 100L)
            } else {
                val message = "VOD destination did not draw: destination=$destination, " +
                    "container=${b.navMainFragment.width}x${b.navMainFragment.height}, " +
                    "root=${b.root.width}x${b.root.height}"
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
        _binding?.let { b ->
            b.root.removeOnLayoutChangeListener(readinessLayoutListener)
            b.navMainFragment.removeOnLayoutChangeListener(readinessLayoutListener)
        }
        readyCheckPosted = false
        rootReadyReported = false
        readyAttempts = 0
        coordinator?.dispose()
        coordinator = null
        navigation = null
        onImmersiveChanged?.invoke(false)
        // The surface owner, not this View lifecycle, owns callback release.
        // A retained Fragment may recreate its View when returning from Player;
        // clearing callbacks here would permanently lose native-ready/error events.
        _binding = null
        super.onDestroyView()
    }
}