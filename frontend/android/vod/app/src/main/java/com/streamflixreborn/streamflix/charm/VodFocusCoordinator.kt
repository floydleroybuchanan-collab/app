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

    /**
     * Opening a title from a page replaces the focused card with a loading
     * page that has nothing focusable. Android then gave focus to the first
     * view in the window — the app rail's Live TV item — so the next OK left
     * VOD for Live TV (it looked like VOD crashed). Until the new page can take
     * focus, keep it parked on the VOD top bar, then move it into the page.
     */
    private var parkedDestination: Int? = null
    private var parkUntil = 0L
    private var parkListenerAttached = false
    private var reclaimPosted = false

    private val parkLayoutListener = ViewTreeObserver.OnGlobalLayoutListener { focusParkedContent() }

    private val focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { _, new ->
        if (!disposed && parkedDestination != null && new != null && !reclaimPosted &&
            SystemClock.uptimeMillis() <= parkUntil &&
            !VodFocusMemory.isWithin(binding.root, new) && binding.root.isShown) {
            // Focus slipped out of VOD without a remote key: take it back.
            reclaimPosted = true
            binding.root.post {
                reclaimPosted = false
                if (parkedDestination != null && !disposed) parkOnBar()
            }
        }
        // Default Android focus on a newly mounted fragment is not the
        // user's previous selection. Never overwrite a pending bookmark.
        if (disposed || restoring || pendingDestination != null || new == null) return@OnGlobalFocusChangeListener
        val destination = navigation.currentDestination?.id ?: return@OnGlobalFocusChangeListener
        // Never bookmark inside the player: each play builds a new player view.
        if (destination == R.id.player) return@OnGlobalFocusChangeListener
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
        // Navigation started from page content (a card, a poster, Back on a
        // detail page): the focused view is about to be removed. Park focus on
        // the top bar *now*, while the old view is still attached, so Android
        // never hands it to the app rail. The player owns its own focus.
        cancelParking()
        val prior = binding.root.findFocus()
        val fromContent = prior != null && !VodFocusMemory.isWithin(binding.vodGlassActions, prior)
        if (fromContent && destination.id != R.id.player && destination.id != R.id.providers) {
            parkedDestination = destination.id
            parkUntil = SystemClock.uptimeMillis() + PARK_TIMEOUT_MS
            parkOnBar()
            if (!parkListenerAttached) {
                binding.navMainFragment.viewTreeObserver.addOnGlobalLayoutListener(parkLayoutListener)
                parkListenerAttached = true
            }
            startParkTick()
        }
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
        // Any key means the user is steering again (including LEFT/BACK to the
        // app rail), so focus parking for a loading page ends here.
        cancelParking()
        // VOD playback: Media3 drops focus when it hides its controls. If a key
        // arrives while focus is anywhere but the player view, give focus back
        // to the player and show the controls (after a few plays the saved
        // focus spot could point at an old player's view, so they never came back).
        if (navigation.currentDestination?.id == R.id.player) {
            if (key == KeyEvent.KEYCODE_BACK) return false
            val playerView = playerView() ?: return false
            val page = currentContentRoot()
            val focused = binding.root.findFocus()
            // Settings panel / next-episode box may hold focus legitimately.
            val focusUsable = focused != null && focused.isShown &&
                page != null && VodFocusMemory.isWithin(page, focused)
            if (!focusUsable) {
                playerView.requestFocus()
                playerView.showController()
                return true
            }
            return false
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
        // UP from far along a horizontal row (e.g. "You may also like"): the
        // row above often has no card laid out straight overhead, so Android
        // found nothing and focus stayed put until the user went back left.
        // Fall back to the nearest card in the row above.
        if (key == KeyEvent.KEYCODE_DPAD_UP && inContent && content != null) {
            val native = current.focusSearch(View.FOCUS_UP)
            if (native == null || native === current || !isAbove(native, current)) {
                val above = nearestAbove(content, current)
                if (above != null && above.requestFocus()) return true
            }
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

    private var lastAnimatedPage = java.lang.ref.WeakReference<View>(null)

    /** The new page's view arrives shortly after navigation, so wait a few frames for it. */
    private fun animatePage(destination: Int, attempt: Int) {
        if (disposed || destination == R.id.player || navigation.currentDestination?.id != destination) return
        val page = currentContentRoot()
        if (page == null || page === lastAnimatedPage.get()) {
            if (attempt < 10) binding.navMainFragment.postDelayed({ animatePage(destination, attempt + 1) }, 32L)
            return
        }
        lastAnimatedPage = java.lang.ref.WeakReference(page)
        when (destination) {
            R.id.movies, R.id.tv_shows, R.id.search, R.id.favorites, R.id.season, R.id.genre, R.id.people, R.id.hearts ->
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

    private fun isAbove(candidate: View, from: View): Boolean {
        val a = IntArray(2).also(candidate::getLocationOnScreen)
        val b = IntArray(2).also(from::getLocationOnScreen)
        return a[1] + candidate.height <= b[1] + from.height / 2
    }

    /** Closest shown focusable whose bottom is above [from]'s top: nearest row first, then nearest x. */
    private fun nearestAbove(content: View, from: View): View? {
        val origin = IntArray(2).also(from::getLocationOnScreen)
        val fromTop = origin[1]
        val fromCenterX = origin[0] + from.width / 2
        val candidates = ArrayList<View>()
        content.addFocusables(candidates, View.FOCUS_UP)
        var best: View? = null
        var bestRowGap = Int.MAX_VALUE
        var bestDx = Int.MAX_VALUE
        val spot = IntArray(2)
        for (view in candidates) {
            if (view === from || !view.isShown || view.width == 0 || view.height == 0) continue
            view.getLocationOnScreen(spot)
            val bottom = spot[1] + view.height
            if (bottom > fromTop + 2) continue
            val rowGap = fromTop - bottom
            val dx = kotlin.math.abs(spot[0] + view.width / 2 - fromCenterX)
            // Same row band (within 24px) counts as one row: pick nearest x there.
            if (rowGap < bestRowGap - 24 || (kotlin.math.abs(rowGap - bestRowGap) <= 24 && dx < bestDx)) {
                best = view
                bestRowGap = rowGap
                bestDx = dx
            }
        }
        return best
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
        // During playback the player view is the only right owner: it shows the
        // controls on the next key. A remembered spot may belong to an old player.
        if (destination == R.id.player) return playerView()?.requestFocus() == true
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

    /** The current player's view while the VOD player page is shown. */
    private fun playerView(): androidx.media3.ui.PlayerView? =
        currentContentRoot()?.findViewById(R.id.pv_player)

    /** True while the VOD player page is the current page. */
    fun isPlayerShown(): Boolean = !disposed && navigation.currentDestination?.id == R.id.player

    /**
     * A title opened directly (from Live TV's recently watched row) arrives
     * with focus still on the app's React side. Bring it into VOD and onto
     * the title page as soon as the page has buttons.
     */
    fun focusIncomingPage() {
        val destination = navigation.currentDestination?.id ?: return
        cancelParking()
        parkedDestination = destination
        parkUntil = SystemClock.uptimeMillis() + PARK_TIMEOUT_MS
        binding.navMainFragment.viewTreeObserver.addOnGlobalLayoutListener(parkLayoutListener)
        parkListenerAttached = true
        startParkTick()
        binding.root.post {
            if (parkedDestination == destination && !disposed) {
                parkOnBar()
                focusParkedContent()
            }
        }
    }

    /** Focus the top bar without recording it as the page's chosen zone. */
    private fun parkOnBar() {
        if (binding.vodGlassActions.visibility != View.VISIBLE) return
        restoring = true
        try { binding.vodGlassActions.focusLastAction() } finally { restoring = false }
    }

    /** Once the parked page has laid out its content, move focus into it. */
    private fun focusParkedContent() {
        val destination = parkedDestination ?: return
        if (disposed || navigation.currentDestination?.id != destination ||
            SystemClock.uptimeMillis() > parkUntil) {
            cancelParking()
            return
        }
        // A bookmarked page (Back) is first given to attemptRestore. When that
        // gives up (the page reloads its data, often longer than its window),
        // the tick below still lands focus on the page. Before, focus stayed on
        // the top bar's Home button, so the next OK left the title for Home.
        if (pendingDestination == destination) return
        val content = currentContentRoot() ?: return
        if (content.findFocus() != null) { cancelParking(); return }
        // Only leave the bar while focus is still parked there (no key since).
        val focused = binding.root.findFocus()
        if (focused != null && !VodFocusMemory.isWithin(binding.vodGlassActions, focused)) return
        if (!content.hasFocusable()) return
        if (!content.requestFocus(View.FOCUS_DOWN)) return
        // A still-empty list (page loading) is not a landing spot: keep waiting.
        val landed = binding.root.findFocus()
        if (landed is androidx.recyclerview.widget.RecyclerView && landed.childCount == 0) {
            parkOnBar()
            return
        }
        cancelParking()
    }

    private val parkTick = object : Runnable {
        override fun run() {
            if (disposed || parkedDestination == null) return
            focusParkedContent()
            if (parkedDestination != null) binding.root.postDelayed(this, PARK_TICK_MS)
        }
    }

    private fun startParkTick() {
        binding.root.removeCallbacks(parkTick)
        binding.root.postDelayed(parkTick, PARK_TICK_MS)
    }

    private fun cancelParking() {
        binding.root.removeCallbacks(parkTick)
        parkedDestination = null
        if (parkListenerAttached) {
            binding.navMainFragment.viewTreeObserver.removeOnGlobalLayoutListener(parkLayoutListener)
            parkListenerAttached = false
        }
    }

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
        lastAnimatedPage.clear()
        cancelPendingRestore()
        cancelParking()
        binding.vodGlassActions.onNavigate = null
        onHostRailFocus = null
        navigation.removeOnDestinationChangedListener(destinationListener)
        binding.root.viewTreeObserver.removeOnGlobalFocusChangeListener(focusListener)
    }

    private companion object {
        /** Slow providers can take several seconds before a title page has buttons. */
        const val PARK_TIMEOUT_MS = 20_000L
        /** How often a parked page re-checks for something to focus (cheap). */
        const val PARK_TICK_MS = 250L
    }
}
