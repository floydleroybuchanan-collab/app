package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import com.streamflixreborn.streamflix.R

/** MediaLab's shared alpha banner and rail icon, each drawn without distortion. */
class CharmBrandHeaderView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val target = RectF()
    private val artwork by lazy { BitmapFactory.decodeResource(resources, R.drawable.medialab_banner,
        BitmapFactory.Options().apply { inScaled = false }) }
    private val icon by lazy { BitmapFactory.decodeResource(resources, R.drawable.medialab_launcher,
        BitmapFactory.Options().apply { inScaled = false }) }
    init { isFocusable = false; isClickable = false; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val bannerWidth = minOf(width * .52f, height * .65f)
        val bannerHeight = bannerWidth * artwork.height / artwork.width
        target.set(width * .17f, height * .035f, width * .17f + bannerWidth, height * .035f + bannerHeight)
        canvas.drawBitmap(artwork, null, target, paint)
        val iconSize = minOf(width * .085f, height * .15f)
        target.set(width * .025f, height * .05f, width * .025f + iconSize, height * .05f + iconSize)
        canvas.drawBitmap(icon, null, target, paint)
    }
}
