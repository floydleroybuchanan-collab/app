package com.streamflixreborn.streamflix.charm

import android.view.KeyEvent
import android.view.View
import android.widget.EditText
import androidx.leanback.widget.VerticalGridView
import com.streamflixreborn.streamflix.R

/** Explicit TV remote routes: text cursor handling and Leanback must not trap focus. */
object CharmSearchFocus {
    fun bind(input: EditText, actions: List<View>, results: VerticalGridView, columns: () -> Int, submit: () -> Boolean) {
        val controls=listOf<View>(input)+actions
        fun available()=controls.filter { it.visibility==View.VISIBLE && it.isEnabled && it.isFocusable }
        controls.forEach { control ->
            control.nextFocusDownId=results.id
            control.setOnKeyListener { _, key, event ->
                if(event.action!=KeyEvent.ACTION_DOWN) return@setOnKeyListener false
                val row=available();val index=row.indexOf(control)
                when(key) {
                    KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        row.getOrNull(index+1)?.requestFocus()
                        true // Never send a right-edge search-control press into the poster drawer shortcut.
                    }
                    KeyEvent.KEYCODE_DPAD_LEFT -> {
                        if(index>0) row[index-1].requestFocus()
                        else input.rootView.findViewById<View>(R.id.nav_main)?.requestFocus()
                        true
                    }
                    KeyEvent.KEYCODE_DPAD_DOWN -> {
                        if(results.visibility==View.VISIBLE && (results.adapter?.itemCount?:0)>0) results.requestFocus()
                        true
                    }
                    KeyEvent.KEYCODE_DPAD_UP -> { if(control!==input) input.requestFocus();true }
                    KeyEvent.KEYCODE_ENTER,KeyEvent.KEYCODE_NUMPAD_ENTER,KeyEvent.KEYCODE_SEARCH -> if(control===input)submit() else false
                    else -> false
                }
            }
        }
        results.nextFocusUpId=input.id
        results.setOnKeyInterceptListener { event ->
            if(event.keyCode==KeyEvent.KEYCODE_DPAD_UP && results.selectedPosition in 0 until columns().coerceAtLeast(1)) {
                if(event.action==KeyEvent.ACTION_DOWN) input.requestFocus()
                true
            } else false
        }
    }
}
