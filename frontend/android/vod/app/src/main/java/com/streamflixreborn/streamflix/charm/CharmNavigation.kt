package com.streamflixreborn.streamflix.charm

import android.app.Dialog
import android.content.Context
import android.content.ContextWrapper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.DialogFragment
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentManager
import androidx.navigation.fragment.NavHostFragment
import com.streamflixreborn.streamflix.R

/** Visible escape routes shared by VOD destinations and app-owned modal windows. */
object CharmNavigation {
    private val dialogs = java.util.WeakHashMap<Dialog, Boolean>()
    private fun activity(context: Context): FragmentActivity? = when (context) {
        is FragmentActivity -> context
        is ContextWrapper -> if (context.baseContext !== context) activity(context.baseContext) else null
        else -> null
    }
    private fun nav(context: Context) = (activity(context)?.supportFragmentManager
        ?.findFragmentById(R.id.nav_main_fragment) as? NavHostFragment)?.navController
    fun home(context: Context) {
        val activity = activity(context) ?: return
        dialogs.keys.toList().filter { it.isShowing && activity(it.context) === activity }.forEach { it.dismiss() }
        fun dismiss(manager: FragmentManager) {
            manager.fragments.toList().forEach { fragment ->
                dismiss(fragment.childFragmentManager)
                if (fragment is DialogFragment) fragment.dismissAllowingStateLoss()
            }
        }
        dismiss(activity.supportFragmentManager)
        val nav = nav(context)
        if (nav == null) return
        if (nav.currentDestination?.id != R.id.home && !nav.popBackStack(R.id.home, false)) {
            nav.navigate(R.id.home, null, androidx.navigation.NavOptions.Builder()
                .setPopUpTo(nav.graph.id, false).setLaunchSingleTop(true).build())
        }
    }
    fun back(context: Context) { activity(context)?.onBackPressedDispatcher?.onBackPressed() }
    fun controls(context: Context, back: () -> Unit = { back(context) }): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        fun action(label: String, run: () -> Unit) = Button(context).apply {
            text = label; textSize = 12f; minWidth = 0; minimumWidth = 0; isAllCaps = false; isFocusable = true; id = View.generateViewId()
            setOnClickListener { run() }
            addView(this, LinearLayout.LayoutParams(-2, -2))
        }
        action("Back", back)
        action("VOD Home") { home(context) }
        CharmDesign.styleTree(this)
    }
    fun install(activity: FragmentActivity, root: View) {
        val parent = root as? ConstraintLayout ?: return
        val nav = nav(activity) ?: return
        val isTv = parent.findViewById<View>(R.id.vod_brand_header) != null
        val row = controls(activity).apply { id = View.generateViewId(); elevation = 8 * resources.displayMetrics.density }
        val stop = Button(activity).apply {
            text = "Stop and exit"; isAllCaps = false; isFocusable = true
            setOnClickListener { if (!nav.popBackStack()) home(activity) }
        }
        row.addView(stop)
        val dp = activity.resources.displayMetrics.density
        parent.addView(row, ConstraintLayout.LayoutParams(-2, -2).apply {
            topToTop = 0; topMargin = (4 * dp).toInt()
            if (isTv) {
                endToStart = R.id.vod_search; marginEnd = (8 * dp).toInt()
            } else {
                startToStart = 0; marginStart = (8 * dp).toInt()
            }
        })
        CharmDesign.styleTree(row)
        if (!isTv) {
            val host = parent.findViewById<View>(R.id.nav_main_fragment)
            (host.layoutParams as ConstraintLayout.LayoutParams).apply {
                topToTop = ConstraintLayout.LayoutParams.UNSET; topToBottom = row.id
                host.layoutParams = this
            }
        }
        nav.addOnDestinationChangedListener { _, destination, _ ->
            stop.visibility = if (destination.id == R.id.player) View.VISIBLE else View.GONE
            (row.layoutParams as ConstraintLayout.LayoutParams).apply {
                if (isTv) {
                    endToStart = if (destination.id == R.id.player) ConstraintLayout.LayoutParams.UNSET else R.id.vod_search
                    endToEnd = if (destination.id == R.id.player) 0 else ConstraintLayout.LayoutParams.UNSET
                    row.layoutParams = this
                }
            }
            row.bringToFront()
        }
    }
    fun dialogTitle(dialog: Dialog, title: CharSequence?): View {
        dialogs[dialog] = true
        return LinearLayout(dialog.context).apply {
            orientation = LinearLayout.VERTICAL
            addView(controls(context) { dialog.cancel() })
            if (!title.isNullOrBlank()) addView(android.widget.TextView(context).apply {
                text = title; textSize = 20f; setPadding(24, 8, 24, 8)
                setTextColor(android.graphics.Color.WHITE)
            })
        }
    }
    fun decorateDialog(dialog: Dialog) {
        if (dialogs.containsKey(dialog)) return
        val content = dialog.findViewById<android.widget.FrameLayout>(android.R.id.content) ?: return
        val body = content.getChildAt(0) ?: return
        dialogs[dialog] = true
        val originalTop = body.paddingTop
        val row = controls(dialog.context) { dialog.cancel() }
        row.setBackgroundColor(0xFF10101E.toInt())
        content.addView(row, android.widget.FrameLayout.LayoutParams(-2, -2, android.view.Gravity.TOP or android.view.Gravity.START))
        row.addOnLayoutChangeListener { _, _, top, _, bottom, _, _, _, _ ->
            val padding = originalTop + bottom - top
            if (body.paddingTop != padding) body.setPadding(body.paddingLeft, padding, body.paddingRight, body.paddingBottom)
        }
    }
}
