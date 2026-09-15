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
import com.streamflixreborn.streamflix.charm.CharmBrandHeaderView
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
        assertEquals(8,pages.size)
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
                addView(CharmBrandHeaderView(activity),FrameLayout.LayoutParams(-1,-1))
            }
            layout(frame)
            val image=Bitmap.createBitmap(960,540,Bitmap.Config.ARGB_8888)
            frame.draw(Canvas(image))
            java.io.File("build/charm-design-checks").mkdirs()
            java.io.File("build/charm-design-checks/"+(page.key?:"settings")+".png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG,100,it) }
            image.recycle()
            assertTrue(design.root.clipToPadding==false)
            for(i in 0 until list.childCount) {
                val child=list.getChildAt(i)
                assertTrue("No horizontal overflow",child.right<=list.width)
                assertNotNull("page=${page.key} row=$i position=${list.getChildAdapterPosition(child)} class=${child.javaClass.name} id=${child.id}",child.findViewById<View>(android.R.id.title))
            }
        }
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
    @Test fun detailActionsStayInsideTheViewport() {
        val activity=activity()
        for(resource in listOf(R.layout.content_movie_tv,R.layout.content_tv_show_tv)) {
            val view=LayoutInflater.from(activity).inflate(resource,null)
            val title=view.findViewById<android.widget.TextView>(if(resource==R.layout.content_movie_tv)R.id.tv_movie_title else R.id.tv_tv_show_title)
            title.text="A selected movie or television series"
            view.measure(View.MeasureSpec.makeMeasureSpec(805,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED));view.layout(0,0,805,view.measuredHeight)
            for(id in listOf(R.id.charm_detail_sources,R.id.charm_detail_more,R.id.charm_detail_my_list)) {
                val button=view.findViewById<View>(id)
                assertTrue("Action must fit: ${activity.resources.getResourceEntryName(id)} right=${button.right}",button.right<=805)
                assertTrue(button.width>0)
            }
        }
    }
}
