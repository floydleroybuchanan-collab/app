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
    @Test fun doubleTapUsesTwoPressesNotHeldKeyRepeats() {
        val controller=Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity=controller.setup().visible().get();val root=ConstraintLayout(activity);activity.setContentView(root)
        val row=LinearLayout(activity).apply { orientation=LinearLayout.HORIZONTAL };root.addView(row,ConstraintLayout.LayoutParams(180,60))
        val target=Button(activity).apply { isFocusableInTouchMode=true;text="Last poster" };row.addView(target,LinearLayout.LayoutParams(180,60))
        val drawer=CharmPageDrawer(activity,root)
        activity.window.decorView.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(540,View.MeasureSpec.EXACTLY));activity.window.decorView.layout(0,0,960,540);shadowOf(Looper.getMainLooper()).idle();assertTrue("Action must take initial focus",target.requestFocus());assertSame("Activity must own action",target,root.findFocus())
        assertFalse(drawer.dispatch(KeyEvent(1000,1000,KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_RIGHT,0)))
        assertFalse(drawer.dispatch(KeyEvent(1000,1100,KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_RIGHT,1)))
        assertFalse(drawer.dispatch(KeyEvent(1000,1120,KeyEvent.ACTION_UP,KeyEvent.KEYCODE_DPAD_RIGHT,0)))
        assertTrue(drawer.dispatch(KeyEvent(1200,1200,KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_RIGHT,0)))
        assertTrue(ShadowDialog.getLatestDialog().isShowing)
        ShadowDialog.getLatestDialog().dismiss();controller.pause().stop().destroy()
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
