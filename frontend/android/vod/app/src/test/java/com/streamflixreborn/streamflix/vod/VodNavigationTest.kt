package com.streamflixreborn.streamflix.vod

import android.app.Application
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import androidx.fragment.app.FragmentActivity
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.charm.CharmDialogBuilder
import com.streamflixreborn.streamflix.charm.CharmNavigation
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
class VodNavigationTest {
    @Test fun backAndHomeHaveMatchingCompactBoundsAndRemainFocusable() {
        val controller = Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity = controller.setup().get()
        val row = CharmNavigation.controls(activity)
        activity.setContentView(row)
        row.measure(View.MeasureSpec.makeMeasureSpec(960, View.MeasureSpec.AT_MOST),
            View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.AT_MOST))
        row.layout(0, 0, row.measuredWidth, row.measuredHeight)
        val actions = buttons(row)
        assertEquals(2, actions.size)
        assertEquals(actions[0].measuredHeight, actions[1].measuredHeight)
        actions.forEach {
            assertTrue(it.requestFocus())
            assertTrue(it.measuredHeight >= it.paint.fontMetricsInt.let { metrics -> metrics.bottom - metrics.top })
        }
        controller.pause().stop().destroy()
    }

    private fun buttons(view: View): List<Button> = (if (view is Button) listOf(view) else emptyList()) +
        if (view is ViewGroup) (0 until view.childCount).flatMap { buttons(view.getChildAt(it)) } else emptyList()

    @Test fun modalBackCancelsButHomeDoesNotTriggerThePlayerBackCallback() {
        val controller = Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity = controller.setup().get()
        var cancelled = 0
        fun dialog() = CharmDialogBuilder(activity).setTitle("Sources")
            .setMessage("Choose a source").create().apply {
                setOnCancelListener { cancelled++ }; show()
                shadowOf(Looper.getMainLooper()).idle()
            }
        val first = dialog()
        val back = buttons(first.window!!.decorView).single { it.text == "Back" }
        assertTrue(back.requestFocus()); assertTrue(back.isFocused)
        back.performClick()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, cancelled); assertFalse(first.isShowing)
        val second = dialog()
        buttons(second.window!!.decorView).single { it.text == "VOD Home" }.performClick()
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(second.isShowing); assertEquals(1, cancelled)
        controller.pause().stop().destroy()
    }

    @Test fun nestedPlayerSettingsBackUsesItsOwnHandler() {
        val controller = Robolectric.buildActivity(FragmentActivity::class.java)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity = controller.setup().get()
        var calls = 0
        val row = CharmNavigation.controls(activity) { calls++ }
        activity.setContentView(row)
        buttons(row).single { it.text == "Back" }.performClick()
        assertEquals(1, calls); assertFalse(activity.isFinishing)
        controller.pause().stop().destroy()
    }
}
