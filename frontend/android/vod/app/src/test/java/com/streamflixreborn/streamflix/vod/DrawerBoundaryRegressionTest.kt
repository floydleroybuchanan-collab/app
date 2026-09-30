package com.streamflixreborn.streamflix.vod

import android.app.Application
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.FragmentActivity
import androidx.recyclerview.widget.RecyclerView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.leanback.widget.HorizontalGridView
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
@Config(sdk=[24,35], application=Application::class, qualifiers="w960dp-h540dp-land-mdpi")
@ConscryptMode(ConscryptMode.Mode.OFF)
class DrawerBoundaryRegressionTest {
    private fun layout(root: View) {
        root.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(540,View.MeasureSpec.EXACTLY))
        root.layout(0,0,960,540);shadowOf(Looper.getMainLooper()).idle()
    }
    @Test fun nestedButtonRowsNavigateRightBeforeOpeningAndRestoreTheLastButton() {
        val controller=Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity=controller.setup().visible().get()
        val root=ConstraintLayout(activity);activity.setContentView(root)
        val rows=RecyclerView(activity).apply {
            layoutManager=LinearLayoutManager(activity)
            adapter=object:RecyclerView.Adapter<RecyclerView.ViewHolder>() {
                override fun getItemCount()=3
                override fun onCreateViewHolder(parent:ViewGroup,type:Int):RecyclerView.ViewHolder {
                    val row=LinearLayout(activity).apply {
                        orientation=LinearLayout.HORIZONTAL
                        layoutParams=RecyclerView.LayoutParams(700,100)
                        for(label in listOf("Watch now","My list","More details")) addView(Button(activity).apply {
                            text=label;isFocusableInTouchMode=true;id=View.generateViewId()
                        },LinearLayout.LayoutParams(180,80))
                    }
                    return object:RecyclerView.ViewHolder(row){}
                }
                override fun onBindViewHolder(holder:RecyclerView.ViewHolder,position:Int) {}
            }
        }
        root.addView(rows,ConstraintLayout.LayoutParams(700,400))
        val drawer=CharmPageDrawer(activity,root);layout(activity.window.decorView)
        fun key(action:Int,repeat:Int=0)=drawer.dispatch(KeyEvent(1000,1000,action,KeyEvent.KEYCODE_DPAD_RIGHT,repeat))
        for(position in 0..2) {
            val row=rows.findViewHolderForAdapterPosition(position)!!.itemView as LinearLayout
            for(index in 0..1) {
                assertTrue(row.getChildAt(index).requestFocus())
                assertFalse("RIGHT inside row $position must not open drawer",key(KeyEvent.ACTION_DOWN))
                assertFalse(key(KeyEvent.ACTION_UP))
            }
            val last=row.getChildAt(2);assertTrue(last.requestFocus())
            assertFalse(key(KeyEvent.ACTION_DOWN,1));assertFalse(key(KeyEvent.ACTION_UP))
            assertTrue("Fresh RIGHT at row $position end opens drawer",key(KeyEvent.ACTION_DOWN))
            assertTrue(key(KeyEvent.ACTION_UP))
            val dialog=ShadowDialog.getLatestDialog();assertTrue(dialog.isShowing)
            dialog.dismiss();shadowOf(Looper.getMainLooper()).idle();assertTrue(last.isFocused)
        }
        // The explicit top-right Menu remains an independent opening action.
        val menu=(0 until root.childCount).map(root::getChildAt).filterIsInstance<Button>().single { it.text.toString().contains("Menu") }
        menu.performClick();assertTrue(ShadowDialog.getLatestDialog().isShowing)
        ShadowDialog.getLatestDialog().dismiss();controller.pause().stop().destroy()
    }
    @Test fun leanbackShelfMustReachActualLastPosterNotJustLastVisiblePoster() {
        val controller=Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity=controller.setup().visible().get()
        val root=ConstraintLayout(activity);activity.setContentView(root)
        val shelf=HorizontalGridView(activity).apply {
            setNumRows(1)
            adapter=object:RecyclerView.Adapter<RecyclerView.ViewHolder>() {
                override fun getItemCount()=12
                override fun onCreateViewHolder(parent:ViewGroup,type:Int)=object:RecyclerView.ViewHolder(Button(activity).apply {isFocusableInTouchMode=true;layoutParams=RecyclerView.LayoutParams(140,100)}){}
                override fun onBindViewHolder(holder:RecyclerView.ViewHolder,position:Int) {(holder.itemView as Button).text="Poster $position"}
            }
        }
        root.addView(shelf,ConstraintLayout.LayoutParams(500,130))
        val drawer=CharmPageDrawer(activity,root);layout(activity.window.decorView)
        val first=shelf.findViewHolderForAdapterPosition(0)!!.itemView;assertTrue(first.requestFocus())
        assertFalse(drawer.dispatch(KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_RIGHT)))
        drawer.dispatch(KeyEvent(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_DPAD_RIGHT))
        val visible=(0 until shelf.childCount).map(shelf::getChildAt).filter{it.right<=shelf.width}.maxByOrNull{it.right}!!
        assertTrue(shelf.getChildAdapterPosition(visible)<11);visible.requestFocus()
        assertFalse(drawer.dispatch(KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_RIGHT)))
        drawer.dispatch(KeyEvent(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_DPAD_RIGHT))
        shelf.setSelectedPosition(11);layout(activity.window.decorView);shadowOf(Looper.getMainLooper()).idle()
        val last=shelf.findViewHolderForAdapterPosition(11)!!.itemView;assertTrue(last.requestFocus())
        assertTrue(drawer.dispatch(KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_RIGHT)))
        ShadowDialog.getLatestDialog().dismiss();controller.pause().stop().destroy()
    }
}
