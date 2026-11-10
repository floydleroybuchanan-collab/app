package com.charmiptv.app

import android.os.SystemClock
import android.util.Log
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

    private companion object {
        const val TAG = "CharmVodSurface"
    }

    /** Keep useful root causes in the UI without silently losing the full stack. */
    private fun failureSummary(error: Throwable): String {
        val chain = generateSequence(error) { it.cause }
            .take(8)
            .map { cause ->
                cause.javaClass.simpleName + ": " + (cause.message ?: "(no details)")
            }
            .joinToString(" Caused by: ")
        return chain.take(1800)
    }

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
        private var mountStartedAt = 0L
        private var mountRetryCount = 0
        private var mountFailureSent = false
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
            mountStartedAt = SystemClock.elapsedRealtime()
            mountRetryCount = 0
            mountFailureSent = false
            Log.i(TAG, "VOD native view attached; awaiting host activity")
            post { mountIfReady() }
        }

        private fun retryHost(reason: String) {
            if (!isAttachedToWindow || mountFailureSent || fragment != null) return
            mountRetryCount += 1
            if (mountRetryCount <= 50) {
                if (mountRetryCount == 1 || mountRetryCount % 10 == 0) {
                    Log.w(TAG, "VOD waiting for host: $reason; attempt $mountRetryCount")
                }
                postDelayed({ mountIfReady() }, 200L)
            } else {
                mountFailureSent = true
                val message = "VOD could not attach to MainActivity: $reason"
                Log.e(TAG, message)
                emit("CharmVodMountError", message)
            }
        }

        private fun mountIfReady() {
            if (!isAttachedToWindow || fragment != null || mountFailureSent) return
            val host = (context as? ThemedReactContext)?.currentActivity as? MainActivity
            if (host == null) {
                retryHost("Activity not yet available")
                return
            }
            if (host.isFinishing || host.isDestroyed || host.supportFragmentManager.isStateSaved) {
                retryHost("Activity or FragmentManager not ready")
                return
            }
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
            screen.onRootReady = {
                if (fragment === screen && isAttachedToWindow) {
                    val elapsedMs = SystemClock.elapsedRealtime() - mountStartedAt
                    Log.i(TAG, "VOD native NavHost ready in ${elapsedMs}ms")
                    emit("CharmVodRootReady", elapsedMs.toString())
                }
            }
            activity = host
            manager = fm
            fragment = screen
            host.attachVodInput(this, screen::onRemoteKey, screen::navigateBack)
            try {
                Log.i(TAG, "Mounting VOD fragment after ${SystemClock.elapsedRealtime() - mountStartedAt}ms")
                fm.beginTransaction().replace(container.id, screen, "charm_unified_vod_" + container.id)
                    .commitNowAllowingStateLoss()
            } catch (e: RuntimeException) {
                Log.e(TAG, "Embedded VOD failed to inflate/mount", e)
                // The bridge must not leave stale activity-level key routing
                // installed if native fragment inflation failed.
                host.detachVodInput(this)
                activity = null
                fragment = null
                manager = null
                emit("CharmVodMountError", failureSummary(e))
            }
        }

        fun dispose() {
            activity?.detachVodInput(this)
            fragment?.apply {
                onHostBack = null
                onHostIconRail = null
                onImmersiveChanged = null
                onRootReady = null
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