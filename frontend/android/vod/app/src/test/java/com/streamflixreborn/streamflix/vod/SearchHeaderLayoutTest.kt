package com.streamflixreborn.streamflix.vod

import android.app.Application
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.constraintlayout.widget.ConstraintLayout
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.charm.CharmVodPageLayout
import com.streamflixreborn.streamflix.fragments.search.SearchTvFragment
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], application=Application::class, qualifiers="w960dp-h540dp-land-mdpi")
@ConscryptMode(ConscryptMode.Mode.OFF)
class SearchHeaderLayoutTest {
    @Test fun controlsStayBelowArtworkAndAboveResultsAtMultipleSizes() {
        for ((width,height) in listOf(960 to 540,720 to 480,1280 to 720)) {
            val controller=Robolectric.buildActivity(FragmentActivity::class.java)
            controller.get().setTheme(R.style.AppTheme_Tv)
            val activity=controller.setup().get()
            val fragment=SearchTvFragment()
            activity.supportFragmentManager.beginTransaction().add(fragment,"search").setMaxLifecycle(fragment,Lifecycle.State.CREATED).commitNow()
            val root=fragment.onCreateView(activity.layoutInflater,null,null) as ConstraintLayout
            val host=android.widget.FrameLayout(activity)
            host.addView(root,android.widget.FrameLayout.LayoutParams(width,height))
            activity.setContentView(host)
            CharmVodPageLayout.attach(fragment,root)
            repeat(4) {
                root.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY))
                root.layout(0,0,width,height);shadowOf(Looper.getMainLooper()).idle()
            }
            val grid=root.findViewById<View>(R.id.vgv_search)
            var header:View=root.findViewById(R.id.et_search)
            while(header.parent !== root) header=header.parent as View
            val controls=header.getFocusables(View.FOCUS_FORWARD).filter { it.isShown }
            assertTrue("Search controls must remain on page",controls.isNotEmpty())
            for(control in controls) {
                val bounds=android.graphics.Rect();control.getDrawingRect(bounds);root.offsetDescendantRectToMyCoords(control,bounds)
                assertTrue("Below banner: $width $bounds id=${control.id} type=${control.javaClass.simpleName} text=${(control as? TextView)?.text} grid=${grid.top}",bounds.top>=height*.28f)
                assertTrue("Above results: $width $bounds / ${grid.top}",bounds.bottom<=grid.top)
                assertTrue("Inside width: $width $bounds",bounds.left>=0&&bounds.right<=width)
            }
            assertTrue("Usable results height",grid.height>height*.3f)
            controller.pause().stop().destroy()
        }
    }
}
