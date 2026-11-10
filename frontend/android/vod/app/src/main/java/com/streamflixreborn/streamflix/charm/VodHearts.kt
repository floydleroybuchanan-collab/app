package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.view.doOnPreDraw
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.streamflixreborn.streamflix.R

/** Favorites saved per title: a small preference map, separate from My List. */
object VodHearts {
    private const val SEPARATOR = "\u001F"
    data class Entry(val key: String, val title: String, val poster: String?)

    private fun prefs(context: Context) = context.getSharedPreferences("vod_favorites_v2", Context.MODE_PRIVATE)

    fun contains(context: Context, key: String) = prefs(context).contains(key)

    fun toggle(context: Context, key: String, title: String, poster: String?) {
        val saved = prefs(context)
        if (saved.contains(key)) saved.edit().remove(key).apply()
        else saved.edit().putString(key, title + SEPARATOR + poster.orEmpty()).apply()
    }

    fun all(context: Context): List<Entry> = prefs(context).all.mapNotNull { (key, value) ->
        val parts = (value as? String)?.split(SEPARATOR, limit = 2) ?: return@mapNotNull null
        Entry(key, parts[0], parts.getOrNull(1)?.takeIf { it.isNotBlank() })
    }.sortedBy { it.title.lowercase() }
}

/** The Favorites page, opened from My List. */
class VodHeartsFragment : Fragment() {
    private var lastIndex = 0

    private fun dp(value: Int) = (value * resources.displayMetrics.density + .5f).toInt()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        val entries = VodHearts.all(requireContext())
        val page = FrameLayout(requireContext())
        if (entries.isEmpty()) {
            page.addView(TextView(requireContext()).apply {
                text = "Press Favorite on any movie or series to add it here."
                textSize = 17f
                setTextColor(0xFFD2BEE3.toInt())
                gravity = Gravity.CENTER
                isFocusable = true
                doOnPreDraw { requestFocus() }
            }, FrameLayout.LayoutParams(-1, -1))
            return page
        }
        page.addView(RecyclerView(requireContext()).apply {
            layoutManager = GridLayoutManager(context, 6)
            adapter = Cards(entries)
            clipToPadding = false
            clipChildren = false
            setPadding(dp(20), dp(20), dp(20), dp(24))
            setHasFixedSize(true)
            val start = lastIndex.coerceAtMost(entries.lastIndex)
            scrollToPosition(start)
            doOnPreDraw { findViewHolderForAdapterPosition(start)?.itemView?.requestFocus() }
        }, FrameLayout.LayoutParams(-1, -1))
        return page
    }

    private class Holder(val card: FrameLayout, val art: ImageView, val name: TextView) : RecyclerView.ViewHolder(card)

    private inner class Cards(val entries: List<VodHearts.Entry>) : RecyclerView.Adapter<Holder>() {
        override fun getItemCount() = entries.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val art = ImageView(parent.context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
            val name = TextView(parent.context).apply {
                textSize = 12f
                maxLines = 2
                setTextColor(Color.WHITE)
                setShadowLayer(4f, 0f, 1f, Color.BLACK)
                setPadding(dp(7), 0, dp(7), dp(6))
            }
            val card = FrameLayout(parent.context).apply {
                isFocusable = true
                isClickable = true
                background = VodGlass.surface(0xFFB68AF5.toInt(), dp(12).toFloat(), dp(1), false)
                layoutParams = RecyclerView.LayoutParams(-1, dp(210)).apply { setMargins(dp(6), dp(7), dp(6), dp(7)) }
                addView(art, FrameLayout.LayoutParams(-1, -1).apply { setMargins(dp(2), dp(2), dp(2), dp(2)) })
                addView(name, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
                onFocusChangeListener = View.OnFocusChangeListener { view, focused ->
                    if (focused) lastIndex = view.tag as? Int ?: 0
                    view.background = VodGlass.surface(0xFFB68AF5.toInt(), dp(12).toFloat(), dp(1), focused)
                    VodHomeShelf.liftCard(view, focused)
                }
            }
            return Holder(card, art, name)
        }

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val entry = entries[position]
            holder.card.tag = position
            holder.name.text = entry.title
            holder.card.contentDescription = entry.title
            Glide.with(holder.art).load(entry.poster?.replace("/original/", "/w342/")).centerCrop().into(holder.art)
            holder.card.setOnClickListener {
                val movie = entry.key.startsWith("movie:")
                findNavController().navigate(if (movie) R.id.movie else R.id.tv_show,
                    Bundle().apply {
                        putString("id", entry.key.substringAfter(':'))
                        if (!movie) putString("poster", entry.poster)
                    })
            }
        }

        override fun onViewRecycled(holder: Holder) {
            Glide.with(holder.art).clear(holder.art)
        }
    }
}
