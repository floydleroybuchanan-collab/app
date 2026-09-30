package com.streamflixreborn.streamflix.charm

import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.FragmentActivity
import androidx.navigation.fragment.NavHostFragment
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.streamflixreborn.streamflix.R

/** Space is reserved for the header: it never floats above the catalog. */
object CharmMobileChrome {
    internal fun styleGlassButton(button: Button) {
        CharmPageDrawer.glass(button)
        button.textSize = 14f
        button.setTypeface(button.typeface, android.graphics.Typeface.BOLD)
        button.setShadowLayer(2f * button.resources.displayMetrics.density, 0f, 1f, 0xCC000000.toInt())
        button.minWidth = 0; button.minimumWidth = 0
        button.setPadding(0, 0, 0, 0)
        button.minimumHeight = (48 * button.resources.displayMetrics.density).toInt()
        // Keep touch feedback visible while retaining the translucent fill.
        button.background = android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(0x44FFFFFF), button.background,
            android.graphics.drawable.ColorDrawable(android.graphics.Color.WHITE))
    }
    fun install(activity: FragmentActivity, root: ConstraintLayout) {
        val nav = (activity.supportFragmentManager.findFragmentById(R.id.nav_main_fragment) as? NavHostFragment)?.navController ?: return
        val dp = root.resources.displayMetrics.density
        val header = LinearLayout(activity).apply {
            id = View.generateViewId(); orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setBackgroundColor(0x6610101E)
        }
        val logo = ImageView(activity).apply { setImageResource(R.drawable.medialab_launcher); contentDescription = "Charming MediaLab" }
        header.addView(logo, LinearLayout.LayoutParams((44*dp).toInt(), (44*dp).toInt()))
        fun button(label: String, run: () -> Unit) = Button(activity).apply {
            text = label; isAllCaps = false; textSize = 12f; minWidth = 0; minimumWidth = 0
            styleGlassButton(this)
            setOnClickListener { run() }
            header.addView(this, LinearLayout.LayoutParams(0, (48*dp).toInt(), 1f).apply { setMargins((3*dp).toInt(), (4*dp).toInt(), (3*dp).toInt(), (4*dp).toInt()) })
        }
        button("Back") { activity.onBackPressedDispatcher.onBackPressed() }
        button("Search") { if (nav.currentDestination?.id != R.id.search) nav.navigate(R.id.search) }
        button("Menu") { CharmHostSession.leave(activity, "medialab:drawer") }
        root.addView(header, ConstraintLayout.LayoutParams(0, -2).apply { topToTop=0; startToStart=0; endToEnd=0 })
        val host = root.findViewById<View>(R.id.nav_main_fragment)
        (host.layoutParams as ConstraintLayout.LayoutParams).apply { topToTop=-1; topToBottom=header.id; host.layoutParams=this }
        val bottom = root.findViewById<BottomNavigationView>(R.id.bnv_main)
        bottom.menu.clear()
        bottom.menu.add(0, 91001, 0, "Home").setIcon(R.drawable.ic_menu_home)
        bottom.menu.add(0, 91002, 1, "Live").setIcon(R.drawable.ic_menu_tv)
        bottom.menu.add(0, R.id.home, 2, "Browse").setIcon(R.drawable.ic_menu_movie)
        bottom.menu.add(0, R.id.favorites, 3, "Library").setIcon(R.drawable.ic_favorite_enable)
        bottom.menu.add(0, 91003, 4, "More").setIcon(R.drawable.ic_menu_settings)
        bottom.setOnItemSelectedListener { item ->
            when(item.itemId) {
                91001 -> CharmHostSession.leave(activity, "/")
                91002 -> CharmHostSession.leave(activity, "/guide")
                91003 -> CharmHostSession.leave(activity, "medialab:drawer")
                else -> if(nav.currentDestination?.id != item.itemId) nav.navigate(item.itemId)
            }; true
        }
        nav.addOnDestinationChangedListener { _, destination, _ ->
            header.visibility = if(destination.id == R.id.player) View.GONE else View.VISIBLE
            bottom.menu.findItem(if(destination.id == R.id.favorites) R.id.favorites else R.id.home)?.isChecked = true
        }
    }
}
