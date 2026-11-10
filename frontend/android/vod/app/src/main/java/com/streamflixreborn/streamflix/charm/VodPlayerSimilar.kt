package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.Show
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The scrollable Similar Titles rail inside the VOD player's controls. */
object VodPlayerSimilar {
    fun attach(owner: LifecycleOwner, root: View, type: Video.Type?, navigation: NavController) {
        if (type == null) return
        owner.lifecycleScope.launch {
            val titles = withContext(Dispatchers.IO) {
                val provider = UserPreferences.currentProvider ?: return@withContext emptyList<Show>()
                runCatching {
                    when (type) {
                        is Video.Type.Movie -> provider.getMovie(type.id).recommendations
                        is Video.Type.Episode -> provider.getTvShow(type.tvShow.id).recommendations
                    }
                }.getOrDefault(emptyList())
            }
            if (titles.isEmpty()) return@launch
            // The controller is inflated with the player, shortly after navigation.
            var rail: RecyclerView? = null
            repeat(24) {
                rail = rail ?: root.findViewById(R.id.rv_exo_similar)
                if (rail == null) delay(250L)
            }
            show(rail ?: return@launch, titles, navigation)
        }
    }

    private fun show(rail: RecyclerView, titles: List<Show>, navigation: NavController) {
        val stop = R.id.btn_exo_stop
        rail.layoutManager = LinearLayoutManager(rail.context, RecyclerView.HORIZONTAL, false)
        rail.adapter = Cards(titles, navigation)
        rail.visibility = View.VISIBLE
        // D-pad order becomes playback buttons, then this rail, then Stop.
        fun link(view: View) {
            if (view.nextFocusDownId == stop) view.nextFocusDownId = rail.id
            (view as? ViewGroup)?.let { group -> (0 until group.childCount).forEach { link(group.getChildAt(it)) } }
        }
        (rail.parent as? View)?.let(::link)
        (rail.parent as? View)?.findViewById<View>(stop)?.nextFocusUpId = rail.id
    }

    private class Holder(val card: FrameLayout, val art: ImageView, val name: TextView) : RecyclerView.ViewHolder(card)

    private class Cards(val titles: List<Show>, val navigation: NavController) : RecyclerView.Adapter<Holder>() {
        override fun getItemCount() = titles.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val density = parent.resources.displayMetrics.density
            fun dp(value: Int) = (value * density + .5f).toInt()
            val art = ImageView(parent.context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
            val name = TextView(parent.context).apply {
                textSize = 10f
                maxLines = 1
                setTextColor(Color.WHITE)
                setShadowLayer(4f, 0f, 1f, Color.BLACK)
                setPadding(dp(6), 0, dp(6), dp(4))
            }
            val card = FrameLayout(parent.context).apply {
                isFocusable = true
                isClickable = true
                background = VodGlass.surface(0xFFB68AF5.toInt(), dp(9).toFloat(), dp(1), false)
                layoutParams = RecyclerView.LayoutParams(dp(136), ViewGroup.LayoutParams.MATCH_PARENT).apply { rightMargin = dp(9) }
                addView(art, FrameLayout.LayoutParams(-1, -1).apply { setMargins(dp(2), dp(2), dp(2), dp(2)) })
                addView(name, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
                onFocusChangeListener = View.OnFocusChangeListener { view, focused ->
                    view.background = VodGlass.surface(0xFFB68AF5.toInt(), dp(9).toFloat(), dp(1), focused)
                    VodHomeShelf.liftCard(view, focused)
                }
            }
            return Holder(card, art, name)
        }

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val show = titles[position]
            val (title, image, id) = when (show) {
                is Movie -> Triple(show.title, show.banner ?: show.poster, show.id)
                is TvShow -> Triple(show.title, show.banner ?: show.poster, show.id)
            }
            holder.name.text = title
            holder.card.contentDescription = title
            Glide.with(holder.art).load(image?.replace("/original/", "/w500/")).centerCrop().into(holder.art)
            holder.card.setOnClickListener {
                navigation.navigate(if (show is Movie) R.id.movie else R.id.tv_show, Bundle().apply { putString("id", id) })
            }
        }

        override fun onViewRecycled(holder: Holder) {
            Glide.with(holder.art).clear(holder.art)
        }
    }
}
