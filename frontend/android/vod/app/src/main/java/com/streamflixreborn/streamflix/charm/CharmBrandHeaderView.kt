package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.utils.ThemeManager
import com.streamflixreborn.streamflix.utils.UserPreferences

/** The IPTV banner is composed directly into the VOD chrome, without a card or image frame. */
class CharmBrandHeaderView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val target = RectF()
    private val backdrop = CharmBrandBackdrop()
    private val banner: Bitmap by lazy {
        BitmapFactory.decodeResource(resources, R.drawable.medialab_banner_blend,
            BitmapFactory.Options().apply { inSampleSize = 2; inScaled = false })
    }

    init { isFocusable = false; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        backdrop.setBounds(0, 0, w, h)
        val inset = if (w > h * 5) 20f * resources.displayMetrics.density else 0f
        val availableWidth = (w - inset * 2).coerceAtLeast(1f)
        val scale = minOf(availableWidth / banner.width, h.toFloat() / banner.height)
        val drawHeight = banner.height * scale
        target.set(inset, (h - drawHeight) / 2f, inset + banner.width * scale, (h + drawHeight) / 2f)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (UserPreferences.selectedTheme == ThemeManager.DEFAULT) backdrop.draw(canvas)
        canvas.drawBitmap(banner, null, target, paint)
    }
}
