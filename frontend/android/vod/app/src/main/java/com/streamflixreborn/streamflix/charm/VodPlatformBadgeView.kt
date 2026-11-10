package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.animation.ValueAnimator
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.TextView

/**
 * A platform's glass button artwork. On focus it rises toward the viewer and
 * glows in the button's own color, staying inside the row that holds it.
 */
class VodPlatformBadgeView(
    context: Context, val platform: VodPlatformCatalog.Platform,
    private val small: Boolean = false,
    private val pill: Boolean = false,
) : TextView(context) {
    private val artwork = CharmingPlatformArt(platform.id)
    private var glassArt: Drawable? = VodPlatformArt.of(platform.id)?.let {
        context.getDrawable(if (pill) it.viewAll else it.button)
    }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var glowLevel = 0f
    private var glowAnimator: ValueAnimator? = null
    private fun dp(value: Int) = (value * resources.displayMetrics.density + .5f).toInt()
    init {
        text = ""
        gravity = Gravity.CENTER
        maxLines = 1
        setTextColor(Color.WHITE)
        textSize = if (small) 15f else 20f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(if (small) 12 else 17), 0, dp(if (small) 12 else 17), 0)
        background = null
        elevation = dp(5).toFloat()
        isFocusable = false
        isClickable = false
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                val insetX = view.width / 8
                val insetY = view.height / 8
                outline.setRoundRect(insetX, insetY, view.width - insetX, view.height - insetY, dp(12).toFloat())
                outline.alpha = 1f
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            outlineSpotShadowColor = platform.tint
            outlineAmbientShadowColor = platform.tint
        }
    }

    /** Switches this button to the home row's original logo artwork. */
    fun useHomeArt() {
        VodPlatformArt.homeOf(platform.id)?.let { glassArt = context.getDrawable(if (pill) it.viewAll else it.button) }
    }



    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w <= 0 || h <= 0) return
        glowPaint.shader = RadialGradient(
            w / 2f, h / 2f, maxOf(w, h) * GLOW_REACH,
            intArrayOf(
                platform.tint and 0x00FFFFFF or 0xF2000000.toInt(),
                platform.tint and 0x00FFFFFF or 0x73000000,
                platform.tint and 0x00FFFFFF,
            ),
            floatArrayOf(0.25f, 0.68f, 1f),
            Shader.TileMode.CLAMP,
        )
        glassArt?.let { art ->
            val fit = minOf(w.toFloat() / art.intrinsicWidth, h.toFloat() / art.intrinsicHeight)
            val drawnW = (art.intrinsicWidth * fit).toInt()
            val drawnH = (art.intrinsicHeight * fit).toInt()
            art.setBounds((w - drawnW) / 2, (h - drawnH) / 2, (w + drawnW) / 2, (h + drawnH) / 2)
        }
    }

    override fun onDraw(canvas: Canvas) {
        if (glowLevel > 0f && glowPaint.shader != null) {
            glowPaint.alpha = (255 * glowLevel).toInt()
            // A flattened halo fades out before the row's edge instead of being cut by it.
            val reach = maxOf(width, height) * GLOW_REACH
            canvas.save()
            canvas.scale(1f, height * GLOW_HEIGHT / reach, width / 2f, height / 2f)
            canvas.drawCircle(width / 2f, height / 2f, reach, glowPaint)
            canvas.restore()
        }
        val glass = glassArt
        if (glass != null) {
            glass.draw(canvas)
        } else {
            artwork.setBounds(0, 0, width, height)
            artwork.draw(canvas)
        }
    }

    fun glass(focused: Boolean): Drawable =
        VodGlass.surface(platform.tint, dp(if (small) 12 else 17).toFloat(), dp(1), focused)
    /**
     * The 'View All' chip follows the *specific platform* glass palette,
     * rather than reusing the generic purple section action.
     * Pair the branded badge and its action without additional bitmaps.
     */
    fun viewAllGlass(focused: Boolean): Drawable {
        val tones = when (platform.id) {
            "netflix" -> intArrayOf(0xFFF82D55.toInt(), 0xFFD11060.toInt(), 0xFF7D124C.toInt())
            "disney" -> intArrayOf(0xFF13CCF4.toInt(), 0xFF056EDB.toInt(), 0xFF203593.toInt())
            "apple" -> intArrayOf(0xFFB7AFFA.toInt(), 0xFF7168B3.toInt(), 0xFF322854.toInt())
            "hulu" -> intArrayOf(0xFF1CE59C.toInt(), 0xFF06A788.toInt(), 0xFF155E76.toInt())
            "max" -> intArrayOf(0xFFCE4FFF.toInt(), 0xFF8735E3.toInt(), 0xFF561A96.toInt())
            "prime" -> intArrayOf(0xFF21CBF7.toInt(), 0xFF087CE4.toInt(), 0xFF1943AB.toInt())
            "paramount" -> intArrayOf(0xFF40B8FF.toInt(), 0xFF4267E8.toInt(), 0xFF3F3FA8.toInt())
            "peacock" -> intArrayOf(0xFFF67A50.toInt(), 0xFFE034A1.toInt(), 0xFF7D2FB0.toInt())
            "starz" -> intArrayOf(0xFF4CE4F8.toInt(), 0xFF147FCE.toInt(), 0xFF6727C8.toInt())
            "amc" -> intArrayOf(0xFF09E7E4.toInt(), 0xFF047EAE.toInt(), 0xFF2F348C.toInt())
            else -> intArrayOf(platform.tint, 0xFF683A9A.toInt(), 0xFF29183C.toInt())
        }
        return VodGlass.surface(tones[0], dp(9).toFloat(), dp(1), focused)
    }

    /** Rises toward the viewer with a shadow and lights up in the button's own color. */
    fun showFocus(focused: Boolean) {
        artwork.focused = focused
        glowAnimator?.cancel()
        glowAnimator = ValueAnimator.ofFloat(glowLevel, if (focused) 1f else 0f).apply {
            duration = 170L
            addUpdateListener {
                glowLevel = it.animatedValue as Float
                invalidate()
            }
            start()
        }
        VodHomeShelf.liftCard(this, focused)
    }

    override fun onDetachedFromWindow() {
        glowAnimator?.cancel()
        glowAnimator = null
        super.onDetachedFromWindow()
    }

    /** Makes this button a remote target that opens its platform's own screen. */
    fun asRemoteTarget(description: String, onOpen: () -> Unit, onFocused: (() -> Unit)? = null) {
        isFocusable = true
        isClickable = true
        contentDescription = description
        setOnClickListener { onOpen() }
        onFocusChangeListener = OnFocusChangeListener { _, focused ->
            showFocus(focused)
            if (focused) onFocused?.invoke()
        }
    }

    private companion object {
        const val GLOW_REACH = 0.6f
        const val GLOW_HEIGHT = 0.55f
    }
}
