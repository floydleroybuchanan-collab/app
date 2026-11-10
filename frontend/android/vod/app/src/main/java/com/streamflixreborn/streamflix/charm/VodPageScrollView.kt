package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.view.KeyEvent
import android.widget.ScrollView

/**
 * ScrollView handles arrows itself and only scrolls when the next item is more
 * than half a screen away, which left Up apparently dead on tall VOD pages.
 * Here arrows always move focus, and the page follows the focused item.
 */
class VodPageScrollView(context: Context) : ScrollView(context) {
    override fun executeKeyEvent(event: KeyEvent): Boolean = when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN,
        KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> false
        else -> super.executeKeyEvent(event)
    }
}
