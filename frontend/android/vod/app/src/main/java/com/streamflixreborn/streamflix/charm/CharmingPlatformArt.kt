package com.streamflixreborn.streamflix.charm

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import kotlin.math.min

/**
 * Render the approved ten streaming brand marks inside floating layered glass.
 * Vector/Canvas art is memory-cheap and readable at all Android TV densities.
 * This is not a launcher for external streaming apps.
 */
class CharmingPlatformArt(private val id: String) : Drawable() {
    private val brush = Paint(Paint.ANTI_ALIAS_FLAG)
    private val a = when (id) {
        "netflix" -> 0xFFFF365C.toInt()
        "disney" -> 0xFF00D8FF.toInt()
        "apple" -> 0xFFDFE6FF.toInt()
        "hulu" -> 0xFF19E47E.toInt()
        "max" -> 0xFFCB42FF.toInt()
        "prime" -> 0xFF16D1F3.toInt()
        "paramount" -> 0xFF1B9EF8.toInt()
        "peacock" -> 0xFFFF4A9F.toInt()
        "starz" -> 0xFF09B9F5.toInt()
        else -> 0xFF12E5DB.toInt()
    }
    private val b = when (id) {
        "netflix" -> 0xFFBE1064.toInt()
        "disney" -> 0xFF3152C8.toInt()
        "apple" -> 0xFF4A65AD.toInt()
        "hulu" -> 0xFF0F8D72.toInt()
        "max" -> 0xFF6838D1.toInt()
        "prime" -> 0xFF2146BF.toInt()
        "paramount" -> 0xFF2445C8.toInt()
        "peacock" -> 0xFF5822C3.toInt()
        "starz" -> 0xFF6B35D5.toInt()
        else -> 0xFF126CAD.toInt()
    }
    private fun shader(first: Int, last: Int) {
        brush.style = Paint.Style.FILL
        brush.shader = LinearGradient(6f, 4f, 88f, 99f, first, last, Shader.TileMode.CLAMP)
        brush.color = Color.WHITE
    }
    private fun stroke(color: Int, width: Float = 2.5f) {
        brush.shader = null
        brush.color = color
        brush.style = Paint.Style.STROKE
        brush.strokeWidth = width
        brush.strokeCap = Paint.Cap.ROUND
    }
    private fun mark(canvas: Canvas, text: String, size: Float, x: Float = 50f,
                     y: Float = 58f, color: Int = Color.WHITE, bold: Boolean = true) {
        brush.style = Paint.Style.FILL
        brush.shader = null
        brush.color = color
        brush.typeface = if (bold) Typeface.create("sans-serif", Typeface.BOLD)
            else Typeface.create("sans-serif", Typeface.NORMAL)
        brush.textSize = size
        brush.textAlign = Paint.Align.CENTER
        canvas.drawText(text, x, y, brush)
    }

    override fun draw(canvas: Canvas) {
        if (bounds.isEmpty) return
        val save = canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width()/100f, bounds.height()/100f)
        shader(a, b)
        canvas.drawCircle(16f, 17f, 15f, brush)
        canvas.drawCircle(88f, 82f, 15f, brush)
        shader(a and 0x00FFFFFF or 0xEA000000.toInt(),
            b and 0x00FFFFFF or 0xEE000000.toInt())
        canvas.drawRoundRect(10f, 7f, 90f, 91f, 18f, 18f, brush)
        shader(0xAAFFFFFF.toInt(), a and 0x00FFFFFF or 0x27000000)
        canvas.drawRoundRect(14f, 11f, 84f, 36f, 13f, 13f, brush)
        stroke(0xC4F1E6FF.toInt(), 2.4f)
        canvas.drawRoundRect(10f, 7f, 90f, 91f, 18f, 18f, brush)

        when(id) {
            "netflix" -> {
                mark(canvas, "N", 65f, 50f, 75f, 0xFFEA142A.toInt())
            }
            "disney" -> {
                stroke(0xFF41E6FF.toInt(), 2.6f)
                canvas.drawArc(RectF(18f, 16f, 83f, 61f), 191f, 158f, false, brush)
                mark(canvas, "Disney+", 18f, 50f, 69f, Color.WHITE, false)
            }
            "apple" -> {
                brush.shader = null; brush.style = Paint.Style.FILL; brush.color = Color.WHITE
                canvas.drawCircle(29f, 48f, 11f, brush)
                canvas.drawOval(RectF(27f, 25f, 39f, 32f), brush)
                mark(canvas, "tv+", 34f, 60f, 60f, Color.WHITE)
            }
            "hulu" -> mark(canvas, "hulu", 36f, 50f, 61f, 0xFF1BE968.toInt())
            "max" -> {
                mark(canvas, "HBO", 27f, 50f, 50f)
                mark(canvas, "max", 37f, 50f, 79f)
            }
            "prime" -> {
                mark(canvas, "prime", 24f, 50f, 42f)
                mark(canvas, "video", 22f, 50f, 65f)
                stroke(0xFF10EDFF.toInt(), 3.8f)
                canvas.drawArc(RectF(28f, 53f, 79f, 89f), 20f, 137f, false, brush)
            }
            "paramount" -> {
                val peak=Path().apply {
                    moveTo(28f, 54f); lineTo(49f, 29f); lineTo(69f, 54f)
                    lineTo(58f, 49f); lineTo(51f, 42f); lineTo(46f, 48f); close()
                }
                brush.style=Paint.Style.FILL;brush.shader=null;brush.color=Color.WHITE
                canvas.drawPath(peak,brush)
                stroke(Color.WHITE,1.5f)
                canvas.drawArc(RectF(19f, 15f, 79f, 72f), 188f, 165f, false, brush)
                mark(canvas,"Paramount+",14f,50f,76f,Color.WHITE,false)
            }
            "peacock" -> {
                mark(canvas, "p", 70f, 41f, 76f)
                val colors=intArrayOf(0xFFFFD424.toInt(),0xFFFF913C.toInt(),
                    0xFFFA2679.toInt(),0xFF863DF8.toInt(),0xFF1FC3F7.toInt(),0xFF17E3A7.toInt())
                brush.shader=null;brush.style=Paint.Style.FILL
                colors.forEachIndexed { i,color ->
                    brush.color=color
                    canvas.drawCircle(77f, 25f+i*11f, 4.6f, brush)
                }
            }
            "starz" -> mark(canvas, "STARZ", 32f, 50f, 62f)
            "amc" -> {
                stroke(0xFF17F3DD.toInt(),2.1f)
                canvas.drawRect(19f,33f,82f,72f,brush)
                mark(canvas, "amc+", 28f, 50f, 61f, 0xFF23EFE0.toInt(), false)
            }
        }
        stroke(0x77FFFFFF, 1.5f)
        canvas.drawArc(RectF(14f, 12f, 85f, 88f), 196f, 70f, false, brush)
        canvas.restoreToCount(save)
    }
    override fun setAlpha(alpha: Int) { brush.alpha=alpha; invalidateSelf() }
    override fun setColorFilter(filter: ColorFilter?) { brush.colorFilter=filter }
    @Deprecated("Android drawable API")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    override fun getIntrinsicWidth()=100
    override fun getIntrinsicHeight()=100
}
