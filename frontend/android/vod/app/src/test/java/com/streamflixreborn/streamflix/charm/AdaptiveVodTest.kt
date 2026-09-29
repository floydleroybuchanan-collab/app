package com.streamflixreborn.streamflix.charm

import android.app.Application
import android.view.ContextThemeWrapper
import android.view.View
import androidx.preference.PreferenceManager
import androidx.preference.PreferenceScreen
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.streamflixreborn.streamflix.R
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode

@RunWith(RobolectricTestRunner::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
@Config(sdk=[24,35], application=Application::class)
class AdaptiveVodTest {
    @Test fun phoneNavigationUsesACompatibleMaterialThemeAtNarrowAndTabletWidths() {
        val context = ContextThemeWrapper(RuntimeEnvironment.getApplication(), R.style.AppTheme_Mobile)
        val bar = BottomNavigationView(context)
        for ((i, title) in listOf("Home", "Live", "Browse", "Library", "More").withIndex()) bar.menu.add(0, 100+i, i, title)
        for (width in listOf(320, 412, 800)) {
            bar.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            bar.layout(0, 0, width, bar.measuredHeight)
            assertEquals(width, bar.measuredWidth)
            assertTrue(bar.measuredHeight >= 48)
            assertEquals(5, bar.menu.size())
        }
    }

    @Test fun accountsAndContentSettingsRemainSeparateOnTvAndMobile() {
        val context = ContextThemeWrapper(RuntimeEnvironment.getApplication(), R.style.AppTheme_Mobile)
        for (resource in listOf(R.xml.settings_mobile, R.xml.settings_tv)) {
            val screen = PreferenceManager(context).inflateFromResource(context, resource, null)
            val accounts = screen.findPreference<PreferenceScreen>("screen_connected_accounts")
            val sources = screen.findPreference<PreferenceScreen>("screen_vod_sources")
            assertNotNull(accounts)
            assertNotNull(sources)
            assertTrue(accounts!!.preferenceCount >= 5)
            assertTrue(sources!!.preferenceCount > 0)
        }
    }

    @Test fun sharedPlaybackProfilesProduceValidLoadControlOnOldAndNewAndroid() {
        for (profile in listOf("low_latency", "balanced", "stable")) {
            CharmSharedPlayback.configure("{\"buffer\":\"$profile\",\"size\":\"large\",\"background\":\"dim\"}")
            assertNotNull(CharmSharedPlayback.buffer(androidx.media3.exoplayer.DefaultLoadControl.Builder()).build())
        }
        CharmSharedPlayback.configure(null)
    }
}
