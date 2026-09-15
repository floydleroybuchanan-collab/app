package com.streamflixreborn.streamflix.charm

import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentManager
import androidx.recyclerview.widget.RecyclerView
import com.streamflixreborn.streamflix.R

/** Shared app-owned chrome. Playback surfaces and focus listeners remain owned by their screens. */
object CharmDesign {
    private const val PANEL = 0xFF10101E.toInt()
    private const val RAISED = 0xFF151427.toInt()
    private const val PURPLE = 0xFF7C3AED.toInt()
    private const val BORDER = 0xFF3B3560.toInt()
    private var regular: Typeface? = null
    private var semibold: Typeface? = null
    private fun dp(view: View, value: Int) = (value * view.resources.displayMetrics.density).toInt()

    fun install(activity: FragmentActivity) {
        activity.supportFragmentManager.registerFragmentLifecycleCallbacks(object : FragmentManager.FragmentLifecycleCallbacks() {
            override fun onFragmentViewCreated(manager: FragmentManager, fragment: Fragment, view: View, state: Bundle?) {
                if (fragment.javaClass.simpleName.endsWith("TvFragment") &&
                    !fragment.javaClass.simpleName.startsWith("Player")) {
                    view.setBackgroundColor(Color.TRANSPARENT)
                    CharmVodPageLayout.attach(fragment, view)
                }
                styleTree(view)
            }
        }, true)
    }

    private fun shape(view: View, color: Int, stroke: Int, width: Int = 1): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(view, 16).toFloat()
        setStroke(dp(view, width), stroke)
    }

    private fun buttonBackground(view: View, primary: Boolean): StateListDrawable = StateListDrawable().apply {
        addState(intArrayOf(-android.R.attr.state_enabled), shape(view, PANEL, BORDER))
        addState(intArrayOf(android.R.attr.state_focused), shape(view, PURPLE, Color.WHITE, 2))
        addState(intArrayOf(android.R.attr.state_pressed), shape(view, PURPLE, Color.WHITE, 2))
        addState(intArrayOf(android.R.attr.state_selected), shape(view, 0xFF25143F.toInt(), PURPLE))
        addState(intArrayOf(), if (primary) GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0xFF9E42E8.toInt(), 0xFF6320AF.toInt())).apply {
                cornerRadius = dp(view, 22).toFloat()
                setStroke(dp(view, 1), 0xFFE1CEF4.toInt())
            } else shape(view, RAISED, BORDER))
    }

    fun styleTree(root: View) {
        if (regular == null) regular = ResourcesCompat.getFont(root.context, R.font.charm_geist_regular)
        if (semibold == null) semibold = ResourcesCompat.getFont(root.context, R.font.charm_geist_semibold)
        val pending = java.util.ArrayDeque<View>()
        pending.add(root)
        while (pending.isNotEmpty()) {
            val view = pending.removeFirst()
            val name = try { view.resources.getResourceEntryName(view.id) } catch (_: Exception) { "" }
            if (view is TextView) {
                view.typeface = if (view.typeface?.isBold == true || view is Button || name.contains("title") || name.contains("header")) semibold else regular
                if (view.currentTextColor == Color.BLACK) view.setTextColor(Color.WHITE)
                if (name.contains("title") || name.contains("header")) view.setTextColor(0xFFECEBF2.toInt())
                if (view is EditText) {
                    view.backgroundTintList = ColorStateList.valueOf(PURPLE)
                    view.setTextColor(Color.WHITE)
                    view.setHintTextColor(0xFFAAA7BB.toInt())
                }
            }
            val action = view is Button || name.startsWith("btn_") || name.startsWith("charm_detail_") || view is android.widget.ImageButton
            if (action) {
                view.background = buttonBackground(view, name.contains("watch_now") || name.contains("resume"))
                view.minimumHeight = dp(view, 42)
                view.minimumWidth = dp(view, 42)
                if (view is TextView) {
                    view.isAllCaps = false
                    view.textSize = 14f
                    view.setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(0xFF827C90.toInt(), Color.WHITE)))
                    view.setPadding(dp(view, 18), dp(view, 10), dp(view, 18), dp(view, 10))
                }
                if (view is ImageView) view.imageTintList = ColorStateList.valueOf(Color.WHITE)
            }
            if (view is ProgressBar) {
                view.progressTintList = ColorStateList.valueOf(PURPLE)
                view.indeterminateTintList = ColorStateList.valueOf(PURPLE)
            }
            if (view is ImageView && (name.contains("poster") || name.contains("episode_image") || name.contains("people_image") || name.contains("season_image"))) {
                view.outlineProvider = object : ViewOutlineProvider() {
                    override fun getOutline(target: View, outline: Outline) {
                        outline.setRoundRect(0, 0, target.width, target.height, dp(target, if (name.contains("people")) 24 else 10).toFloat())
                    }
                }
                view.clipToOutline = true
            }
            if (view is RecyclerView && view.getTag(R.id.charm_design_recycler) != true) {
                view.setTag(R.id.charm_design_recycler, true)
                view.addOnChildAttachStateChangeListener(object : RecyclerView.OnChildAttachStateChangeListener {
                    override fun onChildViewAttachedToWindow(child: View) = styleTree(child)
                    override fun onChildViewDetachedFromWindow(child: View) = Unit
                })
            }
            if (view is ViewGroup) for (index in 0 until view.childCount) pending.add(view.getChildAt(index))
        }
    }

    fun prepareDialog(dialog: Dialog) {
        val decor = dialog.window?.decorView ?: return
        dialog.window?.setBackgroundDrawable(shape(decor, PANEL, BORDER))
        dialog.window?.setDimAmount(0.82f)
        val apply = { styleTree(decor) }
        if (decor.isAttachedToWindow) decor.post(apply)
        else decor.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) { view.removeOnAttachStateChangeListener(this); view.post(apply) }
            override fun onViewDetachedFromWindow(view: View) = Unit
        })
    }
}

class CharmDialogBuilder(context: Context, themeResId: Int = R.style.CharmDialog_Compat) : androidx.appcompat.app.AlertDialog.Builder(context, themeResId) {
    override fun create(): androidx.appcompat.app.AlertDialog = super.create().also(CharmDesign::prepareDialog)
}

class CharmPlatformDialogBuilder(context: Context, themeResId: Int = R.style.CharmDialog_Framework) : android.app.AlertDialog.Builder(context, themeResId) {
    override fun create(): android.app.AlertDialog = super.create().also(CharmDesign::prepareDialog)
}
