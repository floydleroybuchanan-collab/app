package com.streamflixreborn.streamflix.fragments.settings

import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.doOnLayout
import android.widget.FrameLayout
import androidx.preference.Preference
import androidx.preference.PreferenceCategory
import androidx.preference.PreferenceGroup
import androidx.preference.PreferenceGroupAdapter
import androidx.preference.PreferenceScreen
import androidx.preference.SeekBarPreference
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.charm.CharmDesign
import com.streamflixreborn.streamflix.charm.CharmVodPageLayout

/** The native preference model still owns values, actions and dynamic visibility. */
internal class CharmSettingsLayout(private val list: RecyclerView, private val open: (String?, String?) -> Unit) {
    private val context = list.context
    private fun dp(n: Int) = (n * context.resources.displayMetrics.density).toInt()
    private val content = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    private val title = TextView(context).apply { textSize = 28f; setTextColor(0xFFECEBF2.toInt()); setPadding(0,0,0,dp(8)) }
    private val subtitle = TextView(context).apply { textSize = 13f; setTextColor(0xFFC1B9D1.toInt()); setPadding(0,0,0,dp(22)) }
    private val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
    val root = FrameLayout(context).apply {
        setBackgroundColor(Color.TRANSPARENT); clipToPadding = true
        addView(content, ViewGroup.LayoutParams(-1,-1))
    }
    private val pages = linkedMapOf(
        "screen_connected_accounts" to "Accounts", "screen_vod_sources" to "Content & sources", "screen_content" to "Content & safety",
        "screen_playback" to "Playback", "screen_appearance" to "Appearance", "screen_network" to "Connection & services",
        "screen_provider" to "Provider options", "screen_cloud_sync" to "Account & sync", "screen_backup" to "Backup & restore"
    )
    init {
        (list.parent as? ViewGroup)?.removeView(list)
        list.setBackgroundColor(Color.TRANSPARENT); list.isNestedScrollingEnabled = false
        list.setPadding(0,0,0,0); list.itemAnimator = null
        content.addView(title); content.addView(subtitle)
        content.addView(row, LinearLayout.LayoutParams(-1, 0, 1f))
        row.addView(list, LinearLayout.LayoutParams(0,-1,1f))
        val fit = {
            root.setPadding(0, 0, 0, 0)
            content.setPadding(dp(16), dp(8), dp(16), dp(24))
            val columns = ((root.width - dp(32)) / dp(250)).coerceIn(1, 4)
            (list.layoutManager as? GridLayoutManager)?.spanCount = columns
        }
        root.doOnLayout { fit() }
        root.addOnLayoutChangeListener { _, l, t, r, b, oldL, oldT, oldR, oldB ->
            if (r - l != oldR - oldL || b - t != oldB - oldT) fit()
        }
        list.addItemDecoration(object : RecyclerView.ItemDecoration() {
            override fun getItemOffsets(outRect: android.graphics.Rect, view: View, parent: RecyclerView, state: RecyclerView.State) { outRect.set(dp(4),dp(4),dp(4),dp(4)) }
        })
    }
    fun show(key: String?, name: String?) {
        val overview = key == null
        title.text = if (overview) "Your VOD. Your way." else pages[key] ?: name ?: "Settings"
        subtitle.text = if (overview) "Personalize playback, manage your account and make yourself at home." else "Settings  /  ${title.text}"
        val columns = ((root.width.takeIf { it > 0 } ?: context.resources.displayMetrics.widthPixels) / dp(250)).coerceIn(1, 4)
        list.layoutManager = GridLayoutManager(context, columns).apply {
            spanSizeLookup = object : GridLayoutManager.SpanSizeLookup() {
                override fun getSpanSize(position: Int): Int = if ((list.adapter as? PreferenceGroupAdapter)?.getItem(position) is PreferenceCategory) (list.layoutManager as? GridLayoutManager)?.spanCount ?: 1 else 1
            }
        }
        list.scrollToPosition(0)
        CharmDesign.styleTree(content)
    }
    companion object {
        fun prepare(group: PreferenceGroup) {
            for (i in 0 until group.preferenceCount) {
                val preference = group.getPreference(i)
                preference.isIconSpaceReserved = false
                val icon = when(preference.key) {
                    "screen_connected_accounts" -> R.drawable.charm_settings_account
                    "screen_vod_sources" -> R.drawable.charm_settings_sources
                    "screen_content" -> R.drawable.charm_settings_safety
                    "screen_playback" -> R.drawable.charm_settings_playback
                    "screen_appearance" -> R.drawable.charm_settings_appearance
                    "screen_network" -> R.drawable.charm_settings_connection
                    "screen_provider" -> R.drawable.charm_settings_provider
                    "screen_cloud_sync" -> R.drawable.charm_settings_account
                    "screen_backup" -> R.drawable.charm_settings_backup
                    else -> null
                }
                icon?.let { preference.setIcon(it);preference.widgetLayoutResource=0 }
                if (preference is PreferenceCategory) preference.layoutResource = R.layout.charm_preference_category
                else preference.layoutResource = if(preference is SeekBarPreference) R.layout.charm_preference_slider else R.layout.charm_preference_card
                if (preference is PreferenceGroup) prepare(preference)
            }
        }
    }
}
