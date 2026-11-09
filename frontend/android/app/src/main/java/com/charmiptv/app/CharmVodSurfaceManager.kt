package com.charmiptv.app

import android.view.View
import android.widget.FrameLayout
import androidx.fragment.app.FragmentContainerView
import androidx.fragment.app.FragmentManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.streamflixreborn.streamflix.charm.VodRootFragment

/**
 * A React Native native-view surface, not a second Activity.
 * Mounts the existing Kotlin VOD NavHost in Charming MediaLab MainActivity.
 * The main React route remains mounted and owns top-level navigation.
 */
class CharmVodSurfaceManager(private val reactContext: ReactApplicationContext) :
    SimpleViewManager<CharmVodSurfaceManager.Surface>() {

    override fun getName() = "CharmVodSurface"

    private fun emit(name: String, value: String) {
        runCatching {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(name, value)
        }
    }

    inner class Surface(context: ThemedReactContext) : FrameLayout(context) {
        private val container = FragmentContainerView(context).apply {
            id = View.generateViewId()
            isFocusable = false
        }
        private var activity: MainActivity? = null
        private var fragment: VodRootFragment? = null
        private var manager: FragmentManager? = null
        var startSection: String = "home"
            set(value) {
                field = value
                fragment?.navigateTo(value)
            }

        init {
            id = View.generateViewId()
            isFocusable = false
            descendantFocusability = FOCUS_AFTER_DESCENDANTS
            addView(container, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }

        override fun onAttachedToWindow() {
            super.onAttachedToWindow()
            // The fragment container must first be attached to the ACTIVITY
            // view tree; the transaction may not run in createViewInstance().
            post { mountIfReady() }
        }

        private fun mountIfReady() {
            if (!isAttachedToWindow || fragment != null) return
            val host = (context as? ThemedReactContext)?.currentActivity as? MainActivity ?: return
            if (host.isFinishing || host.isDestroyed) return
            val fm = host.supportFragmentManager
            val screen = VodRootFragment.create(startSection)
            screen.onHostBack = { emit("CharmVodRootBack", "") }
            screen.onHostIconRail = {
                emit("CharmVodFocusHostRail", "")
                true
            }
            screen.onImmersiveChanged = { playing ->
                emit("CharmVodImmersiveChanged", if (playing) "true" else "false")
            }
            activity = host
            manager = fm
            fragment = screen
            host.attachVodInput(this, screen::onRemoteKey, screen::navigateBack)
            try {
                fm.beginTransaction().replace(container.id, screen, "charm_unified_vod_" + container.id)
                    .commitNowAllowingStateLoss()
            } catch (e: RuntimeException) {
                // The bridge must not leave stale activity-level key routing
                // installed if native fragment inflation failed.
                host.detachVodInput(this)
                activity = null
                fragment = null
                manager = null
                emit("CharmVodMountError", e.message ?: "Native VOD could not mount")
            }
        }

        fun dispose() {
            activity?.detachVodInput(this)
            fragment?.apply {
                onHostBack = null
                onHostIconRail = null
                onImmersiveChanged = null
            }
            val old = fragment
            val fm = manager
            fragment = null
            manager = null
            activity = null
            if (old != null && fm != null && !fm.isDestroyed) {
                runCatching {
                    fm.beginTransaction().remove(old).commitNowAllowingStateLoss()
                }
            }
        }

        override fun onDetachedFromWindow() {
            dispose()
            super.onDetachedFromWindow()
        }
    }

    override fun createViewInstance(reactContext: ThemedReactContext) = Surface(reactContext)

    @ReactProp(name = "startSection")
    fun setStartSection(view: Surface, section: String?) {
        view.startSection = section ?: "home"
    }

    override fun onDropViewInstance(view: Surface) {
        view.dispose()
        super.onDropViewInstance(view)
    }
}