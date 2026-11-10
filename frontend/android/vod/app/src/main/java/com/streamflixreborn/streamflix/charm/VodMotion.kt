package com.streamflixreborn.streamflix.charm

import android.graphics.drawable.GradientDrawable
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator

/** The shared entrance motion and violet background of every VOD page. */
object VodMotion {
    private fun View.px(value: Int) = value * resources.displayMetrics.density

    fun background() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFF1B0A3C.toInt(), 0xFF0E0622.toInt(), 0xFF220B46.toInt()),
    )

    /** A page glides up and fades in as it opens. */
    fun page(view: View) {
        view.animate().cancel()
        view.alpha = 0f
        view.translationY = view.px(22)
        view.animate().alpha(1f).translationY(0f).setDuration(300L)
            .setInterpolator(DecelerateInterpolator(1.6f)).start()
    }

    /** Cards arrive one after another with a small spring. */
    fun stagger(view: View, index: Int) {
        view.alpha = 0f
        view.translationY = view.px(20)
        view.scaleX = .94f
        view.scaleY = .94f
        view.animate().alpha(1f).translationY(0f).scaleX(1f).scaleY(1f)
            .setStartDelay((index * 38L).coerceAtMost(420L)).setDuration(320L)
            .setInterpolator(OvershootInterpolator(1.1f)).start()
    }
}
