package com.streamflixreborn.streamflix.vod

import android.app.Application
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ListView
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.models.Video
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode

@RunWith(RobolectricTestRunner::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
@Config(sdk=[35], application=Application::class, qualifiers="land-hdpi")
class SourcePickerLayoutTest {
    private fun views(root: View): List<View> = listOf(root) + if (root is ViewGroup) (0 until root.childCount).flatMap { views(root.getChildAt(it)) } else emptyList()
    @Test fun compactControlsFilterAndRetainAUsableDialogAcrossResize() = verify(1f)
    @Test fun largeSystemTextFitsTheCompactControls() = verify(2f)
    private fun verify(fontScale: Float) {
        val controller = Robolectric.buildActivity(FragmentActivity::class.java)
        val resources = controller.get().resources
        val config = android.content.res.Configuration(resources.configuration).apply { this.fontScale = fontScale }
        resources.updateConfiguration(config, resources.displayMetrics)
        controller.get().setTheme(R.style.AppTheme_Tv)
        val activity = controller.setup().get()
        val fragment = Fragment()
        activity.supportFragmentManager.beginTransaction().add(fragment, "test").commitNow()
        val rows = MutableStateFlow(listOf(
            Video.Server("direct", "Direct stream"),
            Video.Server("cached", "Reported cached movie", details=SourceDetails(kind=SourceDetails.Kind.REAL_DEBRID, availability=SourceDetails.Availability.REPORTED_CACHED)),
            Video.Server("unknown", "Unverified movie", details=SourceDetails(kind=SourceDetails.Kind.REAL_DEBRID))))
        var retries = 0
        val dialog = SourcePicker.show(fragment, rows, MutableStateFlow("Ready"), true, { retries++ }, null, {})!!
        shadowOf(Looper.getMainLooper()).idle()
        val all = views(dialog.window!!.decorView)
        val list = all.filterIsInstance<ListView>().single()
        assertEquals("Cached-only must retain direct sources", 2, list.adapter.count)
        val buttons = all.filterIsInstance<Button>()
        val details = buttons.single { it.text == "Details" }
        val filters = buttons.filter { it.text.startsWith("Type:") || it.text.startsWith("Resolution:") || it.text.startsWith("Torrents:") }
        assertEquals(3, filters.size)
        filters.forEach { assertEquals(details.layoutParams.height, it.layoutParams.height) }
        filters.plus(details).forEach { button ->
            assertTrue("Button must fit its text and padding", button.layoutParams.height >= button.paint.fontMetricsInt.let { it.bottom - it.top } + button.paddingTop + button.paddingBottom)
        }
        assertTrue(details.requestFocus())
        assertTrue(details.isFocused)
        buttons.single { it.text == "Retry" }.performClick()
        assertEquals(2, retries)
        filters.single { it.text.startsWith("Torrents:") }.performClick()
        assertEquals(3, list.adapter.count)
        for ((width,height) in listOf(1280 to 720, 800 to 450, 480 to 800)) {
            activity.window.decorView.layout(0,0,width,height)
            shadowOf(Looper.getMainLooper()).idle()
            assertTrue(dialog.window!!.attributes.width in 1..width)
            assertTrue(dialog.window!!.attributes.height in 1..height)
        }
        controller.pause().stop()
        assertFalse(dialog.isShowing)
        controller.destroy()
    }
}
