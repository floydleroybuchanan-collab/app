package com.streamflixreborn.streamflix.charm

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.preference.Preference
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.utils.QrUtils
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

/** VOD and IPTV resolve the same panel-managed, approval-required community destination. */
object CharmCommunityAccess {
    private val client = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build()

    fun open(fragment: Fragment, preference: Preference) {
        if (!preference.isEnabled) return
        preference.isEnabled = false
        fragment.viewLifecycleOwner.lifecycleScope.launch {
            try {
                val endpoint = fragment.getString(R.string.charm_account_api_url) + "/auth/community"
                val url = withContext(Dispatchers.IO) {
                    client.newCall(Request.Builder().url(endpoint).build()).execute().use { response ->
                        check(response.isSuccessful)
                        val body = JSONObject(response.body?.string().orEmpty())
                        check(body.optBoolean("success"))
                        val destination = body.optString("community_url", "")
                        val parsed = URI(destination)
                        check(parsed.scheme == "https" && parsed.host in setOf("t.me", "telegram.me") &&
                            parsed.userInfo == null && parsed.port == -1 && !parsed.path.isNullOrBlank())
                        destination
                    }
                }
                val context = fragment.requireContext()
                val density = context.resources.displayMetrics.density
                fun dp(value: Int) = (value * density).toInt()
                val content = LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_HORIZONTAL
                    setPadding(dp(24), dp(12), dp(24), dp(12))
                    addView(TextView(context).apply {
                        setText(R.string.charm_community_instructions)
                        setTextColor(0xFFECEBF2.toInt())
                        textSize = 16f
                        setPadding(0, 0, 0, dp(16))
                    })
                    addView(ImageView(context).apply {
                        setImageBitmap(QrUtils.generate(url, 360))
                        contentDescription = context.getString(R.string.charm_community_title)
                        setBackgroundColor(android.graphics.Color.WHITE)
                        setPadding(dp(8), dp(8), dp(8), dp(8))
                        scaleType = ImageView.ScaleType.FIT_CENTER
                    }, LinearLayout.LayoutParams(dp(180), dp(180)))
                }
                CharmDialogBuilder(context)
                    .setTitle(R.string.charm_community_title)
                    .setView(content)
                    .setPositiveButton(R.string.charm_community_open) { _, _ ->
                        try { fragment.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                        catch (_: ActivityNotFoundException) {
                            Toast.makeText(context, R.string.charm_community_phone, Toast.LENGTH_LONG).show()
                        }
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (fragment.isAdded) Toast.makeText(fragment.requireContext(), R.string.charm_community_error, Toast.LENGTH_LONG).show()
            } finally { preference.isEnabled = true }
        }
    }
}
