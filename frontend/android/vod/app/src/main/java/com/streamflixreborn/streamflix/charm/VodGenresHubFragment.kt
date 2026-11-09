package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.models.Genre
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Native, accessible TV Genres hub. IDs are supplied by the provider, not
 * invented TMDB IDs that would route into the wrong Xtream/Stalker category.
 */
class VodGenresHubFragment : Fragment() {
    private var body: LinearLayout? = null
    private fun dp(n: Int) = (n * resources.displayMetrics.density + .5f).toInt()
    private val icon = mapOf(
        "Action" to "✦", "Comedy" to "☺", "Drama" to "◈", "Horror" to "☠",
        "Sci-Fi" to "◎", "Family" to "♥", "Thriller" to "◎",
        "Documentary" to "▣", "Animation" to "★", "Romance" to "♡"
    )
    override fun onCreateView(inflater: LayoutInflater, parent: ViewGroup?, state: Bundle?): View {
        val column = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(27), dp(18), dp(27), dp(35))
        }
        val root = ScrollView(requireContext()).apply {
            setBackgroundColor(0xFF140C22.toInt())
            clipChildren = false
            clipToPadding = false
            addView(column)
        }
        body = column
        return root
    }
    override fun onViewCreated(view: View, state: Bundle?) {
        super.onViewCreated(view, state)
        val column = body ?: return
        column.addView(TextView(requireContext()).apply {
            text = "Genres"
            textSize = 31f
            setTextColor(Color.WHITE)
            setPadding(0, dp(8), 0, dp(24))
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
                visible.addView(TextView(requireContext()).apply {
                    text = "This provider does not expose browsable genres yet."
                    textSize = 18f
                    setTextColor(0xFFD2BEE3.toInt())
                })
            } else {
                val lines = genres.chunked(4)
                for (row in lines) {
                    val line = LinearLayout(requireContext()).apply {
                        orientation = LinearLayout.HORIZONTAL
                        clipChildren = false
                        setPadding(dp(2), dp(5), dp(2), dp(6))
                    }
                    row.forEach { genre ->
                        val colors = intArrayOf(0x9B1CA5DA.toInt(), 0xA9572177.toInt(), 0x8AEB538D.toInt())
                        val tile = TextView(requireContext()).apply {
                            text = (icon.entries.firstOrNull {
                                genre.name.contains(it.key, true)
                            }?.value ?: "◈") + "  " + genre.name
                            textSize = 18f
                            maxLines = 2
                            gravity = Gravity.CENTER
                            setTextColor(Color.WHITE)
                            isFocusable = true
                            isClickable = true
                            elevation = dp(6).toFloat()
                            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, colors).apply {
                                cornerRadius = dp(18).toFloat()
                                setStroke(dp(1), 0xB4DBAAFF.toInt())
                            }
                            onFocusChangeListener = View.OnFocusChangeListener { v, focused ->
                                v.animate().cancel()
                                v.animate().scaleX(if (focused) 1.07f else 1f)
                                    .scaleY(if (focused) 1.07f else 1f)
                                    .translationZ(if (focused) dp(11).toFloat() else 0f)
                                    .setDuration(160L).start()
                            }
                            setOnClickListener {
                                findNavController().navigate(R.id.genre, Bundle().apply {
                                    putString("id", genre.id)
                                    putString("name", genre.name)
                                })
                            }
                        }
                        line.addView(tile, LinearLayout.LayoutParams(0, dp(95), 1f).apply {
                            rightMargin = dp(13)
                        })
                    }
                    visible.addView(line)
                }
            }
        }
    }
    override fun onDestroyView() {
        body = null
        super.onDestroyView()
    }
}
