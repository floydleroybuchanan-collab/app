package com.streamflixreborn.streamflix.charm

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.TypedValue
import android.view.KeyEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.view.animation.OvershootInterpolator
import android.widget.ImageView
import android.widget.TextView
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.constraintlayout.widget.ConstraintSet
import androidx.navigation.findNavController
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.databinding.ItemCategoryTvBinding
import com.streamflixreborn.streamflix.models.Category
import com.streamflixreborn.streamflix.models.TvShow

/**
 * The VOD home's landscape shelves. Sizes come from the approved 960x540 layout
 * and scale with the screen, so seven cards and two rows fit the first view.
 */
object VodHomeShelf {
    private const val CARD_WIDTH_DP = 120f
    private const val CARD_HEIGHT_DP = 72f
    private const val FOCUS_SCALE = 1.14f
    private const val FOCUS_LIFT_DP = 18f

    private fun View.px(valueDp: Float): Int {
        val metrics = resources.displayMetrics
        val heightDp = metrics.heightPixels / metrics.density
        return (valueDp * (heightDp / 540f).coerceIn(0.8f, 1.5f) * metrics.density + .5f).toInt()
    }

    fun styleRow(binding: ItemCategoryTvBinding, category: Category) {
        val title = binding.tvCategoryTitle
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        val bar = GradientDrawable().apply {
            setColor(0xFFA335F2.toInt())
            setSize(title.px(3f), title.px(15f))
        }
        title.setCompoundDrawablesRelativeWithIntrinsicBounds(bar, null, null, null)
        title.compoundDrawablePadding = title.px(7f)
        (title.layoutParams as ViewGroupMargins).apply {
            marginStart = title.px(8f)
            marginEnd = title.px(80f)
            title.layoutParams = this
        }

        binding.hgvCategory.apply {
            (layoutParams as ViewGroupMargins).apply {
                topMargin = px(5f)
                layoutParams = this
            }
            setPadding(px(8f), px(2f), px(20f), px(3f))
            setItemSpacing(px(5f))
        }

        binding.tvCategoryMore.visibility = View.VISIBLE
        binding.tvCategoryViewAll.apply {
            visibility = View.VISIBLE
            // Only reachable from inside its own row, so moving down the page
            // lands on posters and never stops on each row's header link.
            isFocusable = false
            val destination = if (category.list.firstOrNull() is TvShow) R.id.tv_shows else R.id.movies
            setOnClickListener { findNavController().navigate(destination) }
            // Back to the row's posters, never out to the rail from a header link.
            setOnKeyListener { _, code, event ->
                code == KeyEvent.KEYCODE_DPAD_LEFT && event.action == KeyEvent.ACTION_DOWN &&
                    binding.hgvCategory.requestFocus()
            }
            setOnFocusChangeListener { view, focused ->
                view.background = if (focused) linkFocus(view) else null
                if (!focused) refreshRowLink(view)
            }
        }
    }

    private fun linkFocus(view: View) =
        VodGlass.surface(0xFF9441D9.toInt(), view.px(9f).toFloat(), view.px(1f), true)

    private fun rowLink(card: View): View? =
        ((card.parent as? View)?.parent as? View)?.findViewById(R.id.tv_category_view_all)

    private fun refreshRowLink(link: View) {
        link.post { link.isFocusable = (link.parent as? View)?.hasFocus() == true }
    }

    fun styleCard(root: ConstraintLayout, poster: ImageView, title: TextView, vararg hidden: View) {
        hidden.forEach { it.visibility = View.GONE }
        val height = root.px(CARD_HEIGHT_DP)
        if (poster.layoutParams.height == height) return

        ConstraintSet().apply {
            clone(root)
            constrainWidth(poster.id, root.px(CARD_WIDTH_DP))
            constrainHeight(poster.id, height)
            setDimensionRatio(poster.id, null)
            clear(title.id, ConstraintSet.TOP)
            connect(title.id, ConstraintSet.BOTTOM, poster.id, ConstraintSet.BOTTOM, root.px(5f))
            connect(title.id, ConstraintSet.START, poster.id, ConstraintSet.START, root.px(6f))
            connect(title.id, ConstraintSet.END, poster.id, ConstraintSet.END, root.px(6f))
            applyTo(root)
        }
        poster.foreground = GradientDrawable(
            GradientDrawable.Orientation.BOTTOM_TOP,
            intArrayOf(0xD9000000.toInt(), 0x00000000),
        )
        title.setLines(1)
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f)
        title.setTypeface(title.typeface, Typeface.BOLD)
        title.setShadowLayer(4f, 0f, 1f, Color.BLACK)

        root.background = cardBackground(root, false)
        root.outlineProvider = ViewOutlineProvider.BACKGROUND
        root.clipToOutline = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            root.outlineSpotShadowColor = 0xFFB060FF.toInt()
            root.outlineAmbientShadowColor = 0xFF7A2FD0.toInt()
        }
    }

    private fun cardBackground(view: View, focused: Boolean) = GradientDrawable().apply {
        cornerRadius = view.px(6f).toFloat()
        setColor(0xFF1A1030.toInt())
        if (focused) setStroke(view.px(1.5f), Color.WHITE)
    }

    /** The card rises toward the viewer and casts a shadow onto the row beneath it. */
    fun liftCard(card: View, focused: Boolean) {
        card.animate().cancel()
        card.animate()
            .setStartDelay(0L)
            .scaleX(if (focused) FOCUS_SCALE else 1f)
            .scaleY(if (focused) FOCUS_SCALE else 1f)
            .translationZ(if (focused) card.px(FOCUS_LIFT_DP).toFloat() else 0f)
            .setInterpolator(OvershootInterpolator(if (focused) 1.4f else 0f))
            .setDuration(170L)
            .start()
    }

    fun focusCard(card: View, focused: Boolean) {
        card.background = cardBackground(card, focused)
        liftCard(card, focused)
        rowLink(card)?.let { link ->
            if (focused) link.isFocusable = true else refreshRowLink(link)
        }
    }

    /** Landscape art, at a size a card needs rather than the full-size original. */
    fun loadCard(poster: ImageView, banner: String?, fallback: String?) {
        val image = banner?.replace("/original/", "/w500/") ?: fallback
        Glide.with(poster)
            .load(image)
            .override(poster.px(CARD_WIDTH_DP), poster.px(CARD_HEIGHT_DP))
            .fallback(R.drawable.glide_fallback_cover)
            .centerCrop()
            .transition(DrawableTransitionOptions.withCrossFade())
            .into(poster)
    }
}

private typealias ViewGroupMargins = android.view.ViewGroup.MarginLayoutParams
