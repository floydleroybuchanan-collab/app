package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import com.streamflixreborn.streamflix.R

/**
 * The app background for the embedded VOD screens: the violet sky with the crown dead centre, the same picture the
 * Live TV pages sit on. The crown is only scaled, never rotated, so it stays upright when the phone is turned.
 */
class CrownBackdrop(context: Context) : Drawable() {
    private val crown: Bitmap? = try {
        BitmapFactory.decodeResource(context.resources, R.drawable.charm_crown_backdrop)
    } catch (_: Throwable) {
        null
    }
    private val sky = Paint()
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG)
    private val crownPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { alpha = 173 }
    private val dst = RectF()

    override fun onBoundsChange(bounds: Rect) {
        val w = bounds.width().toFloat()
        val h = bounds.height().toFloat()
        sky.shader = LinearGradient(0f, 0f, w, h, 0xFF220A4A.toInt(), 0xFF0B0420.toInt(), Shader.TileMode.CLAMP)
        val r = minOf(w, h) * 1.1f
        glow.shader = RadialGradient(
            bounds.exactCenterX(), bounds.exactCenterY(), r,
            intArrayOf(0x4DFF4FD8, 0x00000000), null, Shader.TileMode.CLAMP,
        )
    }

    override fun draw(canvas: Canvas) {
        val b = bounds
        canvas.drawRect(b, sky)
        canvas.drawRect(b, glow)
        val picture = crown ?: return
        val width = minOf(b.width(), b.height()) * 0.95f
        val height = width * picture.height / picture.width
        dst.set(
            b.exactCenterX() - width / 2f, b.exactCenterY() - height / 2f,
            b.exactCenterX() + width / 2f, b.exactCenterY() + height / 2f,
        )
        canvas.drawBitmap(picture, null, dst, crownPaint)
    }

    override fun setAlpha(alpha: Int) = Unit
    override fun setColorFilter(colorFilter: ColorFilter?) = Unit

    @Deprecated("Required by Drawable")
    override fun getOpacity(): Int = PixelFormat.OPAQUE
}
