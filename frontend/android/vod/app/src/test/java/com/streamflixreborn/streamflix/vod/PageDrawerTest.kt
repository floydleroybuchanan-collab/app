package com.streamflixreborn.streamflix.vod

import android.app.Application
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.FragmentActivity
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.charm.CharmPageDrawer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], application=Application::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
class PageDrawerTest {
    @Test fun drawerClaimsFocusAndRestoresOriginEvenWhenClosedImmediately() {
        val controller=Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity=controller.setup().visible().get()
        val root=ConstraintLayout(activity);activity.setContentView(root)
        val button=Button(activity).apply { isFocusableInTouchMode=true;text="Poster";id=View.generateViewId() }
        root.addView(button,ConstraintLayout.LayoutParams(200,80))
        val drawer=CharmPageDrawer(activity,root)
        activity.window.decorView.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(540,View.MeasureSpec.EXACTLY));activity.window.decorView.layout(0,0,960,540)
        shadowOf(Looper.getMainLooper()).idle();assertTrue("Poster must take initial focus",button.requestFocus());assertSame("Activity must own poster",button,root.findFocus());drawer.open();shadowOf(Looper.getMainLooper()).idle()
        val dialog=ShadowDialog.getLatestDialog()
        assertTrue(dialog.isShowing);assertEquals("Close menu ×",(dialog.currentFocus as Button).text.toString())
        dialog.dismiss();shadowOf(Looper.getMainLooper()).idle()
        assertTrue("Restore origin: shown=${button.isShown}, attached=${button.isAttachedToWindow}, current=${activity.currentFocus}",button.isFocused);assertFalse(dialog.isShowing)
        controller.pause().stop().destroy()
    }
    @Test fun rightOnlyOpensAtRowEndAndNeverFromHeldNavigation() {
        val controller=Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity=controller.setup().visible().get();val root=ConstraintLayout(activity);activity.setContentView(root)
        val grid=androidx.recyclerview.widget.RecyclerView(activity).apply {
            layoutManager=androidx.recyclerview.widget.GridLayoutManager(activity,4)
            adapter=object: androidx.recyclerview.widget.RecyclerView.Adapter<androidx.recyclerview.widget.RecyclerView.ViewHolder>() {
                override fun getItemCount()=8
                override fun onCreateViewHolder(parent: android.view.ViewGroup,type:Int)=object:androidx.recyclerview.widget.RecyclerView.ViewHolder(Button(activity).apply { isFocusableInTouchMode=true;layoutParams=androidx.recyclerview.widget.RecyclerView.LayoutParams(120,70) }){}
                override fun onBindViewHolder(holder:androidx.recyclerview.widget.RecyclerView.ViewHolder,position:Int){(holder.itemView as Button).text="Poster $position"}
            }
        };root.addView(grid,ConstraintLayout.LayoutParams(480,300))
        val drawer=CharmPageDrawer(activity,root)
        activity.window.decorView.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(540,View.MeasureSpec.EXACTLY));activity.window.decorView.layout(0,0,960,540);shadowOf(Looper.getMainLooper()).idle()
        fun press(action:Int,time:Long,repeat:Int=0)=drawer.dispatch(KeyEvent(time,time,action,KeyEvent.KEYCODE_DPAD_RIGHT,repeat))
        assertTrue(grid.findViewHolderForAdapterPosition(2)!!.itemView.requestFocus())
        assertFalse(press(KeyEvent.ACTION_DOWN,1000));assertFalse(press(KeyEvent.ACTION_UP,1010))
        assertFalse(press(KeyEvent.ACTION_DOWN,1100)) // Quick taps between posters never open it.
        assertTrue(grid.findViewHolderForAdapterPosition(3)!!.itemView.requestFocus())
        assertFalse(press(KeyEvent.ACTION_DOWN,1150,1)) // Held navigation arriving at edge.
        assertFalse(press(KeyEvent.ACTION_UP,1200))
        assertTrue(press(KeyEvent.ACTION_DOWN,1500))
        assertTrue(ShadowDialog.getLatestDialog().isShowing)
        ShadowDialog.getLatestDialog().dismiss();shadowOf(Looper.getMainLooper()).idle()
        assertTrue(grid.findViewHolderForAdapterPosition(3)!!.itemView.isFocused)
        controller.pause().stop().destroy()
    }
    @Test fun menuFollowsPlayerControllerVisibility() {
        val controller=Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity=controller.setup().visible().get();val root=ConstraintLayout(activity);activity.setContentView(root)
        val playerView=androidx.media3.ui.PlayerView(activity);root.addView(playerView,ConstraintLayout.LayoutParams(960,540))
        val drawer=CharmPageDrawer(activity,root)
        val menu=(0 until root.childCount).map(root::getChildAt).filterIsInstance<Button>().single()
        drawer.bindPlayerControls(playerView)
        playerView.showController();assertEquals(View.VISIBLE,menu.visibility)
        playerView.hideController();shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(1));assertEquals(View.GONE,menu.visibility)
        playerView.showController();assertEquals(View.VISIBLE,menu.visibility)
        controller.pause().stop().destroy()
    }
}
