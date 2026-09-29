package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.Fragment

/** Shared settings chrome for both remote and touch navigation. */
object SettingsChrome {
    fun wrap(fragment: Fragment, content: View): View {
        val context = fragment.requireContext()
        fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
        fun buttonBackground(): StateListDrawable {
            fun shape(fill: String, stroke: String) = GradientDrawable().apply {
                setColor(Color.parseColor(fill)); cornerRadius = dp(8).toFloat(); setStroke(dp(2), Color.parseColor(stroke))
            }
            return StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), shape("#3B1768", "#B76CFF"))
                addState(intArrayOf(android.R.attr.state_pressed), shape("#3B1768", "#B76CFF"))
                addState(intArrayOf(), shape("#151427", "#25233A"))
            }
        }
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#070711"))
            setPadding(dp(12), dp(8), dp(12), 0)
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                fun button(label: String, action: () -> Unit) = Button(context).apply {
                    text = label; textSize = 14f; isAllCaps = false; setTextColor(Color.WHITE)
                    minHeight = dp(48); background = buttonBackground(); setOnClickListener { action() }
                    layoutParams = LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(dp(3), 0, dp(3), 0) }
                }
                addView(button("Back") { (fragment.requireActivity() as androidx.activity.ComponentActivity).onBackPressedDispatcher.onBackPressed() })
                addView(button("All Settings") { MediaLabSession.leave(fragment.requireActivity(), "/settings") })
            })
            addView(TextView(context).apply {
                text = if (fragment.requireActivity().intent.getStringExtra("medialab.section") == "accounts") "Accounts · Real-Debrid" else "Content & Sources"
                textSize = 20f; setTextColor(Color.WHITE); setPadding(dp(8), dp(14), dp(8), dp(8))
            })
            addView(content, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
    }
}
