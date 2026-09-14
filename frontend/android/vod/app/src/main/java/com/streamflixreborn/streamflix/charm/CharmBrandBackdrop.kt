package com.streamflixreborn.streamflix.charm

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.drawable.Drawable

/** Static artwork surrounds the content; no timers, focus targets or playback work. */
class CharmBrandBackdrop(private val rail: Boolean = false) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val paths = ArrayList<Path>()
    private var foundation: Shader? = null

    override fun onBoundsChange(bounds: Rect) {
        val w = bounds.width().toFloat()
        val h = bounds.height().toFloat()
        if (w <= 0f || h <= 0f) return
        foundation = LinearGradient(0f, 0f, w, h,
            intArrayOf(0xFF24112F.toInt(), 0xFF0C0915.toInt(), 0xFF110A1D.toInt()),
            null, Shader.TileMode.CLAMP)
        paths.clear()
        repeat(3) { index ->
            val offset = index * if (rail) w * .06f else h * .012f
            paths.add(Path().apply {
                if (rail) {
                    moveTo(-w * .1f + offset, h * .59f)
                    lineTo(w * .38f + offset, h * .67f)
                    lineTo(w * .38f + offset, h * .87f)
                    lineTo(w * .86f + offset, h)
                } else {
                    moveTo(w * .66f, offset)
                    lineTo(w * .78f, h * .04f + offset)
                    lineTo(w * .88f, h * .04f + offset)
                    lineTo(w, h * .14f + offset)
                }
            })
        }
    }

    override fun draw(canvas: Canvas) {
        paint.style = Paint.Style.FILL
        paint.shader = foundation
        canvas.drawRect(bounds, paint)
        paint.shader = null
        // Fine, quiet diagonal texture joins the original banner's dark mesh.
        paint.color = 0x073F2E65
        paint.strokeWidth = 1f
        val step = 12f
        var x = -bounds.height().toFloat()
        while (x < bounds.width()) {
            canvas.drawLine(x, 0f, x + bounds.height(), bounds.height().toFloat(), paint)
            x += step
        }
        paint.style = Paint.Style.STROKE
        paths.forEach { path ->
            paint.color = if (rail) 0x305F12A0 else 0x185F12A0
            paint.strokeWidth = 8f
            canvas.drawPath(path, paint)
            paint.color = if (rail) 0xB59D36E2.toInt() else 0x507C3AED
            paint.strokeWidth = 1.5f
            canvas.drawPath(path, paint)
        }
        paint.style = Paint.Style.FILL
    }

    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter }
    @Suppress("DEPRECATION") override fun getOpacity(): Int = PixelFormat.OPAQUE
}
