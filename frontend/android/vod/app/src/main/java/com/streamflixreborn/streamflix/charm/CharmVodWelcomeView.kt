package com.streamflixreborn.streamflix.charm

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.provider.Settings
import android.util.AttributeSet
import android.view.KeyEvent
import android.view.View
import android.view.animation.LinearInterpolator
import com.streamflixreborn.streamflix.R
import kotlin.math.min

/** Local, finite entrance animation: no network, player, timer loop, or loading dependency. */
class CharmVodWelcomeView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    // A single bounded bitmap, decoded once for this finite entrance view.
    private val entrance = BitmapFactory.decodeResource(resources, R.drawable.medialab_vod_entrance)
    private val artBounds = RectF(0f, 0f, 960f, 540f)
    private val regular = Typeface.create("sans-serif", Typeface.NORMAL)
    private val bold = Typeface.create("sans-serif", Typeface.BOLD)
    private var progress = 0f
    private var animator: ValueAnimator? = null
    private var completion: (() -> Unit)? = null
    private val welcome = context.getString(R.string.charm_vod_welcome)
    private val title = context.getString(R.string.charm_vod_control_center)
    private val skip = context.getString(R.string.charm_vod_skip)

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        contentDescription = "Charming MediaLab. $welcome $title. $skip"
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
        paint.shader = null
        paint.style = Paint.Style.FILL
        paint.alpha = 255
        canvas.drawBitmap(entrance, null, artBounds, paint)
        // Glints travel inward along the artwork's purple lanes; no extra decoder or surface.
        val travel = (progress * 2f) % 1f
        paint.color = Color.rgb(243, 208, 255)
        for (lane in 0..2) {
            val x = 70f + travel * 380f
            val y = 192f + lane * 10f
            paint.alpha = ((1f - travel) * 150).toInt()
            canvas.drawCircle(x, y, 1.8f, paint)
            canvas.drawCircle(960f - x, y, 1.8f, paint)
        }
        val reveal = (progress / .15f).coerceIn(0f, 1f)
        drawText(canvas, title, 466f, 22f, Color.WHITE, reveal, true)
        paint.color = Color.rgb(80, 43, 100)
        paint.alpha = 230
        canvas.drawRoundRect(345f, 483f, 615f, 486f, 1.5f, 1.5f, paint)
        paint.color = Color.rgb(213, 152, 255)
        canvas.drawRoundRect(345f, 483f, 345f + 270f * progress, 486f, 1.5f, 1.5f, paint)
        drawText(canvas, skip, 511f, 11f, Color.rgb(199, 181, 214), reveal)
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
