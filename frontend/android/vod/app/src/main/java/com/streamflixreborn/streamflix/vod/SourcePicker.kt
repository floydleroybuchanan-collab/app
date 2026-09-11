package com.streamflixreborn.streamflix.vod

import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.streamflixreborn.streamflix.fragments.player.PlayerViewModel
import com.streamflixreborn.streamflix.models.Video
import kotlinx.coroutines.launch

object SourcePicker {
    fun show(fragment: Fragment, model: PlayerViewModel, currentId: String?, selected: (Video.Server) -> Unit) {
        if (!fragment.isAdded || fragment.isRemoving) return
        val context = fragment.requireContext()
        var rows = model.sources.value
        val adapter = object : BaseAdapter() {
            override fun getCount() = rows.size
            override fun getItem(position: Int) = rows[position]
            override fun getItemId(position: Int) = position.toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val row = rows[position]
                return (convertView as? TextView ?: TextView(context)).apply {
                    val d = row.details
                    val torrent = d?.kind == SourceDetails.Kind.REAL_DEBRID
                    text = (if (row.id == currentId) "\u2713 " else "") + (if (torrent) "\uD83E\uDDF2 " else "") +
                        row.name + "\n" + listOfNotNull(d?.badges?.takeIf { it.isNotBlank() },
                            DeviceCompatibility.badge(d)).joinToString(" · ")
                    setTextColor(if (torrent) Color.rgb(255, 110, 110) else Color.WHITE)
                    textSize = 16f
                    setPadding(24, 20, 24, 20)
                    maxLines = 6
                    isFocusable = false
                }
            }
        }
        val dialog = AlertDialog.Builder(context).setTitle("Sources")
            .setAdapter(adapter) { _, index ->
                val server = rows.getOrNull(index) ?: return@setAdapter
                if (server.details?.kind == SourceDetails.Kind.REAL_DEBRID && server.details.cloudTorrentId == null) {
                    AlertDialog.Builder(context).setTitle("Prepare with Real-Debrid?")
                        .setMessage("This source has not been verified as ready. Selecting it adds this torrent to your Real-Debrid cloud. It may need time to download.")
                        .setPositiveButton("Prepare and play") { _, _ -> selected(server) }
                        .setNegativeButton("Cancel") { _, _ -> show(fragment, model, currentId, selected) }.show()
                } else selected(server)
            }.setNegativeButton("Close", null).create()
        val job = fragment.lifecycleScope.launch {
            model.sources.collect {
                rows = it
                adapter.notifyDataSetChanged()
            }
        }
        val statusJob = fragment.lifecycleScope.launch {
            model.sourceStatus.collect { dialog.setTitle(if (it.isBlank()) "Sources" else "Sources — $it") }
        }
        val lifecycle = fragment.lifecycle
        val observer = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) { dialog.dismiss() }
        }
        lifecycle.addObserver(observer)
        dialog.setOnDismissListener { job.cancel(); statusJob.cancel(); lifecycle.removeObserver(observer) }
        dialog.show()
        dialog.listView.requestFocus()
        model.discoverDebrid()
    }
}
