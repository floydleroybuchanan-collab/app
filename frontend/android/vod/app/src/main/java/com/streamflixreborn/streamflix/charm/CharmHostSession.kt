package com.streamflixreborn.streamflix.charm

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import androidx.navigation.NavController
import com.streamflixreborn.streamflix.R

/** Intent-based handoff works across the protected VOD process boundary. */
object CharmHostSession {
    private val surfaces = java.util.WeakHashMap<Activity, (String) -> Unit>()
    fun attachSurface(activity: Activity, navigate: (String) -> Unit) { surfaces[activity] = navigate }
    fun detachSurface(activity: Activity) { surfaces.remove(activity) }
    fun hasSurface(activity: Activity) = surfaces.containsKey(activity)
    private val states = mutableMapOf<String, Bundle>()
    private var sessionToken: String? = null
    fun embedded(activity: Activity) = hasSurface(activity) || activity.intent.getBooleanExtra("medialab.embedded", false)
    fun take(activity: Activity): Bundle? {
        if (!embedded(activity)) return null
        val token = activity.intent.getStringExtra("medialab.token")
        if (token != sessionToken) { states.clear(); sessionToken = token }
        CharmSharedPlayback.configure(activity.intent.getStringExtra("medialab.settings"))
        return if (activity.intent.getStringExtra("medialab.section") == "home") states.remove(activity.javaClass.name) else null
    }
    fun save(activity: Activity, state: Bundle) {
        val section = activity.intent.getStringExtra("medialab.section")
        if (embedded(activity) && section != "settings" && section != "accounts") states[activity.javaClass.name] = state
    }
    fun leave(activity: Activity, route: String) {
        surfaces[activity]?.let { it(route); return }
        activity.setResult(Activity.RESULT_OK, Intent().putExtra("medialab.route", route))
        activity.finish()
        @Suppress("DEPRECATION")
        activity.overridePendingTransition(0, 0)
    }
    fun configure(activity: FragmentActivity, nav: NavController, restored: Boolean) {
        if (!embedded(activity)) return
        CharmSharedPlayback.configure(activity.intent.getStringExtra("medialab.settings"))
        CharmUsageReporter.configure(activity.application, activity.intent.getStringExtra("medialab.token"), activity.intent.getIntExtra("medialab.build", 0), activity)
        val section = activity.intent.getStringExtra("medialab.section").orEmpty()
        if (!restored) when {
            section.startsWith("movie:") -> nav.navigate(R.id.movie, Bundle().apply { putString("id", section.substringAfter(":")) })
            section.startsWith("show:") -> nav.navigate(R.id.tv_show, Bundle().apply { putString("id", section.substringAfter(":")); putString("poster", null); putString("banner", null) })
            section.startsWith("search:") -> nav.navigate(R.id.search, Bundle().apply { putString("medialab.query", section.substringAfter(":")) })
            section == "movies" -> nav.navigate(R.id.movies)
            section == "series" -> nav.navigate(R.id.tv_shows)
            section == "search" -> nav.navigate(R.id.search)
            section == "favorites" -> nav.navigate(R.id.favorites)
            section == "sources" -> nav.navigate(R.id.providers)
            (section == "settings" || section == "accounts") -> nav.navigate(R.id.settings)
        }
    }
}
