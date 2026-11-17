package com.streamflixreborn.streamflix.vod

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import com.streamflixreborn.streamflix.utils.UserPreferences

/**
 * The VOD player's Aspect ratio button used to just cycle to the next mode with no way to see or
 * choose the others. This shows every mode by name instead, with the current one marked, so picking
 * one sets it directly. Built the same way as [SourcePicker] for a consistent look.
 *
 * `allowed` is the modes this player can actually show something different for: the scale transform
 * the three "stretch" modes need is reset by the TV fragment's own quality-switch-safe geometry code,
 * so the TV caller passes only Fit/Fill/Zoom here rather than offering choices that would silently do
 * nothing. The mobile fragment applies all six, so it passes the full list.
 */
object AspectPicker {
    fun show(
        fragment: Fragment,
        current: UserPreferences.PlayerResize,
        allowed: List<UserPreferences.PlayerResize>,
        onPick: (UserPreferences.PlayerResize) -> Unit,
    ) {
        if (!fragment.isAdded || fragment.isRemoving) return
        val context = fragment.requireContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        fun surface(fill: Int, stroke: Int) = GradientDrawable().apply {
            setColor(fill); cornerRadius = dp(12).toFloat(); setStroke(dp(1), stroke)
        }
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(8))
        }
        root.addView(TextView(context).apply {
            text = "Aspect ratio"; textSize = 24f; setTextColor(Color.WHITE)
            setPadding(0, 0, 0, dp(4))
        })
        root.addView(TextView(context).apply {
            text = "Choosing one also makes it the default for the next video."
            textSize = 14f; setTextColor(0xFFD0BCD9.toInt()); setPadding(0, 0, 0, dp(12))
        })
        val list = ListView(context).apply {
            divider = android.graphics.drawable.ColorDrawable(Color.TRANSPARENT); dividerHeight = dp(8)
            selector = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_pressed), surface(0xCCB446FF.toInt(), Color.WHITE))
                addState(intArrayOf(android.R.attr.state_focused), surface(0xCCB446FF.toInt(), Color.WHITE))
                addState(intArrayOf(), surface(0x1FFFFFFF, 0x59E2BEFF))
            }
            setDrawSelectorOnTop(false)
        }
        root.addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val rows = allowed
        val adapter = object : BaseAdapter() {
            override fun getCount() = rows.size
            override fun getItem(position: Int) = rows[position]
            override fun getItemId(position: Int) = rows[position].ordinal.toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val mode = rows[position]
                val item = convertView as? LinearLayout ?: LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(16), dp(14), dp(16), dp(14))
                    isFocusable = false
                    addView(TextView(context).apply { textSize = 18f; isFocusable = false; setTextColor(Color.WHITE) })
                    addView(TextView(context).apply {
                        textSize = 13f; isFocusable = false; setTextColor(0xFFD5C7E0.toInt()); setPadding(0, dp(4), 0, 0)
                    })
                }
                (item.getChildAt(0) as TextView).text =
                    (if (mode == current) "◉  " else "○  ") + context.getString(mode.stringRes) +
                        (if (mode == current) "  ·  current & default" else "")
                (item.getChildAt(1) as TextView).text = helpFor(mode)
                return item
            }
        }
        list.adapter = adapter
        val dialog = AlertDialog.Builder(context).setView(root).setNegativeButton("Close", null).create()
        list.setOnItemClickListener { _, _, index, _ ->
            dialog.dismiss()
            onPick(rows[index])
        }
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawable(surface(0xE61A0A3C.toInt(), 0xFFC64DFF.toInt()))
            setDimAmount(.18f)
        }
        list.requestFocus()
        val active = rows.indexOf(current)
        if (active >= 0) list.setSelection(active)
    }

    private fun helpFor(mode: UserPreferences.PlayerResize): String = when (mode) {
        UserPreferences.PlayerResize.Fit -> "Shows the whole picture at the source's own aspect ratio."
        UserPreferences.PlayerResize.Fill -> "Stretches the picture to fill the screen; may distort it."
        UserPreferences.PlayerResize.Zoom -> "Crops the picture's edges to fill the screen without distorting it."
        UserPreferences.PlayerResize.Stretch43 -> "Stretches a 4:3 picture to fill a widescreen display."
        UserPreferences.PlayerResize.StretchVertical -> "Stretches the picture taller, to fill more of the screen."
        UserPreferences.PlayerResize.SuperZoom -> "Zooms in further than Zoom, cropping more of the edges."
    }
}
