package com.streamflixreborn.streamflix.charm

import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat

/** The same escape controls are present on every nested native Settings screen. */
object CharmSettingsNavigation {
    fun attach(fragment: PreferenceFragmentCompat) {
        val screen = fragment.preferenceScreen ?: return
        val activity = fragment.requireActivity()
        if (!CharmHostSession.embedded(activity)) return
        fun action(key: String, title: String, order: Int, run: () -> Unit) {
            if (screen.findPreference<Preference>(key) != null) return
            screen.addPreference(Preference(fragment.requireContext()).apply {
                this.key=key; this.title=title; this.order=order; isIconSpaceReserved=false
                setOnPreferenceClickListener { run(); true }
            })
        }
        action("charm_back", "Back", -100) { activity.onBackPressedDispatcher.onBackPressed() }
        action("charm_all_settings", "All Settings", -99) { CharmHostSession.leave(activity, "/settings") }
    }
}
