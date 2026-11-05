package com.charmiptv.app

import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.FragmentActivity
import androidx.navigation.fragment.NavHostFragment
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter
import com.streamflixreborn.streamflix.R as VodR
import com.streamflixreborn.streamflix.charm.*
import com.streamflixreborn.streamflix.utils.UserPreferences

/** VOD destinations live inside the MediaLab activity and its existing navigation shell. */
class CharmVodSurface(private val react: ThemedReactContext) : FrameLayout(react) {
    private var host: NavHostFragment? = null
    private var owner: FragmentActivity? = null
    private var section = "home"
    private var television = true
    private var settingsSurface = false
    private var disposed = false
    private val root = ConstraintLayout(react)
    private val container = FrameLayout(react).apply { id = VodR.id.nav_main_fragment }
    private var layoutPosted = false
    private var layingOutChildren = false
    private val layoutNativeChildren = Runnable {
        layoutPosted = false
        if (!disposed && isAttachedToWindow && width > 0 && height > 0) {
            // React lays out this surface, but fragment/RecyclerView children
            // use Android requestLayout, which does not schedule another Yoga
            // pass. Measure only this native subtree using the latest bounds.
            layingOutChildren = true
            try {
                // Clear this host's layout-request flag too. Measuring only
                // root leaves the host marked dirty; subsequent child requests
                // then stop at parent.isLayoutRequested and never reach us.
                measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
                layout(left, top, right, bottom)
            } finally { layingOutChildren = false }
        }
    }
    private val mountSurface = Runnable { mount() }
    private fun scheduleNativeLayout() {
        if (disposed || !isAttachedToWindow || layoutPosted || layingOutChildren) return
        layoutPosted = true
        postOnAnimation(layoutNativeChildren)
    }
    override fun requestLayout() {
        super.requestLayout()
        scheduleNativeLayout()
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        scheduleNativeLayout()
    }
    override fun onDetachedFromWindow() {
        removeCallbacks(mountSurface)
        removeCallbacks(layoutNativeChildren)
        layoutPosted = false
        super.onDetachedFromWindow()
    }

    init {
        setBackgroundColor(0xFF0C0E12.toInt())
        addView(root, LayoutParams(-1, -1))
        root.addView(container, ConstraintLayout.LayoutParams(0, 0).apply {
            startToStart = 0; endToEnd = 0; topToTop = 0; bottomToBottom = 0
        })
    }

    fun section(value: String?) {
        val next = value ?: "home"
        if (next == "settings" || next == "accounts") settingsSurface = true
        if (next == "sources" && !settingsSurface) { event("error", "Open Settings to change your VOD provider."); return }
        if (section == next) return
        section = next
        host?.let { navigate(it, next) }
    }
    fun television(value: Boolean) { television = value }
    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        owner?.let { if (CharmPageDrawer.dispatch(it, event)) return true }
        return super.dispatchKeyEvent(event)
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); post(mountSurface); scheduleNativeLayout() }
    private fun event(name: String, value: String) {
        if (disposed) return
        @Suppress("DEPRECATION")
        react.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, "topVodEvent", Arguments.createMap().apply {
            putString("kind", name); putString("value", value)
        })
    }
    private fun mount() {
        if (disposed || host != null || !isAttachedToWindow) return
        val activity = react.currentActivity as? FragmentActivity ?: return
        if (activity.supportFragmentManager.isStateSaved) { event("error", "Return to this screen to open the library."); return }
        try {
        // RN route transitions may overlap old/new surfaces in one activity.
        // Release the old fixed-ID host before Android searches for our container.
        activeSurfaces[activity]?.get()?.takeIf { it !== this }?.dispose()
        activity.supportFragmentManager.findFragmentByTag(HOST_TAG)?.let { stale ->
            activity.supportFragmentManager.beginTransaction().remove(stale).commitNowAllowingStateLoss()
        }
        activeSurfaces[activity] = java.lang.ref.WeakReference(this)
        owner = activity
        activity.setTheme(if (television)
            com.streamflixreborn.streamflix.utils.ThemeManager.tvThemeRes(UserPreferences.selectedTheme)
            else com.streamflixreborn.streamflix.utils.ThemeManager.mobileThemeRes(UserPreferences.selectedTheme))
        CharmHostSession.attachSurface(activity) { route -> event("route", route) }
        CharmDesign.install(activity)
        com.streamflixreborn.streamflix.providers.AnimeOnlineNinjaProvider.init(activity)
        com.streamflixreborn.streamflix.providers.Cine24hProvider.init(activity)
        com.streamflixreborn.streamflix.providers.FilmyOnlineCcProvider.init(activity)
        com.streamflixreborn.streamflix.providers.ZaluknijProvider.init(activity)
        com.streamflixreborn.streamflix.providers.GuardaSerieProvider.init(activity)
        // Set defaults before constructing any catalog ViewModel. The upstream
        // graph starts at Providers; inflate it without that transient chooser.
        CharmVodDefaults.apply()
        val fragment = NavHostFragment()
        host = fragment
            activity.supportFragmentManager.beginTransaction().add(container.id, fragment, HOST_TAG).commitNow()
            if (television) CharmPageDrawer.install(activity, root)
            val graph = fragment.navController.navInflater.inflate(if (television) VodR.navigation.nav_main_graph_tv else VodR.navigation.nav_main_graph_mobile)
            graph.setStartDestination(if (section in setOf("settings", "accounts")) VodR.id.settings else VodR.id.home)
            fragment.navController.graph = graph
            fragment.navController.addOnDestinationChangedListener { _, destination, _ ->
                scheduleNativeLayout()
                event("player", if (destination.id == VodR.id.player) "true" else "false")
            }
            navigate(fragment, section)
            scheduleNativeLayout()
            event("ready", "true")
        } catch (error: Exception) {
            event("error", "Unable to open this library screen. Return and try again.")
            dispose()
        }
    }
    private fun navigate(fragment: NavHostFragment, value: String) {
        val nav = fragment.navController
        val args = Bundle()
        val destination = when {
            value.startsWith("movie:") -> { args.putString("id", value.substringAfter(":")); VodR.id.movie }
            value.startsWith("show:") -> { args.putString("id", value.substringAfter(":")); args.putString("poster", null); args.putString("banner", null); VodR.id.tv_show }
            value.startsWith("search:") -> { args.putString("medialab.query", value.substringAfter(":")); VodR.id.search }
            value == "movies" -> VodR.id.movies
            value == "series" -> VodR.id.tv_shows
            value == "search" -> VodR.id.search
            value == "favorites" -> VodR.id.favorites
            value == "sources" -> VodR.id.providers
            value == "settings" || value == "accounts" -> VodR.id.settings
            else -> VodR.id.home
        }
        if (nav.currentDestination?.id != destination || !args.isEmpty) nav.navigate(destination, args)
    }
    fun dispose() {
        if (disposed) return
        disposed = true
        removeCallbacks(mountSurface)
        removeCallbacks(layoutNativeChildren)
        layoutPosted = false
        val activity = owner
        if (activity != null) {
            host?.takeIf { it.isAdded && !activity.supportFragmentManager.isDestroyed }?.let { activity.supportFragmentManager.beginTransaction().remove(it).commitNowAllowingStateLoss() }
            if (activeSurfaces[activity]?.get() === this) {
                activeSurfaces.remove(activity)
                CharmPageDrawer.uninstall(activity)
                CharmHostSession.detachSurface(activity)
            }
        }
        // A detached React route can remain in its parent until the transition
        // completes. It must no longer win findViewById for the next VOD host.
        container.id = View.NO_ID
        host = null; owner = null
    }
    companion object {
        private const val HOST_TAG = "medialab-vod-surface"
        private val activeSurfaces = java.util.WeakHashMap<FragmentActivity, java.lang.ref.WeakReference<CharmVodSurface>>()
    }
}

class CharmVodSurfaceManager : SimpleViewManager<CharmVodSurface>() {
    override fun getName() = "CharmVodSurface"
    override fun createViewInstance(context: ThemedReactContext) = CharmVodSurface(context)
    @ReactProp(name = "section") fun section(view: CharmVodSurface, value: String?) = view.section(value)
    @ReactProp(name = "television", defaultBoolean = true) fun television(view: CharmVodSurface, value: Boolean) = view.television(value)
    override fun onDropViewInstance(view: CharmVodSurface) { view.dispose(); super.onDropViewInstance(view) }
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> = mutableMapOf("topVodEvent" to mapOf("registrationName" to "onVodEvent"))
}
