package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.drawable.Drawable
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.DrawableCompat
import kotlin.math.min

/**
 * Tiny GPU-friendly, zero-bitmap glass icon frame with coral/cyan/amber/pink
 * gradients matching Charming MediaLab's approved multicolor glass direction.
 * Uses existing semantic vector silhouettes; no persistent image allocation.
 */
class GlassGlyphDrawable(
    private val context: Context,
    drawableId: Int,
    private val accentA: Int,
    private val accentB: Int,
) : Drawable() {
    private val symbol = ContextCompat.getDrawable(context, drawableId)?.mutate()?.let {
        DrawableCompat.wrap(it).apply { DrawableCompat.setTint(this, Color.WHITE) }
    }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun draw(canvas: Canvas) {
        val r = bounds
        if (r.isEmpty) return
        val size = min(r.width(), r.height()).toFloat()
        val radius = size * .30f
        val left = r.left.toFloat()
        val top = r.top.toFloat()
        paint.style = Paint.Style.FILL
        paint.shader = LinearGradient(left,top,left+size,top+size,
            intArrayOf(accentA, accentB, 0xAC601FBA.toInt()), null,Shader.TileMode.CLAMP)
        canvas.drawRoundRect(left + 1f,top + 1f,r.right-1f,r.bottom-1f,radius,radius,paint)
        paint.shader = null
        paint.color = 0xB2FFFFFF.toInt()
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = maxOf(1f,size*.035f)
        canvas.drawRoundRect(left+1f,top+1f,r.right-1f,r.bottom-1f,radius,radius,paint)
        paint.style = Paint.Style.FILL
        paint.color = 0x4AFFFFFF
        canvas.drawCircle(left+size*.27f,top+size*.20f,size*.16f,paint)
        val pad = (size*.24f).toInt()
        symbol?.setBounds(r.left+pad,r.top+pad,r.right-pad,r.bottom-pad)
        symbol?.draw(canvas)
    }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter }
    @Deprecated("Android drawable API")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    override fun getIntrinsicWidth() = (42*context.resources.displayMetrics.density).toInt()
    override fun getIntrinsicHeight() = intrinsicWidth
}
