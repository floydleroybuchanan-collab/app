package com.streamflixreborn.streamflix.vod

import android.content.Intent
import android.net.Uri
import android.text.InputType
import android.view.WindowManager
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.lifecycleScope
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.SwitchPreferenceCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object DebridSettings {
    fun bind(fragment: PreferenceFragmentCompat) {
        fragment.findPreference<Preference>("vod_playback_licenses")?.setOnPreferenceClickListener {
            val context = fragment.requireContext()
            val files = listOf("nova", "host-extractors").flatMap { folder ->
                context.assets.list("licenses/" + folder).orEmpty().map { folder + "/" + it }
            }.sorted()
            com.streamflixreborn.streamflix.charm.CharmDialogBuilder(context).setTitle("Playback licenses and source").setItems(files.toTypedArray()) { _, index ->
                val text = context.assets.open("licenses/" + files[index]).bufferedReader().use { it.readText() }
                com.streamflixreborn.streamflix.charm.CharmDialogBuilder(context).setTitle(files[index]).setMessage(text).setPositiveButton("Close", null).show()
            }.setNegativeButton("Close",null).show()
            true
        }
        fragment.findPreference<SwitchPreferenceCompat>("vod_choose_first")?.apply {
            isPersistent = false
            isChecked = VodPreferences.chooseFirst
            setOnPreferenceChangeListener { _, value -> VodPreferences.chooseFirst = value as Boolean; true }
        }
        fragment.findPreference<SwitchPreferenceCompat>("vod_debrid_search")?.apply {
            isPersistent = false
            isChecked = VodPreferences.debridSearch
            setOnPreferenceChangeListener { _, value -> VodPreferences.debridSearch = value as Boolean; true }
        }
        fragment.findPreference<SwitchPreferenceCompat>("vod_cloud_search")?.apply {
            isPersistent = false; isChecked = VodPreferences.cloudSearch
            setOnPreferenceChangeListener { _, value -> VodPreferences.cloudSearch = value as Boolean; true }
        }
        fragment.findPreference<SwitchPreferenceCompat>("vod_cached_only")?.apply {
            isPersistent = false; isChecked = VodPreferences.cachedOnly
            setOnPreferenceChangeListener { _, value -> VodPreferences.cachedOnly = value as Boolean; true }
        }
        fragment.findPreference<SwitchPreferenceCompat>("vod_cached_consent")?.apply {
            isPersistent = false; isEnabled = RealDebrid.connected; isChecked = RealDebrid.cachedSearchConsent
            setOnPreferenceChangeListener { _, value ->
                fun save(enabled: Boolean) {
                    fragment.lifecycleScope.launch {
                        try { withContext(Dispatchers.IO) { RealDebrid.setCachedSearchConsent(enabled) } }
                        catch (e: CancellationException) { throw e }
                        catch (_: Exception) { Toast.makeText(fragment.context, "Could not save the cached-search connection. Try again.", Toast.LENGTH_LONG).show() }
                        if (fragment.isAdded) bind(fragment)
                    }
                }
                if (value == false) save(false)
                else com.streamflixreborn.streamflix.charm.CharmDialogBuilder(fragment.requireContext())
                    .setTitle("Enable Torrentio cached search?")
                    .setMessage("Torrentio is an independent service. Enabling this sends it your Real-Debrid access token and requested movie or episode IDs over HTTPS. The token grants access to your RD account. Charming stores it encrypted and does not log it. Torrentio reports may be stale; availability is checked again when you play. Your personal cloud search remains a separate setting. You can disable this connection here and revoke the RD connection on Real-Debrid.")
                    .setPositiveButton("Enable cached search") { _, _ -> save(true) }
                    .setNegativeButton("Cancel", null).show()
                false
            }
        }
        fragment.findPreference<androidx.preference.ListPreference>("vod_engine")?.apply {
            isPersistent = false
            value = VodPreferences.engine
            summary = if (value == "nova") "Nova (embedded)" else "Media3"
            setOnPreferenceChangeListener { _, value -> VodPreferences.engine = value as String; bind(fragment); true }
        }
        fragment.findPreference<Preference>("vod_rd_account")?.apply {
            summary = if (RealDebrid.connected) RealDebrid.accountLabel else "Connect your own Real-Debrid account"
            setOnPreferenceClickListener { chooseConnection(fragment); true }
        }
        fragment.findPreference<Preference>("vod_rd_refresh")?.apply {
            isEnabled = RealDebrid.connected
            setOnPreferenceClickListener {
                isEnabled = false
                fragment.lifecycleScope.launch {
                    try { withContext(Dispatchers.IO) { RealDebrid.refreshAccount() } }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { Toast.makeText(fragment.context, e.message ?: "Account unavailable", Toast.LENGTH_LONG).show() }
                    finally { if (fragment.isAdded) bind(fragment) }
                }; true
            }
        }
        fragment.findPreference<Preference>("vod_rd_label")?.apply {
            isEnabled = RealDebrid.connected
            summary = RealDebrid.deviceLabel
            setOnPreferenceClickListener {
                val input = EditText(fragment.requireContext()).apply { setText(RealDebrid.deviceLabel); maxLines = 1 }
                com.streamflixreborn.streamflix.charm.CharmDialogBuilder(fragment.requireContext()).setTitle("Connection label")
                    .setMessage("This label is saved in Charming MediaLab. Manage the website connection name on Real-Debrid.")
                    .setView(input).setPositiveButton("Save") { _, _ ->
                        fragment.lifecycleScope.launch {
                            try { withContext(Dispatchers.IO) { RealDebrid.setLabel(input.text.toString()) } }
                            catch (e: CancellationException) { throw e }
                            catch (_: Exception) { Toast.makeText(fragment.context, "Could not save the connection label.", Toast.LENGTH_LONG).show() }
                            if (fragment.isAdded) bind(fragment)
                        }
                    }.setNegativeButton("Cancel", null).show(); true
            }
        }
        fragment.findPreference<Preference>("vod_rd_manage")?.setOnPreferenceClickListener {
            runCatching { fragment.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://real-debrid.com/devices"))) }
                .onFailure { Toast.makeText(fragment.context, "Open real-debrid.com/devices on your phone.", Toast.LENGTH_LONG).show() }
            true
        }
        fragment.findPreference<Preference>("vod_rd_disconnect")?.apply {
            isEnabled = RealDebrid.connected
            setOnPreferenceClickListener {
                fragment.lifecycleScope.launch {
                    withContext(Dispatchers.IO) { RealDebrid.disconnect() }
                    bind(fragment)
                }; true
            }
        }
    }
    private fun chooseConnection(fragment: PreferenceFragmentCompat) {
        com.streamflixreborn.streamflix.charm.CharmDialogBuilder(fragment.requireContext()).setTitle("Connect Real-Debrid")
            .setItems(arrayOf("Sign in on this device", "Link with a code", "Advanced: enter API token")) { _, which ->
                val choice = android.widget.CheckBox(fragment.requireContext()).apply {
                    text = "Enable Torrentio cached search"; isChecked = true
                    setPadding(24, 16, 24, 16)
                }
                com.streamflixreborn.streamflix.charm.CharmDialogBuilder(fragment.requireContext())
                    .setTitle("Save Real-Debrid on this device")
                    .setMessage("Your connection will be encrypted and remembered after you close the app. Torrentio is selected by default. It is an independent service that receives your Real-Debrid access token and title searches over HTTPS; the token grants access to your RD account. Cached-only is on by default. You can uncheck Torrentio or change these settings later.")
                    .setView(choice).setPositiveButton("Continue") { _, _ ->
                        if (which == 2) connect(fragment, choice.isChecked)
                        else DebridLinkDialog.show(fragment, which == 0, choice.isChecked)
                    }.setNegativeButton("Back", null).show()
            }.setNegativeButton("Cancel", null).show()
    }
    private fun connect(fragment: PreferenceFragmentCompat, cachedSearch: Boolean = false) {
        val context = fragment.requireContext()
        val input = EditText(context).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "Personal API token"
            isSaveEnabled = false
            if (android.os.Build.VERSION.SDK_INT >= 26) importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
        val dialog = com.streamflixreborn.streamflix.charm.CharmDialogBuilder(context).setTitle("Connect Real-Debrid")
            .setMessage("Open your Real-Debrid account, copy your personal API token and paste it here. It stays encrypted on this device.")
            .setView(input).setPositiveButton("Connect", null)
            .setNeutralButton("Get my token", null).setNegativeButton("Cancel", null).create()
        var connectJob: kotlinx.coroutines.Job? = null
        dialog.setOnDismissListener { connectJob?.cancel(); input.text.clear() }
        dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        dialog.setOnShowListener {
            dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                runCatching { fragment.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://real-debrid.com/apitoken"))) }
                    .onFailure { Toast.makeText(context, "Open real-debrid.com/apitoken on your browser.", Toast.LENGTH_LONG).show() }
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val token = input.text.toString().trim()
                input.text.clear()
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                connectJob = fragment.lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) { RealDebrid.connectToken(token, cachedSearch) }
                        if (fragment.isAdded) { bind(fragment); dialog.dismiss() }
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) {
                        if (fragment.isAdded) Toast.makeText(context, e.message ?: "Connection failed.", Toast.LENGTH_LONG).show()
                    } finally { dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true }
                }
            }
        }
        dialog.show()
    }
}
