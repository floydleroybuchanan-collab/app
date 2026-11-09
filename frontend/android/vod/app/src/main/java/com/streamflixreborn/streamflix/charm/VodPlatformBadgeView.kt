package com.streamflixreborn.streamflix.charm

import android.content.Context
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
    private fun dp(value: Int) = (value * resources.displayMetrics.density + .5f).toInt()
    init {
        text = platform.mark
        gravity = Gravity.CENTER
        maxLines = 1
        setTextColor(Color.WHITE)
        textSize = if (small) 15f else 20f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(if (small) 12 else 17), 0, dp(if (small) 12 else 17), 0)
        background = glass(false)
        elevation = dp(5).toFloat()
        isFocusable = false
        isClickable = false
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
    fun showFocus(focused: Boolean) {
        background = glass(focused)
        animate().cancel()
        animate().scaleX(if (focused) 1.08f else 1f)
            .scaleY(if (focused) 1.08f else 1f)
            .translationZ(if (focused) dp(9).toFloat() else 0f)
            .setDuration(145L).start()
    }
}
