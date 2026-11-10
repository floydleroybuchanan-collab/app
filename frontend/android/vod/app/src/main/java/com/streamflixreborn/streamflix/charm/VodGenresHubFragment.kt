package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.models.Genre
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Provider-ID-safe, TV-first Genres. RecyclerView inflates only visible cards
 * instead of keeping up to 120 heavy TextViews/gradients in one ScrollView.
 * All icon art is original drawable vector work; no disk/bitmap cache needed.
 * The VOD Home and Platforms screens are visually untouched.
 */
class VodGenresHubFragment : Fragment() {
    private var grid: RecyclerView? = null
    private var loading: ProgressBar? = null
    private var empty: TextView? = null
    private val genreAdapter = GenreCardAdapter()
    private fun dp(n: Int) = (n * resources.displayMetrics.density + .5f).toInt()

    private fun category(name: String): String {
        val value = name.lowercase()
        return when {
            "action" in value || "adventure" in value -> "action"
            "comedy" in value -> "comedy"
            "drama" in value -> "drama"
            "horror" in value -> "horror"
            "sci-fi" in value || "science fiction" in value || "fantasy" in value -> "scifi"
            "family" in value || "kids" in value -> "family"
            "thriller" in value || "suspense" in value || "crime" in value -> "thriller"
            "documentary" in value || "history" in value -> "documentary"
            "animation" in value || "anime" in value -> "animation"
            "romance" in value || "love" in value -> "romance"
            else -> "other"
        }
    }

    private fun description(kind: String): String = when (kind) {
        "action" -> "Bold adventures, heroic moments and high-energy stories"
        "comedy" -> "Laughter, witty moments and feel-good discoveries"
        "drama" -> "Powerful stories and unforgettable characters"
        "horror" -> "Chilling mysteries, suspense and the supernatural"
        "scifi" -> "Extraordinary worlds, science and imagined futures"
        "family" -> "Heartwarming entertainment for every generation"
        "thriller" -> "Edge-of-your-seat mysteries and thrilling twists"
        "documentary" -> "Real stories, discoveries and remarkable people"
        "animation" -> "Imaginative animated worlds and favorite heroes"
        "romance" -> "Moving stories of love and relationships"
        else -> "Discover movies and shows in this collection"
    }

    override fun onCreateView(inflater: LayoutInflater, parent: ViewGroup?, state: Bundle?): View {
        val context = requireContext()
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF140C22.toInt())
            setPadding(dp(24), dp(13), dp(22), dp(11))
        }
        root.addView(TextView(context).apply {
            text = "Genres"
            textSize = 29f
            setTextColor(Color.WHITE)
            setPadding(dp(8), 0, 0, dp(6))
            typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        root.addView(TextView(context).apply {
            text = "Find your next favorite • Browse by story, mood and style"
            textSize = 14f
            setTextColor(0xFFCFB6E6.toInt())
            setPadding(dp(8), 0, 0, dp(10))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)))
        val progress = ProgressBar(context).apply {
            isIndeterminate = true
            isFocusable = false
        }
        loading = progress
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)))
        val message = TextView(context).apply {
            text = "This provider does not expose browsable genres yet."
            textSize = 17f
            setTextColor(0xFFD2BEE3.toInt())
            visibility = View.GONE
        }
        empty = message
        root.addView(message, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        val recycler = RecyclerView(context).apply {
            id = View.generateViewId()
            layoutManager = GridLayoutManager(context, 3)
            adapter = genreAdapter
            clipChildren = false
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_NEVER
            setHasFixedSize(true)
            itemAnimator = null // no full-grid fade/bitmap churn as a category loads
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        }
        grid = recycler
        root.addView(recycler, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        return root
    }

    override fun onViewCreated(view: View, state: Bundle?) {
        super.onViewCreated(view, state)
        viewLifecycleOwner.lifecycleScope.launch {
            val genres = withContext(Dispatchers.IO) {
                val provider = UserPreferences.currentProvider ?: return@withContext emptyList<Genre>()
                runCatching {
                    provider.getHome().asSequence().flatMap { it.list.asSequence() }
                        .filterIsInstance<Genre>().distinctBy { it.id }.take(120).toList()
                }.getOrDefault(emptyList())
            }
            // View lifecycle cancellation and identity guard prevent a late IO
            // response from repopulating a destroyed/hidden native VOD screen.
            if (grid?.rootView == null || !isAdded) return@launch
            loading?.visibility = View.GONE
            empty?.visibility = if (genres.isEmpty()) View.VISIBLE else View.GONE
            genreAdapter.show(genres)
        }
    }

    override fun onDestroyView() {
        grid?.adapter = null
        grid = null
        loading = null
        empty = null
        genreAdapter.show(emptyList())
        super.onDestroyView()
    }

    private inner class GenreCardAdapter : RecyclerView.Adapter<GenreCardHolder>() {
        private var items: List<Genre> = emptyList()
        fun show(next: List<Genre>) {
            items = next
            notifyDataSetChanged() // full refresh only on initial load/teardown (max 120)
        }
        override fun getItemCount(): Int = items.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): GenreCardHolder {
            val context = parent.context
            val card = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                isFocusable = true
                isClickable = true
                clipChildren = false
                setPadding(dp(12), dp(9), dp(12), dp(9))
                layoutParams = RecyclerView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(113)
                ).apply { setMargins(dp(6), dp(6), dp(6), dp(6)) }
            }
            val artwork = ImageView(context).apply {
                isFocusable = false
                contentDescription = null
                scaleType = ImageView.ScaleType.FIT_CENTER
            }
            card.addView(artwork, LinearLayout.LayoutParams(dp(71), dp(75)))
            val copy = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(9), 0, 0, 0)
                isFocusable = false
            }
            val title = TextView(context).apply {
                textSize = 19f
                setTextColor(Color.WHITE)
                maxLines = 1
                typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
            }
            copy.addView(title)
            val subtitle = TextView(context).apply {
                textSize = 12f
                setTextColor(0xFFE4D0F2.toInt())
                maxLines = 3
                setPadding(0, dp(5), 0, 0)
            }
            copy.addView(subtitle)
            card.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            return GenreCardHolder(card, artwork, title, subtitle)
        }

        override fun onBindViewHolder(holder: GenreCardHolder, position: Int) {
            val genre = items[position]
            val kind = category(genre.name)
            holder.title.text = genre.name
            holder.subtitle.text = description(kind)
            holder.artwork.setImageDrawable(CharmingVodGenreIcon(kind))
            holder.itemView.contentDescription = genre.name + ". " + description(kind)
            val idle = glass(false)
            val active = glass(true)
            holder.itemView.background = if (holder.itemView.hasFocus()) active else idle
            holder.itemView.setOnFocusChangeListener { v, focused ->
                v.background = if (focused) active else idle
                v.animate().cancel()
                v.animate().scaleX(if (focused) 1.035f else 1f)
                    .scaleY(if (focused) 1.035f else 1f)
                    .translationZ(if (focused) dp(12).toFloat() else 0f)
                    .setDuration(135L).start()
            }
            holder.itemView.setOnClickListener {
                if (findNavController().currentDestination?.id != R.id.genre_hub) return@setOnClickListener
                findNavController().navigate(R.id.genre, Bundle().apply {
                    putString("id", genre.id)
                    putString("name", genre.name)
                })
            }
        }

        private fun glass(focused: Boolean) = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            if (focused) intArrayOf(0xB85225A7.toInt(), 0xA4227A9F.toInt())
            else intArrayOf(0x75362D77.toInt(), 0x6D102341.toInt())
        ).apply {
            cornerRadius = dp(17).toFloat()
            setStroke(dp(if (focused) 2 else 1), if (focused) 0xFFFF7DFF.toInt() else 0x885F9FEB.toInt())
        }
    }

    private class GenreCardHolder(
        root: LinearLayout,
        val artwork: ImageView,
        val title: TextView,
        val subtitle: TextView,
    ) : RecyclerView.ViewHolder(root)
}
