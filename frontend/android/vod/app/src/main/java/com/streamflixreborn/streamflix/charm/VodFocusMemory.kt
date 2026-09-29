package com.streamflixreborn.streamflix.charm

import android.os.Bundle
import android.os.Parcelable
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentManager
import androidx.navigation.fragment.NavHostFragment
import androidx.recyclerview.widget.RecyclerView
import java.util.WeakHashMap

/** A bookmark belongs to a fragment instance, never to a global Home/menu button.
 * Recycler steps use stable item IDs so insertions before the selection are safe.
 */
class VodFocusMemory : FragmentManager.FragmentLifecycleCallbacks() {
    companion object { var userNavigationEpoch = 0L }
    private val bookmarks = WeakHashMap<Fragment, Bundle>()
    private val cleanup = WeakHashMap<Fragment, () -> Unit>()

    private fun path(root: View, target: View): ArrayList<Bundle>? {
        if (target === root) return arrayListOf()
        val parent = target.parent as? ViewGroup ?: return null
        val prefix = path(root, parent) ?: return null
        prefix.add(Bundle().apply {
            putInt("index", parent.indexOfChild(target))
            putInt("id", target.id)
            if (parent is RecyclerView) {
                val holder = parent.getChildViewHolder(target)
                putBoolean("recycler", true)
                putLong("item", holder.itemId)
                putInt("position", holder.bindingAdapterPosition)
            }
        })
        return prefix
    }

    private fun resolve(root: View, steps: ArrayList<Bundle>, scroll: Boolean): View? {
        var current = root
        for (step in steps) {
            val parent = current as? ViewGroup ?: return null
            current = if (step.getBoolean("recycler") && parent is RecyclerView) {
                val adapter = parent.adapter ?: return null
                val id = step.getLong("item", RecyclerView.NO_ID)
                val position = if (adapter.hasStableIds() && id != RecyclerView.NO_ID)
                    (0 until adapter.itemCount).firstOrNull { adapter.getItemId(it) == id }
                        ?: step.getInt("position").coerceAtMost(adapter.itemCount - 1)
                else step.getInt("position").coerceAtMost(adapter.itemCount - 1)
                if (position < 0) return null
                val child = parent.findViewHolderForAdapterPosition(position)?.itemView
                if (child == null && scroll) parent.scrollToPosition(position)
                child ?: return null
            } else {
                val id = step.getInt("id", View.NO_ID)
                (0 until parent.childCount).map { parent.getChildAt(it) }
                    .firstOrNull { id != View.NO_ID && it.id == id }
                    ?: parent.getChildAt(step.getInt("index")) ?: return null
            }
        }
        return current
    }

    private fun capture(fragment: Fragment, root: View) {
        val bookmark = bookmarks.getOrPut(fragment) { Bundle() }
        root.findFocus()?.let { focused ->
            path(root, focused)?.let { bookmark.putParcelableArrayList("focus", it) }
        }
        val lists = arrayListOf<Bundle>()
        fun visit(view: View) {
            if (view is RecyclerView) {
                lists.add(Bundle().apply {
                    putParcelableArrayList("path", path(root, view))
                    putParcelable("state", view.layoutManager?.onSaveInstanceState())
                })
            }
            if (view is ViewGroup) for (i in 0 until view.childCount) visit(view.getChildAt(i))
        }
        visit(root)
        bookmark.putParcelableArrayList("lists", lists)
    }

    override fun onFragmentViewCreated(fm: FragmentManager, f: Fragment, v: View, state: Bundle?) {
        if (f is NavHostFragment) return
        state?.getBundle("charm.focus")?.let { bookmarks[f] = it }
        // Capture before navigation removes the focused child, including dialog/filter origins.
        val listener = ViewTreeObserver.OnGlobalFocusChangeListener { old, _ ->
            if (old != null && path(v, old) != null) {
                val bookmark = bookmarks.getOrPut(f) { Bundle() }
                bookmark.putParcelableArrayList("focus", path(v, old))
            }
        }
        v.viewTreeObserver.addOnGlobalFocusChangeListener(listener)
        cleanup[f] = { if (v.viewTreeObserver.isAlive) v.viewTreeObserver.removeOnGlobalFocusChangeListener(listener) }
    }

    @Suppress("DEPRECATION")
    override fun onFragmentResumed(fm: FragmentManager, f: Fragment) {
        if (f is NavHostFragment) return
        val root = f.view ?: return
        val saved = bookmarks[f]
        val steps = saved?.getParcelableArrayList<Bundle>("focus")
        val lists = saved?.getParcelableArrayList<Bundle>("lists").orEmpty().toMutableList()
        var attempts = 0
        val entryEpoch = userNavigationEpoch
        val listener = object : ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (!f.isResumed || f.view !== root || userNavigationEpoch != entryEpoch || ++attempts > 180) {
                    if (root.viewTreeObserver.isAlive) root.viewTreeObserver.removeOnPreDrawListener(this)
                    return true
                }
                var restoredLayout = false
                lists.removeAll { entry ->
                    val list = resolve(root, entry.getParcelableArrayList<Bundle>("path") ?: arrayListOf(), false) as? RecyclerView
                    if (list != null && (list.adapter?.itemCount ?: 0) > 0) {
                        list.layoutManager?.onRestoreInstanceState(entry.getParcelable<Parcelable>("state"))
                        restoredLayout = true
                        true
                    } else false
                }
                if (restoredLayout) return true
                val target = if (steps != null) resolve(root, steps, true) else
                    root.findViewById<View>(com.streamflixreborn.streamflix.R.id.et_search)
                        ?: root.getFocusables(View.FOCUS_FORWARD).firstOrNull { it !== root && it !is RecyclerView && it.isShown && it.isEnabled }
                if (target != null && target.isShown && target.requestFocus()) {
                    root.viewTreeObserver.removeOnPreDrawListener(this)
                }
                return true
            }
        }
        root.viewTreeObserver.addOnPreDrawListener(listener)
    }

    override fun onFragmentPaused(fm: FragmentManager, f: Fragment) {
        f.view?.let { capture(f, it) }
    }
    override fun onFragmentSaveInstanceState(fm: FragmentManager, f: Fragment, outState: Bundle) {
        f.view?.let { capture(f, it) }
        bookmarks[f]?.let { outState.putBundle("charm.focus", it) }
    }
    override fun onFragmentViewDestroyed(fm: FragmentManager, f: Fragment) { cleanup.remove(f)?.invoke() }
}
