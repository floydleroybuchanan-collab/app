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
import kotlin.math.cos
import kotlin.math.sin

/**
 * Transparent, lightweight vector icons for genre cards. No bitmap decode,
 * texture allocation or external artwork fetch on RecyclerView bind.
 * Home and Platforms artwork remain completely untouched.
 */
class CharmingVodGenreIcon(private val category: String) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val a: Int
    private val b: Int

    init {
        val pair = when (category) {
            "action" -> 0xFFFFBA24.toInt() to 0xFFFF3476.toInt()
            "comedy" -> 0xFF00DAFF.toInt() to 0xFFFF9A2E.toInt()
            "drama" -> 0xFF4DD9FF.toInt() to 0xFFED28D7.toInt()
            "horror" -> 0xFFFF72EA.toInt() to 0xFFAA35FE.toInt()
            "scifi" -> 0xFF0EF5FC.toInt() to 0xFF7345FC.toInt()
            "family" -> 0xFFFFBE32.toInt() to 0xFFF22A9A.toInt()
            "thriller" -> 0xFF12E7F3.toInt() to 0xFFFF417A.toInt()
            "documentary" -> 0xFF2CE7FF.toInt() to 0xFF8B39FC.toInt()
            "animation" -> 0xFFFF5CE8.toInt() to 0xFF0ECAFF.toInt()
            "romance" -> 0xFFF735CB.toInt() to 0xFFFF90C8.toInt()
            else -> 0xFF18DBFA.toInt() to 0xFFCF3AFF.toInt()
        }
        a = pair.first
        b = pair.second
    }

    private fun gradient() {
        paint.style = Paint.Style.FILL
        paint.shader = LinearGradient(12f, 10f, 87f, 92f, a, b, Shader.TileMode.CLAMP)
        paint.color = Color.WHITE
    }

    private fun line(color: Int = 0xCCFFFFFF.toInt(), width: Float = 3f) {
        paint.shader = null
        paint.style = Paint.Style.STROKE
        paint.color = color
        paint.strokeWidth = width
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND
    }

    private fun circle(canvas: Canvas, x: Float, y: Float, radius: Float) =
        canvas.drawCircle(x, y, radius, paint)

    override fun draw(canvas: Canvas) {
        if (bounds.isEmpty) return
        val saved = canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 100f, bounds.height() / 100f)

        gradient()
        when (category) {
            "action" -> {
                val star = Path()
                for (n in 0 until 16) {
                    val theta = n * Math.PI / 8 - Math.PI / 2
                    val rad = if (n % 2 == 0) 44.0 else 21.0
                    val x = 50 + (rad * cos(theta)).toFloat()
                    val y = 50 + (rad * sin(theta)).toFloat()
                    if (n == 0) star.moveTo(x, y) else star.lineTo(x, y)
                }
                star.close()
                canvas.drawPath(star, paint)
                line(); canvas.drawPath(star, paint)
            }
            "comedy" -> {
                circle(canvas, 50f, 51f, 40f)
                line(); circle(canvas, 50f, 51f, 40f)
                paint.style = Paint.Style.FILL; paint.color = 0xFF30205D.toInt()
                circle(canvas, 36f, 42f, 5f); circle(canvas, 64f, 42f, 5f)
                line(0xFF392362.toInt(), 5f)
                canvas.drawArc(RectF(26f, 33f, 74f, 77f), 20f, 140f, false, paint)
            }
            "drama" -> {
                canvas.drawRoundRect(12f, 18f, 58f, 77f, 17f, 17f, paint)
                canvas.drawRoundRect(42f, 28f, 91f, 89f, 18f, 18f, paint)
                line(); canvas.drawRoundRect(42f, 28f, 91f, 89f, 18f, 18f, paint)
                line(0xFF32114D.toInt(), 4f)
                canvas.drawArc(RectF(51f, 47f, 81f, 75f), 202f, 136f, false, paint)
            }
            "horror" -> {
                canvas.drawOval(RectF(18f, 9f, 82f, 72f), paint)
                canvas.drawRoundRect(32f, 62f, 68f, 87f, 8f, 8f, paint)
                paint.shader = null; paint.style = Paint.Style.FILL
                paint.color = 0xFF260B45.toInt()
                circle(canvas, 36f, 43f, 10f); circle(canvas, 64f, 43f, 10f)
                val nose = Path().apply { moveTo(50f, 49f); lineTo(43f, 63f); lineTo(57f, 63f); close() }
                canvas.drawPath(nose, paint)
                line(0xFF350C5B.toInt(), 3f)
                canvas.drawLine(39f, 72f, 39f, 85f, paint)
                canvas.drawLine(50f, 72f, 50f, 85f, paint)
                canvas.drawLine(61f, 72f, 61f, 85f, paint)
            }
            "scifi" -> {
                circle(canvas, 50f, 50f, 29f)
                line(0xFFF9CAFF.toInt(), 4f)
                val ringSave = canvas.save()
                canvas.rotate(-28f, 50f, 50f)
                canvas.drawOval(RectF(5f, 38f, 95f, 65f), paint)
                canvas.restoreToCount(ringSave)
            }
            "family" -> {
                circle(canvas, 33f, 34f, 14f)
                circle(canvas, 67f, 34f, 14f)
                canvas.drawRoundRect(14f, 51f, 47f, 85f, 14f, 14f, paint)
                canvas.drawRoundRect(53f, 51f, 86f, 85f, 14f, 14f, paint)
                line(0xFFE6FBFF.toInt(), 3f)
                canvas.drawLine(49f, 63f, 49f, 86f, paint)
            }
            "thriller" -> {
                circle(canvas, 50f, 50f, 40f)
                line(0xFF320C5A.toInt(), 5f)
                circle(canvas, 50f, 50f, 29f)
                circle(canvas, 50f, 50f, 16f)
                line(0xFFECFCFF.toInt(), 3f)
                canvas.drawLine(50f, 3f, 50f, 97f, paint)
                canvas.drawLine(3f, 50f, 97f, 50f, paint)
            }
            "documentary" -> {
                canvas.drawRoundRect(9f, 25f, 67f, 78f, 12f, 12f, paint)
                val lens = Path().apply { moveTo(67f, 40f); lineTo(92f, 26f); lineTo(92f, 82f); lineTo(67f, 69f); close() }
                canvas.drawPath(lens, paint)
                line(); canvas.drawRoundRect(9f, 25f, 67f, 78f, 12f, 12f, paint)
                canvas.drawLine(67f, 40f, 92f, 26f, paint)
            }
            "animation" -> {
                canvas.drawRoundRect(7f, 31f, 93f, 75f, 22f, 22f, paint)
                line(0xFFDAFFFF.toInt(), 4f)
                canvas.drawLine(24f, 52f, 43f, 52f, paint)
                canvas.drawLine(33f, 42f, 33f, 63f, paint)
                paint.style = Paint.Style.FILL; paint.color = 0xFF25145D.toInt()
                circle(canvas, 68f, 48f, 5f); circle(canvas, 79f, 59f, 5f)
            }
            "romance" -> {
                val heart = Path().apply {
                    moveTo(50f, 89f)
                    cubicTo(5f, 61f, 8f, 31f, 22f, 21f)
                    cubicTo(40f, 7f, 52f, 23f, 50f, 33f)
                    cubicTo(60f, 10f, 84f, 13f, 91f, 34f)
                    cubicTo(96f, 55f, 71f, 73f, 50f, 89f)
                    close()
                }
                canvas.drawPath(heart, paint)
                line(); canvas.drawPath(heart, paint)
            }
            else -> {
                canvas.drawRoundRect(14f, 18f, 86f, 82f, 19f, 19f, paint)
                line(); canvas.drawRoundRect(14f, 18f, 86f, 82f, 19f, 19f, paint)
            }
        }
        canvas.restoreToCount(saved)
    }

    override fun setAlpha(alpha: Int) { paint.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter }
    @Deprecated("Android drawable API")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    override fun getIntrinsicWidth(): Int = 100
    override fun getIntrinsicHeight(): Int = 100
}
