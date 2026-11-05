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
    private var disposed = false
    private val root = ConstraintLayout(react)
    private val container = FrameLayout(react).apply { id = VodR.id.nav_main_fragment }

    init {
        setBackgroundColor(0xFF100E17.toInt())
        addView(root, LayoutParams(-1, -1))
        root.addView(container, ConstraintLayout.LayoutParams(0, 0).apply {
            startToStart = 0; endToEnd = 0; topToTop = 0; bottomToBottom = 0
        })
    }

    fun section(value: String?) {
        val next = value ?: "home"
        if (section == next) return
        section = next
        host?.let { navigate(it, next) }
    }
    fun television(value: Boolean) { television = value }
    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        owner?.let { if (CharmPageDrawer.dispatch(it, event)) return true }
        return super.dispatchKeyEvent(event)
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); post { mount() } }
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
        val fragment = NavHostFragment.create(if (television) VodR.navigation.nav_main_graph_tv else VodR.navigation.nav_main_graph_mobile)
        host = fragment
        try {
            activity.supportFragmentManager.beginTransaction().add(container.id, fragment, "medialab-vod-surface").commitNow()
            if (television && section !in setOf("settings", "accounts")) CharmPageDrawer.install(activity, root)
            fragment.navController.addOnDestinationChangedListener { _, destination, _ ->
                event("player", if (destination.id == VodR.id.player) "true" else "false")
            }
            navigate(fragment, section)
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
            else -> if (UserPreferences.currentProvider == null) VodR.id.providers else VodR.id.home
        }
        if (nav.currentDestination?.id != destination || !args.isEmpty) nav.navigate(destination, args)
    }
    fun dispose() {
        if (disposed) return
        disposed = true
        val activity = owner
        if (activity != null) {
            host?.let { activity.supportFragmentManager.beginTransaction().remove(it).commitNowAllowingStateLoss() }
            CharmPageDrawer.uninstall(activity)
            CharmHostSession.detachSurface(activity)
        }
        host = null; owner = null
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
