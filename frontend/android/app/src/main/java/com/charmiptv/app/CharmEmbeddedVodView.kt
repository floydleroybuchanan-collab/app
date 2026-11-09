package com.charmiptv.app

import android.graphics.Color
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentContainerView
import androidx.navigation.NavController
import androidx.navigation.NavOptions
import androidx.navigation.fragment.NavHostFragment
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import com.streamflixreborn.streamflix.R as VodR
import com.streamflixreborn.streamflix.charm.VodFocusMemory
import com.streamflixreborn.streamflix.charm.VodGlassActionBar
import com.streamflixreborn.streamflix.fragments.player.PlayerTvFragment
import com.streamflixreborn.streamflix.providers.AnimeOnlineNinjaProvider
import com.streamflixreborn.streamflix.providers.Cine24hProvider
import com.streamflixreborn.streamflix.providers.FilmyOnlineCcProvider
import com.streamflixreborn.streamflix.providers.GuardaSerieProvider
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.providers.ZaluknijProvider
import com.streamflixreborn.streamflix.utils.UserPreferences

/**
 * Native VOD fragments live INSIDE the primary ReactActivity's PurpleTvShell.
 * This view is content only; it does not create its own Activity, left icon
 * rail, main drawer, React bridge, playback service, or persistent bitmap cache.
 *
 * The surrounding PurpleTvShell remains the sole owner of the icon-rail timeout
 * and all main navigation drawers. Fragment state is released on route exit,
 * so inactive VOD players and views do not retain decoders or RAM.
 */
internal class CharmEmbeddedVodView(
    private val reactContext: ThemedReactContext,
) : LinearLayout(reactContext) {

    private val topActions = VodGlassActionBar(reactContext)
    private val fragmentContainer = FragmentContainerView(reactContext).apply {
        id = View.generateViewId()
        isFocusable = true
        descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
    }
    private var navHost: NavHostFragment? = null
    private var controller: NavController? = null
    private var ownerActivity: FragmentActivity? = null
    private var backCallback: OnBackPressedCallback? = null
    private var focusListenerAttached = false
    private var active = false
    private var drawerOpen = false
    private var released = false
    private var focusMemory = VodFocusMemory()
    private val lastZoneWasBar = mutableMapOf<Int, Boolean>()
    private var pendingRestore: Runnable? = null
    private var lastPlayback = false

    init {
        orientation = VERTICAL
        setBackgroundColor(Color.rgb(7, 7, 17))
        isFocusableInTouchMode = false
        isFocusable = false
        addView(topActions, LayoutParams(LayoutParams.MATCH_PARENT, dp(104)))
        addView(fragmentContainer, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
        topActions.onNavigate = { navigateTo(it) }
    }

    private fun dp(px: Int) = (px * resources.displayMetrics.density + .5f).toInt()

    private fun event(name: String, value: Boolean? = null) {
        if (id == View.NO_ID) return
        val payload = Arguments.createMap()
        if (value != null) payload.putBoolean("playing", value)
        @Suppress("DEPRECATION")
        reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, name, payload)
    }

    private val focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { _, focused ->
        val destination = controller?.currentDestination?.id ?: return@OnGlobalFocusChangeListener
        if (focused == null || !active || drawerOpen || pendingRestore != null) return@OnGlobalFocusChangeListener
        when {
            VodFocusMemory.isWithin(topActions, focused) -> lastZoneWasBar[destination] = true
            VodFocusMemory.isWithin(fragmentContainer, focused) -> {
                lastZoneWasBar[destination] = false
                focusMemory.remember(destination, focused, fragmentContainer)
            }
        }
    }

    fun setActive(value: Boolean) {
        if (released || active == value) return
        active = value
        if (value) post { mountIfActive() } else unmount()
        refreshBackCallback()
    }

    fun setDrawerOpen(value: Boolean) {
        drawerOpen = value
        refreshBackCallback()
    }

    private fun refreshBackCallback() {
        backCallback?.isEnabled = active && !drawerOpen && isAttachedToWindow
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (active) post { mountIfActive() }
        refreshBackCallback()
    }

    override fun onDetachedFromWindow() {
        unmount()
        super.onDetachedFromWindow()
    }

    private fun currentContent(): View? =
        navHost?.childFragmentManager?.primaryNavigationFragment?.view

    private fun mountIfActive() {
        if (!active || released || !isAttachedToWindow || navHost != null) return
        val activity = reactContext.currentActivity as? FragmentActivity ?: return
        if (activity.isFinishing || activity.isDestroyed) return

        try {
            // Preserve the existing provider setup from MainTvActivity. The
            // application/database are already initialized once in this process.
            AnimeOnlineNinjaProvider.init(activity)
            Cine24hProvider.init(activity)
            FilmyOnlineCcProvider.init(activity)
            ZaluknijProvider.init(activity)
            GuardaSerieProvider.init(activity)

            val fragment = NavHostFragment.create(VodR.navigation.nav_main_graph_tv)
            activity.supportFragmentManager.beginTransaction()
                .replace(fragmentContainer.id, fragment, "charming-embedded-vod")
                .commitNowAllowingStateLoss()
            ownerActivity = activity
            navHost = fragment
            val nav = fragment.navController
            controller = nav

            nav.addOnDestinationChangedListener(destinationListener)
            if (UserPreferences.currentProvider != null &&
                nav.currentDestination?.id == VodR.id.providers) {
                nav.navigate(VodR.id.home)
            }

            if (!focusListenerAttached) {
                viewTreeObserver.addOnGlobalFocusChangeListener(focusListener)
                focusListenerAttached = true
            }

            val callback = object : OnBackPressedCallback(active && !drawerOpen) {
                override fun handleOnBackPressed() { handleBack() }
            }
            activity.onBackPressedDispatcher.addCallback(activity, callback)
            backCallback = callback
            refreshBackCallback()
            // VOD is the active route. Other live decoders were already released
            // by the React route before rendering this surface.
            CharmMemoryCoordinator.trim(CharmTrimLevel.BACKGROUND)
        } catch (error: Exception) {
            unmount()
            event("topVodError")
        }
    }

    private val destinationListener = NavController.OnDestinationChangedListener { _, dest, _ ->
        val isPlayer = dest.id == VodR.id.player
        topActions.visibility = if (isPlayer || dest.id == VodR.id.providers) View.GONE else View.VISIBLE
        topActions.setAvailable(
            UserPreferences.currentProvider?.let(Provider::supportsMovies) ?: true,
            UserPreferences.currentProvider?.let(Provider::supportsTvShows) ?: true,
        )
        if (isPlayer != lastPlayback) {
            lastPlayback = isPlayer
            event("topPlaybackChanged", isPlayer)
        }
        scheduleFocusRestore(dest.id)
    }

    private fun navigateTo(destination: Int) {
        val nav = controller ?: return
        if (!active || nav.currentDestination?.id == destination) return
        nav.navigate(destination, null, NavOptions.Builder()
            .setLaunchSingleTop(true)
            .setPopUpTo(VodR.id.home, false)
            .build())
    }

    private fun handleBack() {
        if (!active || drawerOpen) return
        val nav = controller ?: return
        when (nav.currentDestination?.id) {
            VodR.id.home, VodR.id.providers, VodR.id.search, VodR.id.movies,
            VodR.id.tv_shows, VodR.id.favorites, VodR.id.settings ->
                event("topRequestMainDrawer")
            else -> {
                val fragment = navHost?.childFragmentManager?.primaryNavigationFragment
                val playerHandled = (fragment as? PlayerTvFragment)?.onBackPressed() ?: false
                if (!playerHandled && !nav.navigateUp()) event("topRequestMainDrawer")
            }
        }
    }

    private fun scheduleFocusRestore(destination: Int) {
        cancelFocusRestore()
        if (!focusMemory.hasBookmark(destination) && lastZoneWasBar[destination] != true) return
        var attempts = 0
        val restore = object : Runnable {
            override fun run() {
                if (!active || controller?.currentDestination?.id != destination || released) {
                    cancelFocusRestore()
                    return
                }
                val restored = if (lastZoneWasBar[destination] == true) {
                    topActions.focusLastAction()
                } else focusMemory.restore(destination, fragmentContainer)
                if (restored || ++attempts >= 8) {
                    cancelFocusRestore()
                } else postDelayed(this, 110L)
            }
        }
        pendingRestore = restore
        post(restore)
    }

    private fun cancelFocusRestore() {
        pendingRestore?.let(::removeCallbacks)
        pendingRestore = null
    }

    private fun focusContent(): Boolean {
        val destination = controller?.currentDestination?.id ?: return false
        if (focusMemory.restore(destination, fragmentContainer)) return true
        return currentContent()?.requestFocus(View.FOCUS_DOWN) == true ||
            fragmentContainer.requestFocus(View.FOCUS_DOWN)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (active && !drawerOpen && event.action == KeyEvent.ACTION_DOWN) {
            val focus = findFocus()
            val key = event.keyCode
            if (key == KeyEvent.KEYCODE_DPAD_LEFT || key == KeyEvent.KEYCODE_DPAD_UP ||
                key == KeyEvent.KEYCODE_DPAD_DOWN || key == KeyEvent.KEYCODE_DPAD_RIGHT) {
                cancelFocusRestore()
            }
            if (topActions.visibility == View.VISIBLE && focus != null) {
                val inActions = VodFocusMemory.isWithin(topActions, focus)
                val inContent = VodFocusMemory.isWithin(fragmentContainer, focus)
                if (key == KeyEvent.KEYCODE_DPAD_LEFT && (inActions || inContent)) {
                    val next = focus.focusSearch(View.FOCUS_LEFT)
                    val scope = if (inActions) topActions else fragmentContainer
                    if (next == null || next === focus || !VodFocusMemory.isWithin(scope, next)) {
                        event("topRequestIconRail")
                        return true
                    }
                }
                if (key == KeyEvent.KEYCODE_DPAD_DOWN && inActions && focusContent()) return true
                if (key == KeyEvent.KEYCODE_DPAD_UP && inContent) {
                    val next = focus.focusSearch(View.FOCUS_UP)
                    if (next == null || !VodFocusMemory.isWithin(fragmentContainer, next)) {
                        return topActions.focusLastAction()
                    }
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun unmount() {
        cancelFocusRestore()
        backCallback?.remove()
        backCallback = null
        if (focusListenerAttached) {
            viewTreeObserver.removeOnGlobalFocusChangeListener(focusListener)
            focusListenerAttached = false
        }
        controller?.removeOnDestinationChangedListener(destinationListener)
        controller = null
        val oldHost = navHost
        navHost = null
        if (oldHost != null) {
            runCatching {
                ownerActivity?.supportFragmentManager?.beginTransaction()
                    ?.remove(oldHost)?.commitNowAllowingStateLoss()
            }
        }
        ownerActivity = null
        if (lastPlayback) {
            lastPlayback = false
            event("topPlaybackChanged", false)
        }
        // Fully disconnect fragment/player references on route exit. Glide's
        // bounded cache and on-disk provider metadata remain reusable.
        focusMemory = VodFocusMemory()
        lastZoneWasBar.clear()
        CharmMemoryCoordinator.trim(CharmTrimLevel.BACKGROUND)
    }

    fun release() {
        if (released) return
        active = false
        unmount()
        topActions.onNavigate = null
        released = true
    }
}
