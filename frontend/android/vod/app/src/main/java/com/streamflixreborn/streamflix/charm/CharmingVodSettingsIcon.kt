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
import android.graphics.drawable.Drawable

/**
 * Original transparent glass icons for every nested VOD Settings preference.
 * Stateless vector drawing: no bitmap loads, remote assets or RAM-heavy cache.
 */
class CharmingVodSettingsIcon(private val kind: String) : Drawable() {
    private val brush = Paint(Paint.ANTI_ALIAS_FLAG)
    private val first: Int
    private val last: Int
    init {
        val colors = when (kind) {
            "provider" -> 0xFF04DFFE.toInt() to 0xFFBA2DF9.toInt()
            "playback" -> 0xFF00C8FF.toInt() to 0xFFFF3C9B.toInt()
            "epg" -> 0xFFFFA332.toInt() to 0xFFCD27FD.toInt()
            "security" -> 0xFF0CD9FF.toInt() to 0xFF8F3DFB.toInt()
            "appearance" -> 0xFFFFC03E.toInt() to 0xFFF02BAC.toInt()
            "account" -> 0xFF34CEFF.toInt() to 0xFFFF8B41.toInt()
            "notifications" -> 0xFFFFAB2B.toInt() to 0xFFFC2EAF.toInt()
            "storage" -> 0xFF11E9FF.toInt() to 0xFF9930F8.toInt()
            else -> 0xFF6ACBFF.toInt() to 0xFFF241BA.toInt()
        }
        first = colors.first
        last = colors.second
    }
    private fun fill() {
        brush.style = Paint.Style.FILL
        brush.color = Color.WHITE
        brush.shader = LinearGradient(12f, 12f, 88f, 92f, first, last, Shader.TileMode.CLAMP)
    }
    private fun stroke(w: Float = 3f) {
        brush.shader = null
        brush.style = Paint.Style.STROKE
        brush.color = 0xFFE9DFFF.toInt()
        brush.strokeWidth = w
        brush.strokeCap = Paint.Cap.ROUND
        brush.strokeJoin = Paint.Join.ROUND
    }
    override fun draw(canvas: Canvas) {
        if (bounds.isEmpty) return
        val save = canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 100f, bounds.height() / 100f)
        fill()
        when (kind) {
            "provider" -> {
                canvas.drawRoundRect(9f, 35f, 91f, 80f, 16f, 16f, brush)
                canvas.drawCircle(30f, 38f, 17f, brush)
                canvas.drawCircle(52f, 26f, 24f, brush)
                canvas.drawCircle(76f, 40f, 18f, brush)
                stroke(3.5f)
                canvas.drawLine(22f, 55f, 78f, 55f, brush)
                canvas.drawLine(22f, 70f, 78f, 70f, brush)
            }
            "playback" -> {
                canvas.drawRoundRect(10f, 12f, 90f, 87f, 16f, 16f, brush)
                val play = Path().apply { moveTo(39f, 29f); lineTo(39f, 72f); lineTo(73f, 50f); close() }
                brush.shader = null; brush.color = Color.WHITE; brush.style = Paint.Style.FILL
                canvas.drawPath(play, brush)
                stroke(); canvas.drawRoundRect(10f, 12f, 90f, 87f, 16f, 16f, brush)
            }
            "epg" -> {
                canvas.drawRoundRect(13f, 20f, 87f, 86f, 12f, 12f, brush)
                stroke(4f)
                canvas.drawLine(15f, 39f, 85f, 39f, brush)
                canvas.drawLine(34f, 10f, 34f, 29f, brush)
                canvas.drawLine(68f, 10f, 68f, 29f, brush)
                brush.style = Paint.Style.FILL; brush.color = 0xFFF7E8FF.toInt()
                for (x in listOf(31f, 49f, 67f)) for (y in listOf(55f, 70f))
                    canvas.drawCircle(x, y, 4f, brush)
            }
            "security" -> {
                val shield = Path().apply {
                    moveTo(50f, 7f); lineTo(87f, 24f); lineTo(82f, 63f)
                    cubicTo(76f, 78f, 62f, 89f, 50f, 95f)
                    cubicTo(38f, 88f, 24f, 77f, 18f, 63f)
                    lineTo(13f, 24f); close()
                }
                canvas.drawPath(shield, brush)
                stroke(); canvas.drawPath(shield, brush)
                canvas.drawRoundRect(38f, 47f, 62f, 74f, 6f, 6f, brush)
                canvas.drawArc(RectF(41f, 30f, 59f, 61f), 185f, 170f, false, brush)
            }
            "appearance" -> {
                canvas.drawOval(RectF(8f, 14f, 89f, 91f), brush)
                brush.shader = null; brush.color = 0xFF3E125F.toInt()
                for (p in arrayOf(25f to 44f, 48f to 29f, 73f to 45f, 30f to 70f))
                    canvas.drawCircle(p.first, p.second, 7f, brush)
                stroke(5f)
                canvas.drawLine(70f, 70f, 92f, 95f, brush)
            }
            "account" -> {
                canvas.drawCircle(50f, 32f, 21f, brush)
                canvas.drawRoundRect(14f, 60f, 86f, 91f, 22f, 22f, brush)
                stroke(); canvas.drawCircle(50f, 32f, 21f, brush)
            }
            "notifications" -> {
                val bell = Path().apply {
                    moveTo(23f, 71f); lineTo(33f, 61f); lineTo(33f, 35f)
                    cubicTo(33f, 8f, 67f, 8f, 67f, 35f)
                    lineTo(67f, 61f); lineTo(77f, 71f); close()
                }
                canvas.drawPath(bell, brush)
                canvas.drawCircle(50f, 79f, 8f, brush)
                stroke(); canvas.drawPath(bell, brush)
            }
            "storage" -> {
                canvas.drawOval(RectF(12f, 12f, 88f, 42f), brush)
                canvas.drawRect(12f, 26f, 88f, 74f, brush)
                canvas.drawOval(RectF(12f, 59f, 88f, 91f), brush)
                stroke(); canvas.drawOval(RectF(12f, 12f, 88f, 42f), brush)
                canvas.drawArc(RectF(12f, 59f, 88f, 91f), 0f, 180f, false, brush)
            }
            else -> {
                canvas.drawCircle(50f, 50f, 42f, brush)
                brush.shader = null; brush.color = 0xFF381667.toInt(); brush.style = Paint.Style.FILL
                brush.textSize = 57f
                brush.typeface = android.graphics.Typeface.DEFAULT_BOLD
                brush.textAlign = Paint.Align.CENTER
                canvas.drawText("i", 50f, 69f, brush)
                stroke(); canvas.drawCircle(50f, 50f, 42f, brush)
            }
        }
        canvas.restoreToCount(save)
    }
    override fun setAlpha(alpha: Int) { brush.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) { brush.colorFilter = colorFilter }
    @Deprecated("Android drawable API")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    override fun getIntrinsicWidth(): Int = 100
    override fun getIntrinsicHeight(): Int = 100
}
