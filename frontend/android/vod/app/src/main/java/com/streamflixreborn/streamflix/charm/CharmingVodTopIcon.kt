package com.streamflixreborn.streamflix.charm

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Shader
import android.graphics.drawable.Drawable

/**
 * Glass line icons for the VOD top bar: a see-through body with a bright rim.
 * Drawn as vectors, so they cost no bitmap memory.
 */
class CharmingVodTopIcon(
    private val kind: String,
    @Suppress("UNUSED_PARAMETER") colorA: Int = 0,
    @Suppress("UNUSED_PARAMETER") colorB: Int = 0,
) : Drawable() {
    private val body = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        shader = LinearGradient(0f, 4f, 0f, 96f, 0x9EFFFFFF.toInt(), 0x1AFFFFFF, Shader.TileMode.CLAMP)
    }
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        color = 0xF2FFFFFF.toInt()
    }

    private fun Canvas.glass(path: Path) {
        drawPath(path, body)
        drawPath(path, rim)
    }

    private fun Canvas.glassRect(l: Float, t: Float, r: Float, b: Float, radius: Float) {
        drawRoundRect(l, t, r, b, radius, radius, body)
        drawRoundRect(l, t, r, b, radius, radius, rim)
    }

    override fun draw(canvas: Canvas) {
        if (bounds.isEmpty) return
        val checkpoint = canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 100f, bounds.height() / 100f)
        when (kind) {
            "home" -> canvas.glass(Path().apply {
                moveTo(50f, 8f); lineTo(96f, 50f); lineTo(82f, 50f); lineTo(82f, 92f)
                lineTo(60f, 92f); lineTo(60f, 62f); lineTo(40f, 62f); lineTo(40f, 92f)
                lineTo(18f, 92f); lineTo(18f, 50f); lineTo(4f, 50f); close()
            })
            "search" -> {
                canvas.drawCircle(42f, 42f, 30f, body)
                canvas.drawCircle(42f, 42f, 30f, rim)
                canvas.drawLine(65f, 65f, 92f, 92f, rim)
            }
            "movies" -> {
                canvas.glassRect(10f, 40f, 90f, 92f, 7f)
                canvas.glass(Path().apply {
                    moveTo(8f, 26f); lineTo(84f, 8f); lineTo(89f, 26f); lineTo(13f, 44f); close()
                })
                canvas.drawLine(30f, 21f, 36f, 38f, rim)
                canvas.drawLine(55f, 15f, 61f, 32f, rim)
                canvas.drawPath(Path().apply {
                    moveTo(42f, 54f); lineTo(42f, 80f); lineTo(64f, 67f); close()
                }, rim)
            }
            "shows" -> {
                canvas.glassRect(8f, 28f, 92f, 82f, 7f)
                canvas.drawLine(38f, 26f, 26f, 8f, rim)
                canvas.drawLine(60f, 26f, 72f, 8f, rim)
                canvas.drawLine(32f, 93f, 68f, 93f, rim)
            }
            "favorites" -> canvas.glass(Path().apply {
                moveTo(24f, 8f); lineTo(76f, 8f); lineTo(76f, 92f)
                lineTo(50f, 70f); lineTo(24f, 92f); close()
            })
            "genres" -> listOf(70f, 50f, 30f).forEach { y ->
                canvas.glass(Path().apply {
                    moveTo(50f, y - 22f); lineTo(92f, y - 2f); lineTo(50f, y + 18f)
                    lineTo(8f, y - 2f); close()
                })
            }
            "platforms" -> {
                canvas.glassRect(10f, 10f, 44f, 44f, 8f)
                canvas.glassRect(56f, 10f, 90f, 44f, 8f)
                canvas.glassRect(10f, 56f, 44f, 90f, 8f)
                canvas.glassRect(56f, 56f, 90f, 90f, 8f)
            }
        }
        canvas.restoreToCount(checkpoint)
    }

    override fun setAlpha(alpha: Int) {
        body.alpha = alpha
        rim.alpha = alpha
        invalidateSelf()
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        body.colorFilter = colorFilter
        rim.colorFilter = colorFilter
    }

    @Deprecated("Android drawable API")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    override fun getIntrinsicWidth() = 100
    override fun getIntrinsicHeight() = 100
}
