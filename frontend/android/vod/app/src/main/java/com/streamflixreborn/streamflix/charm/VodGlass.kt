package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable

/** The one see-through glass surface used by every VOD button. */
object VodGlass {
    private fun withAlpha(color: Int, alpha: Int) = (color and 0x00FFFFFF) or (alpha shl 24)

    fun surface(
        tint: Int,
        radiusPx: Float,
        strokePx: Int,
        focused: Boolean,
        active: Boolean = false,
    ): Drawable {
        val strength = if (focused) 0x99 else if (active) 0x66 else 0x38
        val body = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(withAlpha(tint, strength), withAlpha(tint, strength / 3)),
        ).apply { cornerRadius = radiusPx }
        // The bright upper reflection and rim are what make the tint read as glass.
        val sheen = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0x47FFFFFF, 0x0DFFFFFF, 0x00FFFFFF),
        ).apply {
            cornerRadius = radiusPx
            setStroke(
                if (focused) strokePx * 2 else strokePx,
                when {
                    focused -> Color.WHITE
                    active -> 0xE6FFFFFF.toInt()
                    else -> 0x73FFFFFF
                },
            )
        }
        return LayerDrawable(arrayOf(body, sheen))
    }
}
