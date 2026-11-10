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
 * Lightweight 7-icon vector artwork for the unified 10-foot VOD top bar.
 * Purple, cyan, hot pink and orange translucent glass, not stock Android glyphs.
 * A real focusable parent button owns navigation; these are artwork only.
 */
class CharmingVodTopIcon(
    private val kind: String,
    private val colorA: Int,
    private val colorB: Int,
) : Drawable() {
    private val brush = Paint(Paint.ANTI_ALIAS_FLAG)
    private fun fill(a: Int, b: Int, start: Float = 16f, end: Float = 88f) {
        brush.style = Paint.Style.FILL
        brush.shader = LinearGradient(start, 14f, end, 94f, a, b, Shader.TileMode.CLAMP)
        brush.color = Color.WHITE
        brush.strokeWidth = 1f
    }
    private fun stroke(color: Int = Color.WHITE, width: Float = 3f) {
        brush.shader = null
        brush.color = color
        brush.style = Paint.Style.STROKE
        brush.strokeWidth = width
        brush.strokeJoin = Paint.Join.ROUND
        brush.strokeCap = Paint.Cap.ROUND
    }
    private fun rect(canvas: Canvas, x: Float, y: Float, w: Float, h: Float, radius: Float) =
        canvas.drawRoundRect(x, y, x + w, y + h, radius, radius, brush)

    override fun draw(canvas: Canvas) {
        if (bounds.isEmpty) return
        val checkpoint = canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 100f, bounds.height() / 100f)
        // Behind every icon: a subtle colored bloom, no opaque button block.
        fill(colorB and 0x00FFFFFF or 0x45000000, colorA and 0x00FFFFFF or 0x24000000)
        canvas.drawCircle(50f, 53f, 36f, brush)
        when (kind) {
            "home" -> {
                fill(0xFF0AD7FF.toInt(), 0xFFFF4DA5.toInt())
                val roof = Path().apply {
                    moveTo(8f, 49f); lineTo(49f, 12f); lineTo(92f, 49f)
                    lineTo(83f, 59f); lineTo(75f, 53f); lineTo(75f, 87f)
                    lineTo(24f, 87f); lineTo(24f, 53f); lineTo(17f, 59f); close()
                }
                canvas.drawPath(roof, brush)
                stroke(0xFFE8C8FF.toInt(), 3f); canvas.drawPath(roof, brush)
                fill(0xFF8C26FA.toInt(), 0xFFFF7E1E.toInt())
                rect(canvas, 38f, 61f, 22f, 27f, 9f)
                stroke(0xFFF8DFFF.toInt(), 2f); canvas.drawRoundRect(38f, 61f, 60f, 90f, 9f, 9f, brush)
            }
            "search" -> {
                fill(0xFF0CAFFE.toInt(), 0xFFA224EB.toInt())
                canvas.drawCircle(44f, 44f, 31f, brush)
                stroke(0xFF8EF4FF.toInt(), 4.5f); canvas.drawCircle(44f, 44f, 31f, brush)
                fill(0xFF1738B6.toInt(), 0xFF3E1BC2.toInt())
                canvas.drawCircle(44f, 44f, 21f, brush)
                stroke(0xFFFFC2EF.toInt(), 4f); canvas.drawLine(66f, 67f, 90f, 90f, brush)
                stroke(0xFFFF9632.toInt(), 9f); canvas.drawLine(75f, 77f, 91f, 92f, brush)
            }
            "movies" -> {
                fill(0xFF15D6FC.toInt(), 0xFFF322AA.toInt())
                rect(canvas, 17f, 35f, 68f, 56f, 9f)
                stroke(0xFFFFA7E6.toInt(), 3f); canvas.drawRoundRect(17f, 35f, 85f, 91f, 9f, 9f, brush)
                fill(0xFF802EF4.toInt(), 0xFFFFA132.toInt())
                val clapper = Path().apply {
                    moveTo(14f, 28f); lineTo(78f, 12f); lineTo(83f, 31f); lineTo(18f, 47f); close()
                }
                canvas.drawPath(clapper, brush)
                stroke(0xFFEAD9FF.toInt(), 2.5f); canvas.drawPath(clapper, brush)
                fill(Color.WHITE, 0xFFEAD8FF.toInt())
                val play = Path().apply { moveTo(43f, 49f); lineTo(43f, 78f); lineTo(69f, 64f); close() }
                canvas.drawPath(play, brush)
            }
            "shows" -> {
                fill(0xFF00D8FA.toInt(), 0xFFB72AEE.toInt())
                rect(canvas, 9f, 29f, 82f, 55f, 12f)
                stroke(0xFFE6B9FF.toInt(), 4f); canvas.drawRoundRect(9f, 29f, 91f, 84f, 12f, 12f, brush)
                stroke(0xFF87F0FF.toInt(), 3.2f)
                canvas.drawLine(40f, 25f, 24f, 9f, brush)
                canvas.drawLine(58f, 25f, 74f, 9f, brush)
                canvas.drawLine(49f, 84f, 49f, 92f, brush)
                canvas.drawLine(32f, 93f, 66f, 93f, brush)
                brush.shader = null; brush.style = Paint.Style.FILL
                brush.color = Color.WHITE; brush.textSize = 30f; brush.isFakeBoldText = true
                brush.textAlign = Paint.Align.CENTER
                canvas.drawText("TV", 49f, 66f, brush)
                brush.isFakeBoldText = false
            }
            "favorites" -> {
                fill(0xFF423EEF.toInt(), 0xFFF43A91.toInt())
                rect(canvas, 10f, 26f, 54f, 54f, 13f)
                fill(0xFFB822FF.toInt(), 0xFFFF884C.toInt())
                rect(canvas, 30f, 21f, 58f, 57f, 13f)
                fill(0xFFFFA9E0.toInt(), 0xFFFF3D96.toInt())
                val heart = Path().apply {
                    moveTo(50f, 79f)
                    cubicTo(37f, 65f, 22f, 54f, 24f, 39f)
                    cubicTo(26f, 21f, 42f, 19f, 50f, 35f)
                    cubicTo(62f, 17f, 79f, 24f, 77f, 42f)
                    cubicTo(75f, 55f, 61f, 68f, 50f, 79f); close()
                }
                canvas.drawPath(heart, brush)
                stroke(Color.WHITE, 2.5f); canvas.drawPath(heart, brush)
            }
            "genres" -> {
                val rotated = canvas.save()
                canvas.rotate(34f, 38f, 49f)
                fill(0xFFFFAE2F.toInt(), 0xFFEB28BA.toInt())
                rect(canvas, 13f, 17f, 42f, 65f, 10f)
                stroke(0xFFFFE4C0.toInt(), 2.5f); canvas.drawRoundRect(13f, 17f, 55f, 82f, 10f, 10f, brush)
                canvas.restoreToCount(rotated)
                val turn = canvas.save()
                canvas.rotate(26f, 64f, 55f)
                fill(0xFF00D4FB.toInt(), 0xFF7336DA.toInt())
                rect(canvas, 42f, 19f, 39f, 65f, 9f)
                stroke(0xFFAEF4FF.toInt(), 2.4f); canvas.drawRoundRect(42f, 19f, 81f, 84f, 9f, 9f, brush)
                fill(0xFF150A3A.toInt(), 0xFF5B2BA1.toInt())
                canvas.drawCircle(61f, 31f, 4f, brush)
                canvas.restoreToCount(turn)
            }
            "platforms" -> {
                val outlines = listOf(
                    Triple(61f, 0xFF00D9FA.toInt(), 0xFF155EDB.toInt()),
                    Triple(44f, 0xFF653AEB.toInt(), 0xFFFF2FB8.toInt()),
                    Triple(27f, 0xFF5BDDFF.toInt(), 0xFF7928F9.toInt()),
                )
                outlines.forEach { (y, a, b) ->
                    fill(a, b)
                    val layer = Path().apply {
                        moveTo(50f, y - 20f); lineTo(92f, y - 6f); lineTo(50f, y + 13f)
                        lineTo(8f, y - 6f); close()
                    }
                    canvas.drawPath(layer, brush)
                    stroke(0xFFD2DFFF.toInt(), 2.5f); canvas.drawPath(layer, brush)
                }
            }
        }
        // Bright specular highlight that visually unifies the seven glyphs.
        stroke(0x55FFFFFF, 2f)
        canvas.drawArc(RectF(18f, 16f, 84f, 82f), 205f, 100f, false, brush)
        canvas.restoreToCount(checkpoint)
    }

    override fun setAlpha(alpha: Int) { brush.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) { brush.colorFilter = colorFilter }
    @Deprecated("Android drawable API")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    override fun getIntrinsicWidth() = 100
    override fun getIntrinsicHeight() = 100
}
