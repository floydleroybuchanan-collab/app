package com.streamflixreborn.streamflix.charm

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.navigation.NavController
import com.streamflixreborn.streamflix.R
import org.json.JSONArray

/** Shared host navigation contract. No Guide group navigation exists in VOD. */
object MediaLabSession {
    private val states = mutableMapOf<String, Bundle>()
    var destinations = JSONArray()
    fun takeState(layout: String): Bundle? = states.remove(layout)
    fun saveState(layout: String, state: Bundle) { states[layout] = state }
    fun clear() { states.clear() }
    fun leave(activity: Activity, route: String) {
        activity.setResult(Activity.RESULT_OK, Intent().putExtra("medialab.route", route))
        activity.finish()
    }
    fun showDrawer(activity: Activity) {
        // Return to the host's actual first drawer, preserving this library's stack.
        leave(activity, "medialab:drawer")
    }

    fun attach(activity: Activity, nav: NavController, intent: Intent) {
        val section = intent.getStringExtra("medialab.section")
        if (section == "sources") nav.navigate(R.id.providers)
        if (section == "vod-settings") nav.navigate(R.id.settings)
        // General settings have one owner, reachable from either library.
        nav.addOnDestinationChangedListener { _, destination, _ ->
            if (destination.id == R.id.settings && section != "vod-settings") {
                nav.popBackStack()
                leave(activity, "/settings")
            }
        }
    }
}
