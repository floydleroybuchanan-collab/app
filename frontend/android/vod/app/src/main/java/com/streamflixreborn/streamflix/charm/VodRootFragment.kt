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
        if (saved == null && requestedSection.startsWith("settings")) {
            controller.navigate(R.id.settings, settingsArgs(requestedSection))
        }
        // "movie:<id>" / "tv_show:<id>" opens that title's page over Home
        // (Live TV's "Recently Watched On Demand" row). Back returns to Home.
        if (saved == null) titleDestination(requestedSection)?.let { (destination, id) ->
            runCatching {
                controller.navigate(destination, Bundle().apply { putString("id", id) })
                coordinator?.focusIncomingPage()
            }.onFailure { Log.e("CharmVodRoot", "Cannot open requested title", it) }
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
            } else if (((b.navMainFragment.width <= 0 || b.navMainFragment.height <= 0) && ++sizeAttempts <= 25) || ++readyAttempts <= 45) {
                // 2.5s at 0x0 is a stuck host layout, not a slow one; the React side
                // remounts the surface once on the error below (what Retry did by hand).
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

    /** The VOD player page is on screen (the host must send every key here). */
    fun isPlayerShown(): Boolean = isVisible && coordinator?.isPlayerShown() == true

    fun onRemoteKey(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 &&
            event.keyCode == KeyEvent.KEYCODE_BACK) return navigateBack()
        return coordinator?.onKey(event) == true
    }


    /** "movie:<id>" or "tv_show:<id>" → the title page to open, else null. */
    private fun titleDestination(section: String): Pair<Int, String>? {
        val kind = section.substringBefore(':', "")
        val id = section.substringAfter(':', "").trim()
        if (id.isEmpty() || id.length > 300) return null
        return when (kind) {
            "movie" -> R.id.movie to id
            "tv_show" -> R.id.tv_show to id
            else -> null
        }
    }

    /** "settings:screen_x" opens VOD Settings directly on that section. */
    private fun settingsArgs(section: String): Bundle? =
        section.substringAfter("settings:", "").takeIf { Regex("^screen_[a-z_]+$").matches(it) }?.let {
            Bundle().apply { putString(androidx.preference.PreferenceFragmentCompat.ARG_PREFERENCE_ROOT, it) }
        }

    fun navigateTo(section: String) {
        val previous = requestedSection
        requestedSection = section
        val controller = navigation ?: return
        // A title link from Live TV ("movie:<id>") arrives here when the VOD
        // view is already alive. Open that title over Home (Back returns Home).
        titleDestination(section)?.let { (destination, id) ->
            runCatching {
                controller.navigate(destination, Bundle().apply { putString("id", id) }, navOptions {
                    popUpTo(R.id.home) { inclusive = false }
                })
                coordinator?.focusIncomingPage()
            }.onFailure { Log.e("CharmVodRoot", "Cannot open requested title", it) }
            return
        }
        // React clears the one-shot title link afterwards ("home"); that must
        // not pull the user off the title page they just opened.
        if (section == "home" && titleDestination(previous) != null) return
        val destination = when (section) {
            "settings" -> R.id.settings
            "search" -> R.id.search
            "movies" -> R.id.movies
            "shows" -> R.id.tv_shows
            "favorites" -> R.id.favorites
            "genres" -> R.id.genre_hub
            "platforms" -> R.id.platforms
            else -> if (section.startsWith("settings:")) R.id.settings else R.id.home
        }
        val args = if (destination == R.id.settings) settingsArgs(section) else null
        if (controller.currentDestination?.id != destination || args != null) {
            controller.navigate(destination, args, navOptions {
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