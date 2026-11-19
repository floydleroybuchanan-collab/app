package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.constraintlayout.widget.ConstraintSet
import androidx.fragment.app.Fragment
import androidx.navigation.NavController
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.navOptions
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.databinding.ActivityMainMobileBinding
import com.streamflixreborn.streamflix.fragments.player.PlayerMobileFragment
import com.streamflixreborn.streamflix.providers.AnimeOnlineNinjaProvider
import com.streamflixreborn.streamflix.providers.Cine24hProvider
import com.streamflixreborn.streamflix.providers.FilmyOnlineCcProvider
import com.streamflixreborn.streamflix.providers.GuardaSerieProvider
import com.streamflixreborn.streamflix.providers.ZaluknijProvider
import com.streamflixreborn.streamflix.utils.ThemeManager
import com.streamflixreborn.streamflix.utils.UserPreferences

/**
 * Touch-phone Video OnDemand. The TV host ([VodRootFragment]) is left exactly as it is;
 * phones get the app's real mobile screens (touch lists, pull-down pages, sheets) inside the
 * same embedded surface, under the crown background, with a row of glass pills on top.
 *
 * It exposes the same members the surface manager already wires, so the host code is shared.
 */
class VodRootMobileFragment : Fragment() {
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
    private var _binding: ActivityMainMobileBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var navigation: NavController? = null
    private var requestedSection = "home"
    private var pills: HorizontalScrollView? = null
    private var topBar: View? = null
    private var backPill: TextView? = null
    private val pillViews = LinkedHashMap<Int, TextView>()

    companion object {
        fun create(section: String = "home") = VodRootMobileFragment().apply {
            arguments = Bundle().apply { putString("startSection", section) }
        }

        private val TOP_LEVEL = setOf(
            R.id.home, R.id.movies, R.id.tv_shows, R.id.favorites, R.id.genre_hub, R.id.platforms,
            R.id.search, R.id.settings,
        )
    }

    override fun onCreateView(inflater: LayoutInflater, parent: ViewGroup?, saved: Bundle?): View {
        rootStartedAt = SystemClock.elapsedRealtime()
        Log.i("CharmVodRoot", "Inflating embedded phone VOD root")
        requireActivity().theme.applyStyle(ThemeManager.mobileThemeRes(UserPreferences.selectedTheme), false)
        // VOD Settings is the shared embedded settings screen, which also reads the TV theme's attributes.
        requireActivity().theme.applyStyle(ThemeManager.tvThemeRes(UserPreferences.selectedTheme), false)
        val themed = ContextThemeWrapper(inflater.context, ThemeManager.mobileThemeRes(UserPreferences.selectedTheme))
        _binding = ActivityMainMobileBinding.inflate(inflater.cloneInContext(themed), parent, false)
        return binding.root
    }

    override fun onViewCreated(view: View, saved: Bundle?) {
        super.onViewCreated(view, saved)
        requestedSection = arguments?.getString("startSection") ?: "home"
        VodHostActions.openGuide = { onHostGuide?.invoke() }
        val b = binding
        b.root.background = CrownBackdrop(requireContext())
        // The shell already owns the app bar; VOD gets its own glass pills instead of the old bottom bar.
        b.bnvMain.visibility = View.GONE
        b.btnMainSearch.visibility = View.GONE
        buildPills(b)

        AnimeOnlineNinjaProvider.init(requireContext())
        Cine24hProvider.init(requireContext())
        FilmyOnlineCcProvider.init(requireContext())
        ZaluknijProvider.init(requireContext())
        GuardaSerieProvider.init(requireContext())
        CharmVodDefaults.apply()

        val navHost = childFragmentManager.findFragmentById(b.navMainFragment.id) as? NavHostFragment
            ?: NavHostFragment.create(R.navigation.nav_main_graph_phone).also {
                childFragmentManager.beginTransaction().replace(b.navMainFragment.id, it).commitNowAllowingStateLoss()
            }
        val controller = navHost.navController
        // activity_main_mobile.xml's own <fragment> tag hardcodes app:navGraph="@navigation/nav_main_graph_mobile"
        // (the standalone app's own graph, which has no genre_hub/platforms/platform_titles). That layout's
        // inflation above already attaches a NavHostFragment with THAT graph before this code runs, so
        // findFragmentById finds it and the "create with nav_main_graph_phone" fallback never actually
        // fires - every Genres/Platforms tap crashed with "destination cannot be found" as a result.
        if (controller.graph.id != R.id.nav_main_graph_phone) controller.setGraph(R.navigation.nav_main_graph_phone)
        navigation = controller
        // The phone graph starts at Home (VOD always has its provider), so there is nothing to navigate away from.
        controller.addOnDestinationChangedListener { _, destination, _ ->
            onImmersiveChanged?.invoke(destination.id == R.id.player)
            // Pills on the main pages, a Back button on a title/genre/platform page, nothing over the player.
            val top = destination.id in TOP_LEVEL
            topBar?.visibility = if (destination.id == R.id.player) View.GONE else View.VISIBLE
            pills?.visibility = if (top) View.VISIBLE else View.GONE
            backPill?.visibility = if (top) View.GONE else View.VISIBLE
            pillViews.forEach { (id, v) -> styleSelected(v, id == destination.id) }
        }
        if (saved == null) openSection(requestedSection)

        requireActivity().onBackPressedDispatcher.addCallback(viewLifecycleOwner,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (isVisible) navigateBack() else {
                        isEnabled = false
                        requireActivity().onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            })
        notifyWhenDrawn()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun buildPills(b: ActivityMainMobileBinding) {
        val row = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(8), dp(10), dp(6))
        }
        val items = listOf(
            R.id.home to "Home", R.id.movies to "Movies", R.id.tv_shows to "TV Shows",
            R.id.favorites to "My List", R.id.genre_hub to "Genres", R.id.platforms to "Platforms",
            R.id.search to "Search", R.id.settings to "Settings",
        )
        items.forEach { (id, label) ->
            val pill = TextView(requireContext()).apply {
                text = label
                textSize = 14f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                setPadding(dp(16), dp(8), dp(16), dp(8))
                isClickable = true
                isFocusable = true
                setOnClickListener { openSection(sectionFor(id)) }
            }
            styleSelected(pill, false)
            pillViews[id] = pill
            row.addView(pill, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dp(8) })
        }
        val scroller = HorizontalScrollView(requireContext()).apply {
            id = View.generateViewId()
            isHorizontalScrollBarEnabled = false
            addView(row)
        }
        pills = scroller
        val back = TextView(requireContext()).apply {
            text = "‹  Back"
            textSize = 16f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(8), dp(20), dp(8))
            isClickable = true
            isFocusable = true
            contentDescription = "Back"
            visibility = View.GONE
            setOnClickListener { navigateBack() }
        }
        styleSelected(back, false)
        backPill = back
        val bar = android.widget.FrameLayout(requireContext()).apply {
            id = View.generateViewId()
            addView(scroller, android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.WRAP_CONTENT))
            addView(back, android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT, android.widget.FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply { leftMargin = dp(10); topMargin = dp(8); bottomMargin = dp(6) })
        }
        topBar = bar
        b.root.addView(bar, ConstraintLayout.LayoutParams(
            ConstraintLayout.LayoutParams.MATCH_CONSTRAINT, ConstraintLayout.LayoutParams.WRAP_CONTENT))
        ConstraintSet().apply {
            clone(b.root)
            connect(bar.id, ConstraintSet.TOP, ConstraintSet.PARENT_ID, ConstraintSet.TOP)
            connect(bar.id, ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START)
            connect(bar.id, ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END)
            connect(b.navMainFragment.id, ConstraintSet.TOP, bar.id, ConstraintSet.BOTTOM)
            connect(b.navMainFragment.id, ConstraintSet.BOTTOM, ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM)
            applyTo(b.root)
        }
    }

    private fun styleSelected(v: TextView, selected: Boolean) {
        v.background = GradientDrawable().apply {
            cornerRadius = dp(20).toFloat()
            setColor(if (selected) 0xCC9A5CF0.toInt() else 0x59965AEB)
            setStroke(dp(2), if (selected) Color.WHITE else 0x80C8A8FF.toInt())
        }
    }

    private fun sectionFor(id: Int) = when (id) {
        R.id.movies -> "movies"
        R.id.tv_shows -> "shows"
        R.id.favorites -> "favorites"
        R.id.genre_hub -> "genres"
        R.id.platforms -> "platforms"
        R.id.search -> "search"
        R.id.settings -> "settings"
        else -> "home"
    }

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

    /** "settings:screen_x" opens VOD Settings directly on that section (the same keys as the TV host). */
    private fun settingsArgs(section: String): Bundle? =
        section.substringAfter("settings:", "").takeIf { Regex("^screen_[a-z_]+$").matches(it) }?.let {
            Bundle().apply { putString(androidx.preference.PreferenceFragmentCompat.ARG_PREFERENCE_ROOT, it) }
        }

    private fun openSection(section: String) {
        val controller = navigation ?: return
        titleDestination(section)?.let { (destination, id) ->
            runCatching {
                controller.navigate(destination, Bundle().apply { putString("id", id) })
            }.onFailure { Log.e("CharmVodRoot", "Cannot open requested title", it) }
            return
        }
        val destination = when {
            section == "search" -> R.id.search
            section == "movies" -> R.id.movies
            section == "shows" -> R.id.tv_shows
            section == "favorites" -> R.id.favorites
            section == "genres" -> R.id.genre_hub
            section == "platforms" -> R.id.platforms
            section.startsWith("settings") -> R.id.settings
            else -> R.id.home
        }
        val args = if (destination == R.id.settings) settingsArgs(section) else null
        if (controller.currentDestination?.id == destination && args == null) return
        controller.navigate(destination, args, navOptions {
            launchSingleTop = true
            popUpTo(R.id.home) { inclusive = false }
        })
    }

    fun navigateTo(section: String) {
        val previous = requestedSection
        requestedSection = section
        // React clears the one-shot title link afterwards ("home"); that must not pull the user off the title.
        if (section == "home" && titleDestination(previous) != null) return
        openSection(section)
    }

    private fun notifyWhenDrawn() {
        val b = _binding ?: return
        b.navMainFragment.post {
            if (!isAdded || _binding == null || rootReadyReported) return@post
            val navHost = childFragmentManager.findFragmentById(b.navMainFragment.id) as? NavHostFragment
            val content = navHost?.childFragmentManager?.primaryNavigationFragment?.view
            if (b.navMainFragment.width > 0 && b.navMainFragment.height > 0 &&
                content != null && content.width > 0 && content.height > 0) {
                rootReadyReported = true
                Log.i("CharmVodRoot", "Phone VOD ready in ${SystemClock.elapsedRealtime() - rootStartedAt}ms")
                onRootReady?.invoke()
            } else if (((b.navMainFragment.width <= 0 || b.navMainFragment.height <= 0) && ++sizeAttempts <= 25) || ++readyAttempts <= 45) {
                onNeedsLayout?.invoke()
                b.navMainFragment.postDelayed({ notifyWhenDrawn() }, 100L)
            } else {
                val message = "Phone VOD destination did not draw: container=${b.navMainFragment.width}x${b.navMainFragment.height}"
                Log.e("CharmVodRoot", message)
                onRootError?.invoke(message)
            }
        }
    }

    /** Touch screens have no rail focus to hand back. */
    fun restoreFocusFromRail(): Boolean = false

    /** True on a title, genre, platform or player page: system Back must pop it instead of leaving VOD. */
    fun canGoBack(): Boolean {
        val id = navigation?.currentDestination?.id ?: return false
        return isVisible && id !in TOP_LEVEL
    }

    fun isPlayerShown(): Boolean = isVisible && navigation?.currentDestination?.id == R.id.player

    fun onRemoteKey(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 &&
            event.keyCode == KeyEvent.KEYCODE_BACK) return navigateBack()
        return false
    }

    fun navigateBack(): Boolean {
        val controller = navigation ?: return false
        if (controller.currentDestination?.id in TOP_LEVEL) {
            onHostBack?.invoke()
            return true
        }
        val player = (childFragmentManager.findFragmentById(binding.navMainFragment.id)
            as? NavHostFragment)?.childFragmentManager?.primaryNavigationFragment as? PlayerMobileFragment
        if (player?.onBackPressed() == true) return true
        if (controller.navigateUp()) return true
        onHostBack?.invoke()
        return true
    }

    fun adjustLayoutDelta(x: Int?, y: Int?) = Unit

    override fun onDestroyView() {
        navigation = null
        pills = null
        topBar = null
        backPill = null
        pillViews.clear()
        onImmersiveChanged?.invoke(false)
        onRootReady = null
        onRootError = null
        onNeedsLayout = null
        VodHostActions.openGuide = null
        _binding = null
        super.onDestroyView()
    }
}
