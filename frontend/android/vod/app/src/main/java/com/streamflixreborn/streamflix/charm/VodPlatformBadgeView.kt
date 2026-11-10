package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.TextView

/**
 * One lightweight semi-transparent glass badge treatment for ORIGINALS
 * shelves, content detail metadata and the temporary player corner.
 * The colored trim identifies the platform; focus remains purple branded.
 * No extra bitmaps, animations, image decoders or permanent view references.
 */
class VodPlatformBadgeView(
    context: Context, val platform: VodPlatformCatalog.Platform,
    private val small: Boolean = false,
) : TextView(context) {
    private val artwork = CharmingPlatformArt(platform.id)
    private fun dp(value: Int) = (value * resources.displayMetrics.density + .5f).toInt()
    init {
        text = ""
        gravity = Gravity.CENTER
        maxLines = 1
        setTextColor(Color.WHITE)
        textSize = if (small) 15f else 20f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(if (small) 12 else 17), 0, dp(if (small) 12 else 17), 0)
        background = null
        elevation = dp(5).toFloat()
        isFocusable = false
        isClickable = false
    }
    override fun onDraw(canvas: Canvas) {
        artwork.setBounds(0, 0, width, height)
        artwork.draw(canvas)
        // The logo artwork is drawn at full badge resolution; no text glyph
        // or stock platform initial is substituted for the approved mark.
    }

    fun glass(focused: Boolean): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0x9A9F63CF.toInt(), 0xAB231A43.toInt(), 0x803B1854.toInt())
        else intArrayOf(0x6BFFFFFF, 0x85331D54.toInt(), 0x633A225E)
    ).apply {
        cornerRadius = dp(if (small) 12 else 17).toFloat()
        setStroke(dp(if (focused) 2 else 1),
            if (focused) 0xFFE2B4FF.toInt() else platform.tint)
    }
    /**
     * The 'View All' chip follows the *specific platform* glass palette,
     * rather than reusing the generic purple section action.
     * Pair the branded badge and its action without additional bitmaps.
     */
    fun viewAllGlass(focused: Boolean): GradientDrawable {
        val tones = when (platform.id) {
            "netflix" -> intArrayOf(0xFFF82D55.toInt(), 0xFFD11060.toInt(), 0xFF7D124C.toInt())
            "disney" -> intArrayOf(0xFF13CCF4.toInt(), 0xFF056EDB.toInt(), 0xFF203593.toInt())
            "apple" -> intArrayOf(0xFFB7AFFA.toInt(), 0xFF7168B3.toInt(), 0xFF322854.toInt())
            "hulu" -> intArrayOf(0xFF1CE59C.toInt(), 0xFF06A788.toInt(), 0xFF155E76.toInt())
            "max" -> intArrayOf(0xFFCE4FFF.toInt(), 0xFF8735E3.toInt(), 0xFF561A96.toInt())
            "prime" -> intArrayOf(0xFF21CBF7.toInt(), 0xFF087CE4.toInt(), 0xFF1943AB.toInt())
            "paramount" -> intArrayOf(0xFF40B8FF.toInt(), 0xFF4267E8.toInt(), 0xFF3F3FA8.toInt())
            "peacock" -> intArrayOf(0xFFF67A50.toInt(), 0xFFE034A1.toInt(), 0xFF7D2FB0.toInt())
            "starz" -> intArrayOf(0xFF4CE4F8.toInt(), 0xFF147FCE.toInt(), 0xFF6727C8.toInt())
            "amc" -> intArrayOf(0xFF09E7E4.toInt(), 0xFF047EAE.toInt(), 0xFF2F348C.toInt())
            else -> intArrayOf(platform.tint, 0xFF683A9A.toInt(), 0xFF29183C.toInt())
        }
        return GradientDrawable(GradientDrawable.Orientation.TL_BR, tones).apply {
            cornerRadius = dp(17).toFloat()
            setStroke(dp(if (focused) 2 else 1),
                if (focused) Color.WHITE else platform.tint)
            alpha = if (focused) 255 else 230
        }
    }

    fun showFocus(focused: Boolean) {
        background = glass(focused)
        animate().cancel()
        animate().scaleX(if (focused) 1.08f else 1f)
            .scaleY(if (focused) 1.08f else 1f)
            .translationZ(if (focused) dp(9).toFloat() else 0f)
            .setDuration(145L).start()
    }
}
