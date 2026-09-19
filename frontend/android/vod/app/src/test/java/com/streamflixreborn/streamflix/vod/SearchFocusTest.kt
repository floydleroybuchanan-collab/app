package com.streamflixreborn.streamflix.vod

import android.app.Application
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import androidx.fragment.app.FragmentActivity
import androidx.leanback.widget.VerticalGridView
import androidx.recyclerview.widget.RecyclerView
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.charm.CharmSearchFocus
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], application=Application::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
class SearchFocusTest {
    @Test fun remoteCanReachEveryControlAndReturnFromResults() {
        val controller=Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity=controller.setup().visible().get()
        val root=LinearLayout(activity).apply { orientation=LinearLayout.VERTICAL }
        activity.setContentView(root)
        val row=LinearLayout(activity);root.addView(row)
        val input=EditText(activity).apply { id=View.generateViewId();setText("Mobland") }
        row.addView(input,LinearLayout.LayoutParams(180,50))
        val actions=listOf("Clear","Voice","Search","Everything","Movies","TV shows","People","Genres").map { label ->
            Button(activity).apply { id=View.generateViewId();text=label;isFocusableInTouchMode=true;row.addView(this,LinearLayout.LayoutParams(85,50)) }
        }
        actions[1].visibility=View.GONE
        actions[0].setOnClickListener { input.setText("") }
        var searches=0
        actions[2].setOnClickListener { searches++ }
        val grid=VerticalGridView(activity).apply {
            id=View.generateViewId();setNumColumns(4)
            adapter=object:RecyclerView.Adapter<RecyclerView.ViewHolder>() {
                override fun getItemCount()=8
                override fun onCreateViewHolder(parent:ViewGroup,type:Int)=object:RecyclerView.ViewHolder(Button(activity).apply { isFocusableInTouchMode=true;layoutParams=RecyclerView.LayoutParams(120,70) }){}
                override fun onBindViewHolder(holder:RecyclerView.ViewHolder,position:Int){ (holder.itemView as Button).text="Title $position" }
            }
        }
        root.addView(grid,LinearLayout.LayoutParams(600,250))
        CharmSearchFocus.bind(input,actions,grid,{4},{searches++;true})
        activity.window.decorView.measure(View.MeasureSpec.makeMeasureSpec(960,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(540,View.MeasureSpec.EXACTLY))
        activity.window.decorView.layout(0,0,960,540);shadowOf(Looper.getMainLooper()).idle()
        fun press(key:Int){root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN,key));root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP,key));shadowOf(Looper.getMainLooper()).idle()}
        assertTrue(input.requestFocus())
        for(control in actions.filter { it.visibility==View.VISIBLE }) {
            press(KeyEvent.KEYCODE_DPAD_RIGHT);assertSame(control,root.findFocus())
        }
        press(KeyEvent.KEYCODE_DPAD_RIGHT);assertSame(actions.last(),root.findFocus())
        repeat(7){press(KeyEvent.KEYCODE_DPAD_LEFT)}
        assertSame(input,root.findFocus())
        press(KeyEvent.KEYCODE_DPAD_RIGHT);press(KeyEvent.KEYCODE_DPAD_CENTER)
        assertEquals("",input.text.toString())
        press(KeyEvent.KEYCODE_DPAD_RIGHT);assertSame(actions[2],root.findFocus())
        press(KeyEvent.KEYCODE_DPAD_CENTER);assertEquals(1,searches)
        press(KeyEvent.KEYCODE_DPAD_DOWN);assertTrue(grid.hasFocus())
        grid.selectedPosition=0;shadowOf(Looper.getMainLooper()).idle()
        press(KeyEvent.KEYCODE_DPAD_UP);assertSame(input,root.findFocus())
        press(KeyEvent.KEYCODE_DPAD_DOWN);assertTrue(grid.hasFocus())
        grid.selectedPosition=4;shadowOf(Looper.getMainLooper()).idle()
        press(KeyEvent.KEYCODE_DPAD_UP);assertTrue("Later rows must stay in results",grid.hasFocus())
        input.requestFocus();grid.adapter=null
        press(KeyEvent.KEYCODE_DPAD_DOWN);assertSame(input,root.findFocus())
        controller.pause().stop().destroy()
    }
}
