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
        // Preserve the approved banner and extend its straight rail before the lower bend.
        canvas.save()
        canvas.clipRect(0f, 0f, width.toFloat(), height * .28f)
        canvas.drawBitmap(artwork, null, target, paint)
        canvas.restore()
        canvas.save()
        canvas.scale(1f, 1.56f, width * .5f, height * .26f)
        canvas.clipRect(0f, height * .26f, width * .12f, height * .61f)
        canvas.drawBitmap(artwork, null, target, paint)
        canvas.restore()
        canvas.save()
        canvas.translate(0f, height * .21f)
        canvas.clipRect(0f, height * .59f, width * .12f, height.toFloat())
        canvas.drawBitmap(artwork, null, target, paint)
        canvas.restore()
    }
}
