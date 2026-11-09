package com.streamflixreborn.streamflix.charm

import android.os.SystemClock
import android.view.FocusFinder
import android.view.KeyEvent
import android.view.View
import android.view.ViewTreeObserver
import androidx.navigation.NavController
import androidx.navigation.navOptions
import androidx.navigation.fragment.NavHostFragment
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.databinding.ActivityMainTvBinding
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.utils.UserPreferences

/**
 * One focus owner for the native VOD activity. Back-stack navigation restores
 * the last real focus (including nested grids); Up/Down only cross a section
 * boundary when the physical focus search has no usable content neighbor.
 * Listeners are removed when the activity is destroyed.
 */
class VodFocusCoordinator(
    private val binding: ActivityMainTvBinding,
    private val navHost: NavHostFragment,
    private val navigation: NavController,
) {
    private val focusMemory = VodFocusMemory()
    private val lastZoneWasBar = mutableMapOf<Int, Boolean>()
    private var pendingDestination: Int? = null
    private var pendingStartedAt = 0L
    private var restoring = false
    private var disposed = false
    private var layoutListenerAttached = false

    private val focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { _, new ->
        // Default Android focus on a newly mounted fragment is not the
        // user's previous selection. Never overwrite a pending bookmark.
        if (disposed || restoring || pendingDestination != null || new == null) return@OnGlobalFocusChangeListener
        val destination = navigation.currentDestination?.id ?: return@OnGlobalFocusChangeListener
        val content = currentContentRoot()
        when {
            VodFocusMemory.isWithin(binding.vodGlassActions, new) ->
                lastZoneWasBar[destination] = true
            content != null && VodFocusMemory.isWithin(content, new) -> {
                lastZoneWasBar[destination] = false
                focusMemory.remember(destination, new, content)
            }
        }
    }

    private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener {
        if (pendingDestination != null) attemptRestore()
    }

    private val destinationListener = NavController.OnDestinationChangedListener { _, destination, _ ->
        // All VOD browse/detail pages can reach the glass navigation with Up.
        // The video player and the provider selector remain full-screen.
        binding.vodGlassActions.visibility = if (destination.id == R.id.player ||
            destination.id == R.id.providers) View.GONE else View.VISIBLE
        binding.vodGlassActions.setAvailable(
            UserPreferences.currentProvider?.let { Provider.supportsMovies(it) } ?: true,
            UserPreferences.currentProvider?.let { Provider.supportsTvShows(it) } ?: true,
        )
        cancelPendingRestore()
        if (focusMemory.hasBookmark(destination.id) || lastZoneWasBar[destination.id] == true) {
            pendingDestination = destination.id
            pendingStartedAt = SystemClock.uptimeMillis()
            attachLayoutListener()
            binding.navMainFragment.post { attemptRestore() }
        }
    }

    fun install() {
        binding.root.viewTreeObserver.addOnGlobalFocusChangeListener(focusListener)
        binding.vodGlassActions.onNavigate = { destination ->
            if (navigation.currentDestination?.id != destination) {
                navigation.navigate(destination, null, navOptions {
                    launchSingleTop = true
                    // A top-navigation click is a section switch, not another
                    // copy of the same stack. Movie/episode detail stacks remain
                    // intact until explicitly leaving via the bar.
                    popUpTo(R.id.home) { inclusive = false }
                })
            }
        }
        navigation.addOnDestinationChangedListener(destinationListener)
    }

    fun onKey(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN || disposed) return false
        val key = event.keyCode
        if (key == KeyEvent.KEYCODE_DPAD_UP || key == KeyEvent.KEYCODE_DPAD_DOWN ||
            key == KeyEvent.KEYCODE_DPAD_LEFT || key == KeyEvent.KEYCODE_DPAD_RIGHT ||
            key == KeyEvent.KEYCODE_BACK) {
            // Any new remote input invalidates an asynchronous restoration.
            // A stale layout callback must never undo the user's movement.
            cancelPendingRestore()
        }
        if (binding.vodGlassActions.visibility != View.VISIBLE) return false
        val current = binding.root.findFocus() ?: return false
        if (key == KeyEvent.KEYCODE_DPAD_DOWN &&
            VodFocusMemory.isWithin(binding.vodGlassActions, current)) {
            return focusContent()
        }
        if (key == KeyEvent.KEYCODE_DPAD_UP &&
            VodFocusMemory.isWithin(binding.navMainFragment, current)) {
            val next = FocusFinder.getInstance().findNextFocus(binding.root, current, View.FOCUS_UP)
            if (next == null || !VodFocusMemory.isWithin(binding.navMainFragment, next)) {
                return binding.vodGlassActions.focusLastAction()
            }
        }
        return false // Native Android D-pad handles all ordinary in-section moves.
    }

    fun focusBar(): Boolean = binding.vodGlassActions.visibility == View.VISIBLE &&
        binding.vodGlassActions.focusLastAction()

    private fun focusContent(): Boolean {
        val content = currentContentRoot() ?: return false
        val destination = navigation.currentDestination?.id ?: return false
        if (focusMemory.restore(destination, content)) return true
        val focused = binding.root.findFocus() ?: return content.requestFocus(View.FOCUS_DOWN)
        val next = FocusFinder.getInstance().findNextFocus(
            binding.root, focused, View.FOCUS_DOWN,
        )
        if (next != null && VodFocusMemory.isWithin(content, next) && next.requestFocus()) return true
        return content.requestFocus(View.FOCUS_DOWN)
    }

    private fun currentContentRoot(): View? =
        navHost.childFragmentManager.primaryNavigationFragment?.view

    private fun attachLayoutListener() {
        if (layoutListenerAttached) return
        binding.navMainFragment.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
        layoutListenerAttached = true
    }

    private fun cancelPendingRestore() {
        pendingDestination = null
        if (layoutListenerAttached) {
            binding.navMainFragment.viewTreeObserver.removeOnGlobalLayoutListener(layoutListener)
            layoutListenerAttached = false
        }
    }

    private fun attemptRestore() {
        val destination = pendingDestination ?: return
        if (disposed || navigation.currentDestination?.id != destination ||
            SystemClock.uptimeMillis() - pendingStartedAt > 6000L) {
            cancelPendingRestore()
            return
        }
        restoring = true
        val restored = try {
            if (lastZoneWasBar[destination] == true) {
                focusBar()
            } else {
                val content = currentContentRoot()
                content != null && focusMemory.restore(destination, content)
            }
        } finally {
            restoring = false
        }
        if (restored) cancelPendingRestore()
    }

    fun dispose() {
        disposed = true
        cancelPendingRestore()
        binding.vodGlassActions.onNavigate = null
        navigation.removeOnDestinationChangedListener(destinationListener)
        binding.root.viewTreeObserver.removeOnGlobalFocusChangeListener(focusListener)
    }
}
