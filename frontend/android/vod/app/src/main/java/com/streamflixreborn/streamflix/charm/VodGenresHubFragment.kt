package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.annotation.DrawableRes
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.models.Genre
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The Genres page: glass cards with an icon and a line about each genre. IDs come
 * from the provider, so a card always opens that provider's real category.
 */
class VodGenresHubFragment : Fragment() {
    private class Style(val key: String, @DrawableRes val art: Int, val about: String, val tint: Int)

    private val styles = listOf(
        Style("action", R.drawable.vod_genre_action, "High-energy adventures, fights, and heroic missions.", 0xFFFF7A1A.toInt()),
        Style("adventure", R.drawable.vod_genre_adventure, "Exciting journeys, exploration, and epic discoveries.", 0xFF38B9ED.toInt()),
        Style("anim", R.drawable.vod_genre_animation, "Animated favorites for kids and adults alike.", 0xFF36D6FB.toInt()),
        Style("anime", R.drawable.vod_genre_animation, "Bold Japanese animation and epic story arcs.", 0xFF36D6FB.toInt()),
        Style("comedy", R.drawable.vod_genre_comedy, "Feel-good shows and movies that make you laugh.", 0xFFFFC23A.toInt()),
        Style("crime", R.drawable.vod_genre_crime, "Crime, investigation, and mystery cases.", 0xFF36D6FB.toInt()),
        Style("documentar", R.drawable.vod_genre_documentary, "Real stories, real people, real world insights.", 0xFF468FF1.toInt()),
        Style("drama", R.drawable.vod_genre_drama, "Powerful stories, real emotions, unforgettable characters.", 0xFFB68AF5.toInt()),
        Style("soap", R.drawable.vod_genre_drama, "Long-running stories full of twists and hearts.", 0xFFB68AF5.toInt()),
        Style("family", R.drawable.vod_genre_family, "Great entertainment for all ages.", 0xFFFFA5CD.toInt()),
        Style("kids", R.drawable.vod_genre_family, "Bright, safe favorites for younger viewers.", 0xFFFFA5CD.toInt()),
        Style("horror", R.drawable.vod_genre_horror, "Thrilling and chilling stories that keep you on edge.", 0xFFE34BFF.toInt()),
        Style("romance", R.drawable.vod_genre_romance, "Heartwarming and passionate love stories.", 0xFFFF4FA0.toInt()),
        Style("sci", R.drawable.vod_genre_scifi, "Futuristic worlds, space, and cutting-edge imagination.", 0xFF38B9ED.toInt()),
        Style("fantasy", R.drawable.vod_genre_scifi, "Magic, myths, and worlds beyond our own.", 0xFF38B9ED.toInt()),
        Style("thriller", R.drawable.vod_genre_thriller, "Suspenseful, intense, and full of twists.", 0xFFFF5B5B.toInt()),
        Style("mystery", R.drawable.vod_genre_crime, "Clues, secrets, and questions to unravel.", 0xFF36D6FB.toInt()),
        Style("war", R.drawable.vod_genre_action, "Courage and conflict on the front lines.", 0xFFFF7A1A.toInt()),
        Style("western", R.drawable.vod_genre_adventure, "Outlaws, frontiers, and showdowns at sundown.", 0xFF38B9ED.toInt()),
        Style("history", R.drawable.vod_genre_documentary, "The people and moments that shaped the world.", 0xFF468FF1.toInt()),
        Style("news", R.drawable.vod_genre_documentary, "Reporting and analysis from around the world.", 0xFF468FF1.toInt()),
    )

    private var body: LinearLayout? = null
    private fun dp(n: Int) = (n * resources.displayMetrics.density + .5f).toInt()

    private fun styleFor(name: String) = styles.firstOrNull { name.contains(it.key, ignoreCase = true) }

    override fun onCreateView(inflater: LayoutInflater, parent: ViewGroup?, state: Bundle?): View {
        val column = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(14), dp(24), dp(28))
            clipChildren = false
            clipToPadding = false
        }
        val root = VodPageScrollView(requireContext()).apply {
            setBackgroundColor(0xFF120A20.toInt())
            isFocusable = false
            clipChildren = true
            addView(column)
        }
        body = column
        return root
    }

    override fun onViewCreated(view: View, state: Bundle?) {
        super.onViewCreated(view, state)
        val column = body ?: return
        column.addView(text("Genres", 27f, Color.WHITE, bold = true))
        column.addView(text("Explore content by category. Choose a genre to view its full collection.", 13f, 0xFFC7B3D8.toInt()).apply {
            setPadding(0, dp(2), 0, dp(14))
        })
        val progress = ProgressBar(requireContext())
        column.addView(progress)
        viewLifecycleOwner.lifecycleScope.launch {
            val genres = withContext(Dispatchers.IO) {
                val provider = UserPreferences.currentProvider ?: return@withContext emptyList<Genre>()
                runCatching {
                    provider.getHome().asSequence().flatMap { it.list.asSequence() }
                        .filterIsInstance<Genre>().distinctBy { it.id }.take(120).toList()
                }.getOrDefault(emptyList())
            }
            val visible = body ?: return@launch
            visible.removeView(progress)
            if (genres.isEmpty()) {
                visible.addView(text("This provider does not expose browsable genres yet.", 18f, 0xFFD2BEE3.toInt()))
                return@launch
            }
            var shown = 0
            genres.chunked(4).forEach { row ->
                val line = LinearLayout(requireContext()).apply {
                    orientation = LinearLayout.HORIZONTAL
                    clipChildren = false
                    clipToPadding = false
                    setPadding(0, dp(6), 0, dp(6))
                }
                row.forEach { genre ->
                    val tile = card(genre)
                    VodMotion.stagger(tile, shown++)
                    line.addView(tile, LinearLayout.LayoutParams(0, dp(84), 1f).apply { rightMargin = dp(12) })
                }
                repeat(4 - row.size) {
                    line.addView(View(requireContext()), LinearLayout.LayoutParams(0, 0, 1f).apply { rightMargin = dp(12) })
                }
                visible.addView(line)
            }
        }
    }

    private fun card(genre: Genre): View {
        val style = styleFor(genre.name)
        val tint = style?.tint ?: 0xFFB68AF5.toInt()
        return LinearLayout(requireContext()).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            isClickable = true
            contentDescription = genre.name
            setPadding(dp(12), dp(6), dp(10), dp(6))
            elevation = dp(5).toFloat()
            background = VodGlass.surface(tint, dp(16).toFloat(), dp(1), false)
            addView(ImageView(context).apply {
                setImageResource(style?.art ?: R.drawable.vod_nav_genres)
                scaleType = ImageView.ScaleType.FIT_CENTER
            }, LinearLayout.LayoutParams(dp(50), dp(50)).apply { rightMargin = dp(10) })
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(genre.name, 16f, Color.WHITE, bold = true).apply { maxLines = 1 })
                addView(text(style?.about ?: "Browse every title in ${genre.name}.", 10.5f, 0xFFE0D2EE.toInt()).apply { maxLines = 2 })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(text("›", 22f, Color.WHITE))
            onFocusChangeListener = View.OnFocusChangeListener { v, focused ->
                v.background = VodGlass.surface(tint, dp(16).toFloat(), dp(1), focused)
                VodHomeShelf.liftCard(v, focused)
            }
            setOnClickListener {
                findNavController().navigate(R.id.genre, Bundle().apply {
                    putString("id", genre.id)
                    putString("name", genre.name)
                })
            }
        }
    }

    private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(requireContext()).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    override fun onDestroyView() {
        body = null
        super.onDestroyView()
    }
}
