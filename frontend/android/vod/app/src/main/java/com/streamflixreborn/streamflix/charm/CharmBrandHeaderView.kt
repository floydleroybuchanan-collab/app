package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import com.streamflixreborn.streamflix.R

/** One alpha artwork joins the crown, banner and rail. Never paints an opaque header. */
class CharmBrandHeaderView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val target = RectF()
    private val artwork by lazy { BitmapFactory.decodeResource(resources, R.drawable.charm_vod_overlay,
        BitmapFactory.Options().apply { inScaled = false }) }
    init { isFocusable = false; isClickable = false; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        target.set(0f, 0f, width.toFloat(), height.toFloat())
        canvas.drawBitmap(artwork, null, target, paint)
    }
}
