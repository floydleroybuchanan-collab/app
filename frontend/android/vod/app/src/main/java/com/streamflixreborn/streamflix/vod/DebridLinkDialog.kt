package com.streamflixreborn.streamflix.vod

import android.app.Dialog
import android.content.DialogInterface
import android.content.Intent
import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.browser.customtabs.CustomTabsIntent
import androidx.fragment.app.DialogFragment
import androidx.lifecycle.*
import androidx.preference.PreferenceFragmentCompat
import com.streamflixreborn.streamflix.utils.QrUtils
import kotlinx.coroutines.launch
import android.net.Uri

class DebridLinkDialog : DialogFragment() {
    private lateinit var model: DebridLinkViewModel
    private var openedBrowser = false
    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        model = ViewModelProvider(this)[DebridLinkViewModel::class.java]
        openedBrowser = savedInstanceState?.getBoolean("opened") ?: false
        val context = requireContext()
        fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(16), dp(24), dp(12))
        }
        val instructions = TextView(context).apply {
            text = "On your phone, scan the QR code or open real-debrid.com/device and enter this code."
            textSize = 16f; gravity = Gravity.CENTER
        }
        val code = TextView(context).apply { textSize = 30f; gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(8)) }
        val qr = ImageView(context).apply { setBackgroundColor(Color.WHITE); contentDescription = "Real-Debrid authorization QR code" }
        val status = TextView(context).apply { textSize = 15f; gravity = Gravity.CENTER; setPadding(0, dp(12), 0, 0) }
        column.addView(instructions); column.addView(code)
        column.addView(qr, LinearLayout.LayoutParams(dp(168), dp(168)))
        column.addView(status)
        val dialog = AlertDialog.Builder(context).setTitle("Link Real-Debrid")
            .setView(ScrollView(context).apply { addView(column) })
            .setPositiveButton("Open sign-in page", null).setNeutralButton("New code", null)
            .setNegativeButton("Cancel") { _, _ -> model.cancel() }.create()
        var displayedCode: String? = null
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                model.state.value.code?.let { open(it.direct ?: it.verification) }
            }
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                openedBrowser = false; model.restart()
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                model.state.collect { value ->
                    status.text = value.message + if (value.code != null) " · " + value.seconds + "s remaining" else ""
                    code.text = value.code?.user.orEmpty()
                    qr.visibility = if (value.code == null) android.view.View.GONE else android.view.View.VISIBLE
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = value.code != null
                    if (value.complete) {
                        (parentFragment as? PreferenceFragmentCompat)?.let(DebridSettings::bind)
                        Toast.makeText(context, "Real-Debrid connected", Toast.LENGTH_SHORT).show()
                        dismiss()
                    } else value.code?.let {
                        if (displayedCode != it.user) {
                            displayedCode = it.user
                            qr.setImageBitmap(QrUtils.generate(it.direct ?: it.verification, 420))
                        }
                        if (arguments?.getBoolean("browser") == true && !openedBrowser) {
                            openedBrowser = true; open(it.direct ?: it.verification)
                        }
                    }
                }
            }
        }
        model.start()
        return dialog
    }
    private fun open(url: String) {
        val safe = DebridOAuth.verificationUrl(url) ?: return
        try { CustomTabsIntent.Builder().build().launchUrl(requireContext(), Uri.parse(safe)) }
        catch (_: Exception) {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(safe))) }
            catch (_: Exception) { Toast.makeText(context, "Use your phone to open real-debrid.com/device.", Toast.LENGTH_LONG).show() }
        }
    }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); outState.putBoolean("opened", openedBrowser) }
    override fun onCancel(dialog: DialogInterface) { model.cancel(); super.onCancel(dialog) }
    override fun onDismiss(dialog: DialogInterface) {
        if (activity?.isChangingConfigurations != true && ::model.isInitialized) model.cancel()
        super.onDismiss(dialog)
    }
    companion object {
        fun show(parent: PreferenceFragmentCompat, browser: Boolean) {
            if (parent.childFragmentManager.isStateSaved || parent.childFragmentManager.findFragmentByTag("rd-link") != null) return
            DebridLinkDialog().apply { arguments = Bundle().apply { putBoolean("browser", browser) } }
                .show(parent.childFragmentManager, "rd-link")
        }
    }
}
