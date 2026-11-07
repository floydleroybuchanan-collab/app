package com.streamflixreborn.streamflix.fragments.settings

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import androidx.preference.Preference
import androidx.preference.PreferenceGroup
import androidx.preference.PreferenceGroupAdapter
import androidx.preference.PreferenceManager
import androidx.preference.PreferenceScreen
import androidx.preference.SwitchPreferenceCompat
import androidx.recyclerview.widget.RecyclerView
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.charm.CharmDesign
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk=[35], application=Application::class, qualifiers="w960dp-h540dp-land-mdpi")
class CharmSettingsLayoutTest {
    private fun activity() = Robolectric.buildActivity(FragmentActivity::class.java).also { it.get().setTheme(R.style.AppTheme_Tv); it.get().theme.applyStyle(androidx.leanback.preference.R.style.PreferenceThemeOverlayLeanback, true) }.setup().get()
    private fun layout(view: View) {
        view.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(540,View.MeasureSpec.EXACTLY));view.layout(0,0,960,540)
        shadowOf(Looper.getMainLooper()).idle()
        view.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(540,View.MeasureSpec.EXACTLY));view.layout(0,0,960,540)
    }
    @Test fun everySettingsSectionInflatesAndRendersItsNativeControls() {
        val activity=activity()
        val manager=PreferenceManager(activity)
        val screen=manager.inflateFromResource(activity,R.xml.settings_tv,null)
        CharmSettingsLayout.prepare(screen)
        val pages=(0 until screen.preferenceCount).map { screen.getPreference(it) }.filterIsInstance<PreferenceScreen>()
        assertEquals(9,pages.size)
        for(page in listOf(screen)+pages) {
            val list=RecyclerView(activity)
            val design=CharmSettingsLayout(list) { _,_ -> }
            list.adapter=PreferenceGroupAdapter(page)
            activity.setContentView(design.root)
            design.show(if(page===screen)null else page.key,page.title?.toString())
            layout(design.root)
            assertTrue("Rows for ${page.key}",list.childCount>0)
            assertTrue(list.width>400)
            val frame=FrameLayout(activity).apply {
                setBackgroundColor(0xFF0C0715.toInt())
                (design.root.parent as? android.view.ViewGroup)?.removeView(design.root)
                addView(design.root,FrameLayout.LayoutParams(-1,-1))
            }
            layout(frame)
            val image=Bitmap.createBitmap(960,540,Bitmap.Config.ARGB_8888)
            frame.draw(Canvas(image))
            java.io.File("build/charm-design-checks").mkdirs()
            java.io.File("build/charm-design-checks/"+(page.key?:"settings")+".png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG,100,it) }
            image.recycle()
            assertTrue("Native settings root fills its host", design.root is FrameLayout)
            assertEquals("No percentage banner inset", 0, design.root.paddingTop)
            assertFalse("One scroll owner", list.isNestedScrollingEnabled)
            assertTrue("Content uses available width", list.width >= 900)
            assertTrue("Content uses available height", list.height >= 350)
            for(position in 0 until list.adapter!!.itemCount) {
                list.scrollToPosition(position)
                layout(frame)
                val holder=list.findViewHolderForAdapterPosition(position)
                assertNotNull("Reachable settings row ${page.key}:$position",holder)
                val child=holder!!.itemView
                assertTrue("Row intersects viewport",child.bottom>0 && child.top<list.height)
                assertTrue("Row fits horizontally",child.left>=0 && child.right<=list.width)
            }
            for(i in 0 until list.childCount) {
                val child=list.getChildAt(i)
                assertTrue("No horizontal overflow",child.right<=list.width)
                assertNotNull("page=${page.key} row=$i position=${list.getChildAdapterPosition(child)} class=${child.javaClass.name} id=${child.id}",child.findViewById<View>(android.R.id.title))
            }
        }
    }
    @Test fun overviewKeepsSettingsDestinationsWithoutASecondNavigationRail() {
        val activity=activity()
        val manager=PreferenceManager(activity)
        val screen=manager.inflateFromResource(activity,R.xml.settings_tv,null)
        CharmSettingsLayout.prepare(screen)
        val list=RecyclerView(activity)
        val design=CharmSettingsLayout(list) { _,_ -> }
        list.adapter=PreferenceGroupAdapter(screen)
        activity.setContentView(design.root)
        design.show(null,null)
        layout(design.root)
        val expected=setOf("screen_connected_accounts", "screen_vod_sources", "screen_content",
            "screen_playback", "screen_appearance", "screen_network", "screen_provider",
            "screen_cloud_sync", "screen_backup")
        assertEquals(expected,(0 until screen.preferenceCount).map { screen.getPreference(it) }.filterIsInstance<PreferenceScreen>().map { it.key }.toSet())
        fun descendants(view: View): List<View> = listOf(view) +
            (if(view is android.view.ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList())
        assertEquals("One scrolling list",1,descendants(design.root).count { it is RecyclerView })
        assertFalse("No outer scrolling box",descendants(design.root).any { it is androidx.core.widget.NestedScrollView || it is android.widget.ScrollView })
    }
    @Test fun settingCardsKeepActionsAndSwitchPersistence() {
        val activity=activity(); val manager=PreferenceManager(activity)
        val screen=manager.createPreferenceScreen(activity)
        var called=0
        val action=Preference(activity).apply {key="test_action"; title="Open account";setOnPreferenceClickListener {called++;true}}
        val toggle=SwitchPreferenceCompat(activity).apply {key="test_toggle";title="Quick Play"}
        screen.addPreference(action);screen.addPreference(toggle);CharmSettingsLayout.prepare(screen)
        val adapter=PreferenceGroupAdapter(screen);val parent=FrameLayout(activity)
        for(i in 0 until adapter.itemCount) {val holder=adapter.onCreateViewHolder(parent,adapter.getItemViewType(i));adapter.onBindViewHolder(holder,i); if(adapter.getItem(i) === toggle) assertNotNull("Toggle widget must be visible",holder.itemView.findViewById<View>(androidx.preference.R.id.switchWidget));holder.itemView.performClick()}
        assertEquals(1,called);assertTrue(toggle.isChecked)
        assertTrue(manager.sharedPreferences!!.getBoolean("test_toggle",false))
    }
    @Test fun visibleTrailerAndMyListStayOrderedInsideNarrowViewports() {
        val activity=activity()
        for(resource in listOf(R.layout.content_movie_tv,R.layout.content_tv_show_tv)) {
            for(width in listOf(805,600)) {
                for(trailerVisible in listOf(true,false)) {
                    val view=LayoutInflater.from(activity).inflate(resource,null)
                    val movie=resource==R.layout.content_movie_tv
                    val watch=view.findViewById<View>(if(movie) R.id.btn_movie_watch_now else R.id.btn_tv_show_watch_now)
                    val trailer=view.findViewById<View>(if(movie) R.id.btn_movie_trailer else R.id.btn_tv_show_trailer)
                    trailer.visibility=if(trailerVisible) View.VISIBLE else View.GONE
                    CharmDesign.styleTree(view)
                    view.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED))
                    view.layout(0,0,width,view.measuredHeight)
                    val actions=listOf(watch,view.findViewById<View>(R.id.charm_detail_sources),trailer,
                        view.findViewById<View>(R.id.charm_detail_my_list)).filter { it.visibility==View.VISIBLE }
                    for(button in actions) {
                        assertTrue("Action must fit width="+width+" right="+button.right,button.left>=0 && button.right<=width)
                        assertTrue(button.width>0)
                        assertEquals("Uniform action row",watch.top,button.top)
                        assertEquals("Uniform action height",watch.height,button.height)
                    }
                    for((left,right) in actions.zipWithNext()) assertTrue("Actions must not overlap at width="+width,left.right < right.left)
                }
            }
        }
    }
}
