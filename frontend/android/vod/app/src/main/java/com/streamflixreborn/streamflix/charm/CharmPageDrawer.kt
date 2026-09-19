package com.streamflixreborn.streamflix.charm

import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.*
import android.widget.*
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.navigation.fragment.NavHostFragment
import androidx.media3.ui.PlayerView
import com.streamflixreborn.streamflix.R

/** Modal page controls: preserve real controls/listeners and restore the exact originating view. */
class CharmPageDrawer(private val activity: FragmentActivity, private val root: ConstraintLayout) {
    private data class Page(val title: String, val controls: List<View>)
    private val pages = java.util.WeakHashMap<View, Page>()
    private val nav get() = (activity.supportFragmentManager.findFragmentById(R.id.nav_main_fragment) as? NavHostFragment)
    private var dialog: Dialog? = null
    private var origin: View? = null
    private var rightHeld = false
    private var consumeRightUp = false
    private var playbackControls: PlayerView? = null
    private val menu = Button(activity).apply {
        id = View.generateViewId(); text = "☰ Menu"; isAllCaps = false; textSize = 12f
        isFocusable = true; setOnClickListener { open() }; glass(this)
    }
    init {
        root.addView(menu, ConstraintLayout.LayoutParams(-2, -2).apply {
            endToEnd = 0; topToTop = 0; marginEnd = dp(16); topMargin = dp(10)
        })
        menu.elevation = dp(9).toFloat()
        nav?.navController?.addOnDestinationChangedListener { _, destination, _ ->
            dialog?.dismiss()
            menu.visibility = if (destination.id == R.id.player) View.GONE else View.VISIBLE
            menu.bringToFront()
        }
        activity.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) { dialog?.dismiss(); rightHeld = false }
            override fun onDestroy(owner: LifecycleOwner) { instances.remove(activity) }
        })
    }
    private fun dp(n: Int) = (n * root.resources.displayMetrics.density).toInt()
    fun bindPlayerControls(playerView: PlayerView) {
        playbackControls = playerView
        fun update(visibility: Int) {
            if (playbackControls !== playerView) return
            val hadFocus = menu.hasFocus()
            menu.visibility = visibility
            if (visibility != View.VISIBLE && hadFocus) playerView.requestFocus()
        }
        playerView.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { update(it) })
        update(if (playerView.isControllerFullyVisible) View.VISIBLE else View.GONE)
    }
    private fun unbindPlayerControls(playerView: PlayerView) {
        playerView.setControllerVisibilityListener(null as PlayerView.ControllerVisibilityListener?)
        if (playbackControls === playerView) { playbackControls = null; menu.visibility = View.VISIBLE }
    }
    fun register(fragment: Fragment, title: String, controls: List<View>) {
        val view = fragment.view ?: return
        controls.forEach { (it.parent as? ViewGroup)?.removeView(it) }
        pages[view] = Page(title, controls)
        fragment.viewLifecycleOwner.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) { if (pages.remove(view) != null) dialog?.dismiss() }
        })
    }
    private fun activeView() = nav?.childFragmentManager?.primaryNavigationFragment?.view
    fun open() {
        if (dialog?.isShowing == true || activity.isFinishing || root.findViewById<View>(R.id.iv_splash_overlay)?.visibility == View.VISIBLE) return
        origin = activity.currentFocus ?: root.findFocus()
        rightHeld = false
        val page = pages[activeView()]
        val column = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(20)) }
        val scroll = ScrollView(activity).apply { isFillViewport = true; addView(column) }
        val d = Dialog(activity).also { dialog = it }
        d.setContentView(scroll)
        fun action(label: String, run: () -> Unit): Button = Button(activity).apply {
            text = label; isAllCaps = false; isFocusable = true; isFocusableInTouchMode = true; id = View.generateViewId(); glass(this)
            column.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
            setOnClickListener { d.dismiss(); run() }
        }
        column.addView(TextView(activity).apply { text = page?.title ?: "VOD Menu"; textSize = 21f; setTextColor(Color.WHITE); setPadding(0, 0, 0, dp(18)) })
        val close = action("Close menu ×") {}
        action("← Back") { CharmNavigation.back(activity) }
        action("⌂ VOD Home") { CharmNavigation.home(activity) }
        page?.controls?.forEach { control ->
            (control.parent as? ViewGroup)?.removeView(control)
            column.addView(control, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
            verticalControls(control)
        }
        val view = activeView()
        listOf(R.id.btn_movie_trailer to "Trailer", R.id.btn_tv_show_trailer to "Trailer", R.id.charm_detail_more to "More options").forEach { (id, label) ->
            view?.findViewById<View>(id)?.let { target -> action(label) { target.performClick() } }
        }
        if (nav?.navController?.currentDestination?.id == R.id.player) {
            action("Stop and exit player") { if (nav?.navController?.popBackStack() != true) CharmNavigation.home(activity) }
        }
        val window = d.window!!
        window.setBackgroundDrawable(GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xE0201030.toInt(), 0xE80D0B19.toInt())).apply { setStroke(dp(1), 0xFFC784F4.toInt()) })
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.setDimAmount(.16f)
        window.setGravity(Gravity.END)
        d.setOnShowListener {
            window.setLayout(maxOf(dp(280), (root.width * .32f).toInt()).coerceAtMost(root.width), WindowManager.LayoutParams.MATCH_PARENT)
            close.requestFocus()
            if (android.os.Build.VERSION.SDK_INT < 26 || android.animation.ValueAnimator.areAnimatorsEnabled()) {
                scroll.translationX = window.attributes.width.toFloat()
                scroll.animate().translationX(0f).setDuration(180).start()
            }
        }
        d.setOnDismissListener {
            page?.controls?.forEach { (it.parent as? ViewGroup)?.removeView(it) }
            dialog = null
            playbackControls?.showController()
            val prior = origin
            root.post { if (dialog == null) { if (prior?.isAttachedToWindow == true && prior.isShown && prior.isFocusable) prior.requestFocus() else menu.requestFocus() } }
        }
        d.setOnKeyListener { _, key, event ->
            if (key == KeyEvent.KEYCODE_DPAD_LEFT && event.action == KeyEvent.ACTION_DOWN && d.currentFocus !is EditText) { d.dismiss(); true }
            else if (key in listOf(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN) && event.action == KeyEvent.ACTION_DOWN && d.currentFocus !is EditText) {
                val items = column.getFocusables(View.FOCUS_FORWARD).filter { it.isShown && it.isEnabled }
                val index = items.indexOf(d.currentFocus)
                if (items.isNotEmpty()) items[(index + if (key == KeyEvent.KEYCODE_DPAD_DOWN) 1 else -1).coerceIn(0, items.lastIndex)].requestFocus()
                true
            } else false
        }
        d.show()
    }
    fun dispatch(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_DPAD_RIGHT) return false
        if (event.action == KeyEvent.ACTION_UP) {
            rightHeld = false
            if (consumeRightUp) { consumeRightUp = false; return true }
            return false
        }
        if (event.action != KeyEvent.ACTION_DOWN) return false
        val fresh = !rightHeld && event.repeatCount == 0
        rightHeld = true
        if (!fresh || dialog?.isShowing == true) return false
        val focus = activity.currentFocus ?: root.findFocus() ?: return false
        if (focus is EditText || focus is SeekBar) return false
        var parent = focus.parent
        while (parent != null && parent !is androidx.recyclerview.widget.RecyclerView) parent = parent.parent
        val grid = parent as? androidx.recyclerview.widget.RecyclerView ?: return false
        val item = grid.findContainingItemView(focus) ?: return false
        val position = grid.getChildAdapterPosition(item)
        val count = grid.adapter?.itemCount ?: return false
        if (position == androidx.recyclerview.widget.RecyclerView.NO_POSITION || count == 0) return false
        // Horizontal shelves must reach the actual final item, never just the viewport edge.
        if (grid.layoutManager?.canScrollHorizontally() == true) {
            if (position != count - 1) return false
        } else {
            val sameRowToRight = (0 until grid.childCount).map(grid::getChildAt).any {
                it !== item && it.left > item.left && kotlin.math.abs(it.top - item.top) < item.height / 2
            }
            if (sameRowToRight) return false
        }
        consumeRightUp = true
        open()
        return true
    }
    private fun verticalControls(view: View) {
        if (view is LinearLayout) view.orientation = LinearLayout.VERTICAL
        if (view is ViewGroup) for (i in 0 until view.childCount) verticalControls(view.getChildAt(i))
        if (view is TextView && view.isFocusable && view !is EditText) {
            glass(view)
            (view.layoutParams as? LinearLayout.LayoutParams)?.apply { width = -1; height = -2; bottomMargin = dp(8); weight = 0f; view.layoutParams = this }
        }
    }
    companion object {
        private val instances = java.util.WeakHashMap<FragmentActivity, CharmPageDrawer>()
        fun install(activity: FragmentActivity, root: ConstraintLayout) {
            val drawer = CharmPageDrawer(activity, root)
            instances[activity] = drawer
            // Restored player fragments can exist before the activity installs its chrome.
            val fragment = drawer.nav?.childFragmentManager?.primaryNavigationFragment
            fragment?.view?.findViewById<PlayerView>(R.id.pv_player)?.let { bindPlayer(fragment, it) }
        }
        fun register(fragment: Fragment, title: String, controls: List<View>) { instances[fragment.activity]?.register(fragment, title, controls) }
        fun bindPlayer(fragment: Fragment, playerView: PlayerView) {
            val drawer = instances[fragment.activity] ?: return
            drawer.bindPlayerControls(playerView)
            fragment.viewLifecycleOwner.lifecycle.addObserver(object : DefaultLifecycleObserver {
                override fun onDestroy(owner: LifecycleOwner) { drawer.unbindPlayerControls(playerView) }
            })
        }
        fun dispatch(activity: FragmentActivity, event: KeyEvent) = instances[activity]?.dispatch(event) ?: false
        fun glass(view: TextView) {
            val density = view.resources.displayMetrics.density
            fun shape(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xAAAD57D8.toInt(),0xBB4C236F.toInt()) else intArrayOf(0x444C305E,0x77231332)).apply {
                cornerRadii = floatArrayOf(5f,5f,14f,14f,5f,5f,14f,14f).map { it*density }.toFloatArray()
                setStroke((if(focused) 2*density else density).toInt().coerceAtLeast(1),if(focused) 0xFFF0D6FF.toInt() else 0x889D72B6.toInt())
            }
            view.backgroundTintList = null
            view.background = android.graphics.drawable.StateListDrawable().apply { addState(intArrayOf(android.R.attr.state_focused),shape(true));addState(intArrayOf(android.R.attr.state_selected),shape(true));addState(intArrayOf(),shape(false)) }
            view.setTextColor(Color.WHITE);view.textSize=13f;view.minimumHeight=(42*density).toInt();view.setPadding((14*density).toInt(),(8*density).toInt(),(14*density).toInt(),(8*density).toInt())
        }
    }
}
