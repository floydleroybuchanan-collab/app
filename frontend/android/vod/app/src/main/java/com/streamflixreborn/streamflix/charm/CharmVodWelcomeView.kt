package com.streamflixreborn.streamflix.charm

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.provider.Settings
import android.util.AttributeSet
import android.view.KeyEvent
import android.view.View
import android.view.animation.LinearInterpolator
import com.streamflixreborn.streamflix.R
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/** Local, finite entrance animation: no network, player, timer loop, or loading dependency. */
class CharmVodWelcomeView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val logo = BitmapFactory.decodeResource(resources, R.drawable.charm_living_room,
        BitmapFactory.Options().apply { inSampleSize = 2 })
    private val logoBounds = RectF(358f, 70f, 602f, 314f)
    private val logoShader = BitmapShader(logo, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
        setLocalMatrix(Matrix().apply {
            setRectToRect(RectF(0f, 0f, logo.width.toFloat(), logo.height.toFloat()), logoBounds, Matrix.ScaleToFit.CENTER)
        })
    }
    private val orbit = RectF(340f, 52f, 620f, 332f)
    private val glow = RadialGradient(480f, 215f, 370f,
        intArrayOf(Color.rgb(58, 23, 100), Color.rgb(7, 7, 17)), null, Shader.TileMode.CLAMP)
    private val regular = Typeface.create("sans-serif", Typeface.NORMAL)
    private val bold = Typeface.create("sans-serif", Typeface.BOLD)
    private var progress = 0f
    private var animator: ValueAnimator? = null
    private var completion: (() -> Unit)? = null
    private val welcome = context.getString(R.string.charm_vod_welcome)
    private val title = context.getString(R.string.charm_vod_control_center)
    private val caption = context.getString(R.string.charm_vod_welcome_caption)
    private val skip = context.getString(R.string.charm_vod_skip)

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        contentDescription = "CharmIPTV. $welcome $title. $skip"
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        setOnClickListener { dismiss() }
    }

    fun play(onFinished: () -> Unit) {
        completion = onFinished
        // areAnimatorsEnabled was added in API 26. Respect reduced motion on API 24/25 too.
        val animationsEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ValueAnimator.areAnimatorsEnabled()
        } else {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
        }
        if (!animationsEnabled) {
            dismiss()
            return
        }
        visibility = VISIBLE
        alpha = 1f
        progress = 0f
        requestFocus()
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 2600L
            interpolator = LinearInterpolator()
            addUpdateListener {
                progress = it.animatedValue as Float
                alpha = ((1f - progress) / 0.12f).coerceIn(0f, 1f)
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) = dismiss()
            })
            start()
        }
    }

    fun dismiss() {
        val finished = completion
        completion = null
        animator?.removeAllListeners()
        animator?.removeAllUpdateListeners()
        animator?.cancel()
        animator = null
        visibility = GONE
        finished?.invoke()
    }

    override fun onDetachedFromWindow() {
        // Do not move focus into an activity that is being destroyed.
        completion = null
        dismiss()
        super.onDetachedFromWindow()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode in KeyEvent.KEYCODE_DPAD_UP..KeyEvent.KEYCODE_DPAD_RIGHT) return true
        if (keyCode in intArrayOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_NUMPAD_ENTER)) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode in KeyEvent.KEYCODE_DPAD_UP..KeyEvent.KEYCODE_DPAD_RIGHT) return true
        if (keyCode in intArrayOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_NUMPAD_ENTER)) {
            performClick()
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.rgb(7, 7, 17))
        val scale = min(width / 960f, height / 540f)
        canvas.save()
        canvas.translate((width - 960f * scale) / 2f, (height - 540f * scale) / 2f)
        canvas.scale(scale, scale)
        paint.shader = glow
        paint.style = Paint.Style.FILL
        paint.alpha = 255
        canvas.drawRect(0f, 0f, 960f, 540f, paint)
        paint.shader = null
        // Sparse orbiting points and two light trails stay inexpensive on TV hardware.
        paint.color = Color.rgb(183, 108, 255)
        for (i in 0 until 18) {
            val angle = i * 2.39996 + progress * 0.45
            val radius = 150f + (i % 5) * 30f
            paint.alpha = 45 + (i % 4) * 25
            canvas.drawCircle(480f + cos(angle).toFloat() * radius * 1.6f,
                210f + sin(angle).toFloat() * radius * 0.68f, 1.3f + i % 2, paint)
        }
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.5f
        paint.alpha = 160
        canvas.drawArc(orbit, -130f + progress * 85f, 94f, false, paint)
        paint.color = Color.rgb(244, 197, 104)
        canvas.drawArc(orbit, 65f + progress * 85f, 34f, false, paint)
        paint.style = Paint.Style.FILL
        paint.alpha = (255 * (progress / 0.18f).coerceIn(0f, 1f)).toInt()
        canvas.save()
        val zoom = 0.94f + 0.06f * (progress / 0.28f).coerceIn(0f, 1f)
        canvas.scale(zoom, zoom, 480f, 192f)
        // Render the supplied artwork through an antialiased circle, not a square bitmap.
        // The source image remains unchanged; its rectangular corners never paint.
        paint.shader = logoShader
        canvas.drawCircle(logoBounds.centerX(), logoBounds.centerY(), logoBounds.width() / 2f, paint)
        paint.shader = null
        canvas.restore()
        val reveal = ((progress - 0.10f) / 0.20f).coerceIn(0f, 1f)
        drawText(canvas, welcome, 338f, 16f, Color.rgb(193, 170, 225), reveal)
        drawText(canvas, title, 375f, 28f, Color.WHITE, reveal, true)
        drawText(canvas, caption, 409f, 14f, Color.rgb(170, 163, 189), reveal)
        paint.color = Color.rgb(168, 85, 247)
        paint.alpha = (reveal * 180).toInt()
        canvas.drawRoundRect(430f, 438f, 530f, 440f, 1f, 1f, paint)
        drawText(canvas, skip, 490f, 11f, Color.rgb(134, 126, 151), reveal)
        canvas.restore()
    }

    private fun drawText(canvas: Canvas, value: String, y: Float, size: Float,
                         color: Int, opacity: Float, strong: Boolean = false) {
        paint.color = color
        paint.alpha = (255 * opacity).toInt()
        paint.textAlign = Paint.Align.CENTER
        paint.typeface = if (strong) bold else regular
        paint.textSize = size
        canvas.drawText(value, 480f, y + (1f - opacity) * 8f, paint)
    }
}
