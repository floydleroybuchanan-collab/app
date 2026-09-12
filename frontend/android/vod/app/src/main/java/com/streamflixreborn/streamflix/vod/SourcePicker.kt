package com.streamflixreborn.streamflix.vod

import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
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
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.streamflixreborn.streamflix.fragments.player.PlayerViewModel
import com.streamflixreborn.streamflix.models.Video
import kotlinx.coroutines.launch

/** One selection starts resolution. The list follows the actual app window, including split screen. */
object SourcePicker {
    fun show(fragment: Fragment, model: PlayerViewModel, currentId: String?, selected: (Video.Server) -> Unit) {
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
        val title = TextView(context).apply {
            text = "Sources"; textSize = 24f; setTextColor(Color.WHITE)
            setPadding(0, 0, 0, dp(8)); isAccessibilityHeadingCompat()
        }
        val status = TextView(context).apply {
            textSize = 14f; setTextColor(0xFFD0BCD9.toInt()); setPadding(0, 0, 0, dp(12))
        }
        val list = ListView(context).apply {
            divider = ColorDrawable(Color.TRANSPARENT); dividerHeight = dp(8)
            selector = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_pressed), surface(0xAA69308C.toInt(), 0xFFE3B1FF.toInt()))
                addState(intArrayOf(android.R.attr.state_focused), surface(0x9969308C.toInt(), 0xFFE3B1FF.toInt()))
                addState(intArrayOf(android.R.attr.state_selected), surface(0x9969308C.toInt(), 0xFFE3B1FF.toInt()))
                addState(intArrayOf(), ColorDrawable(Color.TRANSPARENT))
            }
            setDrawSelectorOnTop(false)
        }
        val footer = TextView(context).apply {
            text = "Select a source to play. A selected torrent may need preparation in your Real-Debrid account."
            textSize = 13f; setTextColor(0xFFD0BCD9.toInt()); setPadding(0, dp(12), 0, 0)
        }
        root.addView(title)
        root.addView(status)
        root.addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(footer)
        var rows = model.sources.value
        val adapter = object : BaseAdapter() {
            override fun getCount() = rows.size
            override fun getItem(position: Int) = rows[position]
            override fun getItemId(position: Int) = rows[position].id.hashCode().toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val row = rows[position]
                val item = convertView as? LinearLayout ?: LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(16), dp(14), dp(16), dp(14))
                    // Children must not steal D-pad focus from the ListView selection.
                    isFocusable = false
                    addView(TextView(context).apply { textSize = 18f; isFocusable = false })
                    addView(TextView(context).apply {
                        textSize = 14f; isFocusable = false
                        setTextColor(0xFFD5C7E0.toInt()); setPadding(0, dp(6), 0, 0)
                    })
                }
                val details = row.details
                (item.getChildAt(0) as TextView).apply {
                    text = (if (row.id == currentId) "✓ " else "") +
                        (if (details?.kind == SourceDetails.Kind.REAL_DEBRID) "🧲 " else "") + row.name
                    setTextColor(if (details?.kind == SourceDetails.Kind.REAL_DEBRID) 0xFFFF989E.toInt() else Color.WHITE)
                    // No line truncation: long release names wrap and remain readable.
                    maxLines = Int.MAX_VALUE
                }
                (item.getChildAt(1) as TextView).text = listOfNotNull(
                    details?.badges?.takeIf { it.isNotBlank() }, DeviceCompatibility.badge(details),
                    if (row.id == currentId) "Currently playing" else null).joinToString("  ·  ")
                return item
            }
        }
        list.adapter = adapter
        val dialog = AlertDialog.Builder(context).setView(root).setNegativeButton("Close", null).create()
        list.setOnItemClickListener { _, _, index, _ ->
            val server = rows.getOrNull(index) ?: return@setOnItemClickListener
            dialog.dismiss()
            selected(server)
        }
        val job = fragment.lifecycleScope.launch {
            model.sources.collect {
                val focusedId = rows.getOrNull(list.selectedItemPosition)?.id
                rows = it
                adapter.notifyDataSetChanged()
                val restored = rows.indexOfFirst { row -> row.id == focusedId }
                if (restored >= 0) list.setSelection(restored)
                if (it.isEmpty()) status.text = "Searching for sources…"
            }
        }
        val statusJob = fragment.lifecycleScope.launch {
            model.sourceStatus.collect { status.text = it.ifBlank { "Choose a stream • ${rows.size} sources" } }
        }
        val activityDecor = fragment.requireActivity().window.decorView
        val visible = Rect()
        fun fitWindow() {
            activityDecor.getWindowVisibleDisplayFrame(visible)
            val width = (visible.width().takeIf { it > 0 } ?: activityDecor.width)
            val height = (visible.height().takeIf { it > 0 } ?: activityDecor.height)
            if (width <= 0 || height <= 0) return
            val targetWidth = (width * .94f).toInt()
            val targetHeight = (height * .92f).toInt()
            dialog.window?.let { window ->
                if (window.attributes.width != targetWidth || window.attributes.height != targetHeight)
                    window.setLayout(targetWidth, targetHeight)
            }
        }
        val layoutListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> fitWindow() }
        val observer = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) { dialog.dismiss() }
        }
        fragment.lifecycle.addObserver(observer)
        dialog.setOnDismissListener {
            job.cancel(); statusJob.cancel()
            fragment.lifecycle.removeObserver(observer)
            activityDecor.removeOnLayoutChangeListener(layoutListener)
        }
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawable(surface(0xDC140C20.toInt(), 0xAAAD70CE.toInt()))
            setDimAmount(.18f)
        }
        fitWindow()
        activityDecor.addOnLayoutChangeListener(layoutListener)
        list.requestFocus()
        val active = rows.indexOfFirst { it.id == currentId }
        if (active >= 0) list.setSelection(active)
        model.discoverDebrid()
    }
    private fun TextView.isAccessibilityHeadingCompat() {
        androidx.core.view.ViewCompat.setAccessibilityHeading(this, true)
    }
}
