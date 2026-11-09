package com.streamflixreborn.streamflix.charm

import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import java.lang.ref.WeakReference

/**
 * Lightweight, activity-scoped TV focus bookmarks.
 *
 * A bookmark contains an item identity and RecyclerView positions, NOT a
 * retained Fragment, adapter, bitmap or View hierarchy. Weak references are
 * only used as a fast path while the previous screen is still mounted.
 */
class VodFocusMemory {
    private data class Row(val recyclerId: Int, val position: Int, val stableId: Long)
    private data class Anchor(
        val direct: WeakReference<View>,
        val leafId: Int,
        val path: List<Row>,
    )

    private val anchors = LinkedHashMap<Int, Anchor>()

    fun remember(destinationId: Int, focused: View, contentRoot: View) {
        if (!isWithin(contentRoot, focused)) return
        val path = mutableListOf<Row>()
        var node: View = focused
        var parent = node.parent
        while (parent is View && node !== contentRoot) {
            if (parent is RecyclerView) {
                val holder = parent.findContainingViewHolder(node)
                if (holder != null && holder.bindingAdapterPosition != RecyclerView.NO_POSITION) {
                    path.add(Row(parent.id, holder.bindingAdapterPosition, holder.itemId))
                }
            }
            node = parent
            parent = node.parent
        }
        path.reverse() // Resolve outer grids before nested horizontal rows.
        anchors.remove(destinationId)
        anchors[destinationId] = Anchor(WeakReference(focused), focused.id, path)
        while (anchors.size > 16) anchors.remove(anchors.keys.first())
    }

    fun hasBookmark(destinationId: Int): Boolean = anchors.containsKey(destinationId)

    fun restore(destinationId: Int, contentRoot: View): Boolean {
        val anchor = anchors[destinationId] ?: return false
        val direct = anchor.direct.get()
        if (direct != null && direct.isAttachedToWindow &&
            direct.visibility == View.VISIBLE && isWithin(contentRoot, direct) &&
            direct.requestFocus()) return true

        var scope: View = contentRoot
        for (row in anchor.path) {
            val recycler = if (scope is RecyclerView && scope.id == row.recyclerId) scope
                else if (row.recyclerId != View.NO_ID) scope.findViewById<RecyclerView>(row.recyclerId)
                else scope as? RecyclerView
            if (recycler == null || recycler.visibility != View.VISIBLE) return false
            val adapter = recycler.adapter ?: return false
            if (adapter.itemCount == 0) return false
            var pos = row.position.coerceIn(0, adapter.itemCount - 1)
            if (adapter.hasStableIds() && row.stableId != RecyclerView.NO_ID &&
                adapter.getItemId(pos) != row.stableId) {
                // Rare dataset changes: bounded lookup, never a large catalog scan
                // during normal directional focus navigation.
                val match = (0 until minOf(adapter.itemCount, 2048))
                    .firstOrNull { adapter.getItemId(it) == row.stableId }
                if (match != null) pos = match
            }
            val holder = recycler.findViewHolderForAdapterPosition(pos)
            if (holder == null) {
                recycler.scrollToPosition(pos)
                return false // The one pending layout observer retries when ready.
            }
            scope = holder.itemView
        }
        val leaf = if (anchor.leafId != View.NO_ID)
            scope.findViewById<View>(anchor.leafId) else null
        if (leaf != null && leaf.visibility == View.VISIBLE && leaf.requestFocus()) return true
        if (scope !== contentRoot && scope.requestFocus()) return true
        if (anchor.path.isEmpty() && anchor.leafId != View.NO_ID) {
            val target = contentRoot.findViewById<View>(anchor.leafId)
            if (target != null && target.visibility == View.VISIBLE && target.requestFocus())
                return true
        }
        return false
    }

    companion object {
        fun isWithin(root: View, child: View?): Boolean {
            var node = child
            while (node != null) {
                if (node === root) return true
                node = node.parent as? View
            }
            return false
        }
    }
}
