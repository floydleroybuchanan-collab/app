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
            val files = context.assets.list("licenses/nova").orEmpty().sorted()
            AlertDialog.Builder(context).setTitle("Playback licenses and source").setItems(files.toTypedArray()) { _, index ->
                val text = context.assets.open("licenses/nova/${files[index]}").bufferedReader().use { it.readText() }
                AlertDialog.Builder(context).setTitle(files[index]).setMessage(text).setPositiveButton("Close", null).show()
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
        fragment.findPreference<androidx.preference.ListPreference>("vod_engine")?.apply {
            isPersistent = false
            value = VodPreferences.engine
            summary = if (value == "nova") "Nova (embedded)" else "Media3"
            setOnPreferenceChangeListener { _, value -> VodPreferences.engine = value as String; bind(fragment); true }
        }
        fragment.findPreference<Preference>("vod_rd_account")?.apply {
            summary = if (RealDebrid.connected) RealDebrid.accountLabel else "Connect your own Real-Debrid account"
            setOnPreferenceClickListener { connect(fragment); true }
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
    private fun connect(fragment: PreferenceFragmentCompat) {
        val context = fragment.requireContext()
        val input = EditText(context).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "Personal API token"
            isSaveEnabled = false
            if (android.os.Build.VERSION.SDK_INT >= 26) importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
        val dialog = AlertDialog.Builder(context).setTitle("Connect Real-Debrid")
            .setMessage("Open your Real-Debrid account, copy your personal API token and paste it here. It stays encrypted on this device.")
            .setView(input).setPositiveButton("Connect", null)
            .setNeutralButton("Get my token", null).setNegativeButton("Cancel", null).create()
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
                fragment.lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) { RealDebrid.connectToken(token) }
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
