package com.streamflixreborn.streamflix.charm

import android.os.SystemClock
import android.util.Log
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
import com.streamflixreborn.streamflix.providers.TmdbProvider
import com.streamflixreborn.streamflix.utils.UserPreferences

/**
 * One focus owner for the embedded native VOD surface. Back-stack navigation restores
 * the last real focus (including nested grids); Up/Down only cross a section
 * boundary when the physical focus search has no usable content neighbor.
 * Listeners are removed when the activity is destroyed.
 */
class VodFocusCoordinator(
    private val binding: ActivityMainTvBinding,
    private val navHost: NavHostFragment,
    private val navigation: NavController,
) {
    var onHostRailFocus: (() -> Boolean)? = null
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
        binding.vodGlassActions.setActiveDestination(destination.id)
        // TMDb supports both kinds. Answering here keeps this per-navigation check
        // from constructing every provider object in the table.
        val provider = UserPreferences.currentProvider
        val supportsEverything = provider == null || provider is TmdbProvider
        binding.vodGlassActions.setAvailable(
            supportsEverything || Provider.supportsMovies(provider!!),
            supportsEverything || Provider.supportsTvShows(provider!!),
        )
        // Keep the embedded content container visible on every section
        // transition; only the native player may hide the top glass controls.
        binding.navMainFragment.visibility = View.VISIBLE
        binding.navMainFragment.post {
            binding.navMainFragment.requestLayout()
            binding.navMainFragment.invalidate()
        }
        animatePage(destination.id, 0)
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
                Log.i("CharmVodFocus", "Top VOD action: destination=$destination")
                navigation.navigate(destination, null, navOptions {
                    launchSingleTop = true
                    // A section switch restores its own visible layout; do not
                    // recreate the React host or Activity.
                    popUpTo(R.id.home) { inclusive = false }
                })
                // On emulators and older Android TVs, native NavHost content
                // sometimes requires a layout pass after a child transaction.
                binding.navMainFragment.post {
                    binding.navMainFragment.visibility = View.VISIBLE
                    binding.navMainFragment.requestLayout()
                    binding.navMainFragment.invalidate()
                }
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
        val inBar = VodFocusMemory.isWithin(binding.vodGlassActions, current)
        val content = currentContentRoot()
        val inContent = content != null && VodFocusMemory.isWithin(content, current)

        // LEFT travels normally across cards and glass buttons. Only after
        // crossing the very last focusable item does it enter the icon rail.
        // BACK never uses this path and does not touch the icon rail.
        if (key == KeyEvent.KEYCODE_DPAD_LEFT) {
            if (inBar && binding.vodGlassActions.isFirstActionFocused(current)) {
                return event.repeatCount > 0 || onHostRailFocus?.invoke() == true
            }
            if (inContent && content != null) {
                val next = current.focusSearch(View.FOCUS_LEFT)
                // A diagonal item in another row is not a Left neighbor.
                if (next == null || !VodFocusMemory.isWithin(content, next) || !sharesRow(current, next)) {
                    // A row still scrolling back has more items; a held key stops at the edge.
                    if (hasMoreToTheLeft(current, content)) return false
                    return event.repeatCount > 0 || onHostRailFocus?.invoke() == true
                }
            }
        }
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

    private var lastAnimatedPage: View? = null

    /** The new page's view arrives shortly after navigation, so wait a few frames for it. */
    private fun animatePage(destination: Int, attempt: Int) {
        if (disposed || destination == R.id.player || navigation.currentDestination?.id != destination) return
        val page = currentContentRoot()
        if (page == null || page === lastAnimatedPage) {
            if (attempt < 10) binding.navMainFragment.postDelayed({ animatePage(destination, attempt + 1) }, 32L)
            return
        }
        lastAnimatedPage = page
        when (destination) {
            R.id.movies, R.id.tv_shows, R.id.search, R.id.favorites, R.id.season, R.id.genre, R.id.people ->
                page.background = VodMotion.background()
        }
        VodMotion.page(page)
    }

    private fun hasMoreToTheLeft(view: View, content: View): Boolean {
        var ancestor = view.parent as? View
        while (ancestor != null && ancestor !== content) {
            if (ancestor.canScrollHorizontally(-1)) return true
            ancestor = ancestor.parent as? View
        }
        return false
    }

    private fun sharesRow(a: View, b: View): Boolean {
        val first = IntArray(2).also(a::getLocationOnScreen)
        val second = IntArray(2).also(b::getLocationOnScreen)
        return first[1] < second[1] + b.height && second[1] < first[1] + a.height
    }

    fun focusBar(): Boolean = binding.vodGlassActions.visibility == View.VISIBLE &&
        binding.vodGlassActions.focusLastAction()

    /**
     * RIGHT from Charming MediaLab's React rail cannot use the RN page guide:
     * this nested NavHost is an Android View hierarchy. Restore the native
     * focus bookmark, otherwise choose content then the top glass action.
     */
    fun restoreFocusFromHost(): Boolean {
        if (disposed) return false
        val destination = navigation.currentDestination?.id ?: return focusBar()
        if (lastZoneWasBar[destination] == true && focusBar()) return true
        val content = currentContentRoot()
        if (content != null && focusMemory.restore(destination, content)) return true
        if (content?.requestFocus(View.FOCUS_RIGHT) == true) return true
        return focusBar()
    }

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
        lastAnimatedPage = null
        cancelPendingRestore()
        binding.vodGlassActions.onNavigate = null
        onHostRailFocus = null
        navigation.removeOnDestinationChangedListener(destinationListener)
        binding.root.viewTreeObserver.removeOnGlobalFocusChangeListener(focusListener)
    }
}
