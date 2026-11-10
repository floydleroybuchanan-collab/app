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
        // A retained Expo tab may be mounted but no longer own remote input.
        // Preserve its Fragment/back stack without letting it steal focus.
        var screenActive: Boolean = false
            set(value) {
                if (field == value) return
                field = value
                fragment?.setHostActive(value)
                if (value) {
                    // The active tab is the sole native key owner. Re-register
                    // its existing Fragment callbacks rather than retaining
                    // dormant hardware input handlers under another screen.
                    fragment?.let { current ->
                        activity?.attachVodInput(this, current::onRemoteKey, current::navigateBack)
                    }
                    post { mountIfReady() }
                } else {
                    // Remove the ownership registration itself on tab exit.
                    activity?.detachVodInput(this)
                }
            }
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

        // React Native Fabric owns the outer Surface's frame, but Fragment views
        // inserted after reconciliation do not automatically receive a Yoga layout.
        // Keep the FragmentContainerView sized to that actual frame, rather than
        // allowing the nested NavHost to stay permanently at 0x0.
        private fun layoutEmbeddedFragment() {
            val w = width
            val h = height
            if (!isAttachedToWindow || w <= 0 || h <= 0) return
            val widthSpec = View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY)
            val heightSpec = View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY)
            if (container.width != w || container.height != h ||
                container.measuredWidth != w || container.measuredHeight != h) {
                container.measure(widthSpec, heightSpec)
                container.layout(0, 0, w, h)
            }
            // A FragmentTransaction can add its root *after* the container's
            // layout pass. Give that newly inserted tree one real measure/layout.
            fragment?.view?.let { root ->
                if (root.width != w || root.height != h) {
                    root.measure(widthSpec, heightSpec)
                    root.layout(0, 0, w, h)
                }
            }
        }

        override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
            super.onLayout(changed, left, top, right, bottom)
            if (width > 0 && height > 0) {
                layoutEmbeddedFragment()
                if (screenActive && fragment == null && !mountFailureSent) post { mountIfReady() }
            }
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
            if (!screenActive || !isAttachedToWindow || fragment != null || mountFailureSent) return
            // Never create a NavHost in an unmeasured/hidden Expo Tabs route.
            // The next onLayout delivers a real frame and retries the mount.
            if (width <= 0 || height <= 0) return
            layoutEmbeddedFragment()
            if (container.width <= 0 || container.height <= 0) return
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
            screen.setHostActive(screenActive)
            screen.onHostBack = { emit("CharmVodRootBack", "") }
            screen.onHostIconRail = {
                // Prefer a direct native handoff. A React event is only a
                // fallback when the rail was hidden by its idle timeout.
                if (host.focusVodRailFromContent()) true else {
                    emit("CharmVodFocusHostRail", "")
                    true
                }
            }
            screen.onImmersiveChanged = { playing ->
                emit("CharmVodImmersiveChanged", if (playing) "true" else "false")
            }
            screen.onRootError = { message ->
                if (fragment === screen && isAttachedToWindow && screenActive) {
                        emit("CharmVodMountError", message)
                }
            }
            screen.onRootReady = {
                if (fragment === screen && isAttachedToWindow && screenActive) {
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
                // Fragment content was inserted after RN measured this Surface;
                // explicitly lay it out once before checking render readiness.
                post { layoutEmbeddedFragment() }
            } catch (e: RuntimeException) {
                Log.e(TAG, "Embedded VOD failed to inflate/mount", e)
                // The bridge must not leave stale activity-level key routing
                // installed if native fragment inflation failed.
                host.detachVodInput(this)
                activity = null
                fragment = null
                manager = null
                runCatching {
                    if (screen.isAdded) fm.beginTransaction().remove(screen).commitNowAllowingStateLoss()
                }
                val message = failureSummary(e)
                emit("CharmVodMountError", message)
            }
        }

        fun restoreNativeFocus(): Boolean =
            screenActive && isAttachedToWindow && fragment?.restoreFocusFromRail() == true

        fun dispose() {
            activity?.detachVodInput(this)
            fragment?.apply {
                onHostBack = null
                onHostIconRail = null
                onImmersiveChanged = null
                onRootReady = null
                onRootError = null
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

    @ReactProp(name = "screenActive", defaultBoolean = false)
    fun setScreenActive(view: Surface, active: Boolean) {
        view.screenActive = active
    }

    @ReactProp(name = "startSection")
    fun setStartSection(view: Surface, section: String?) {
        view.startSection = section ?: "home"
    }

    override fun onDropViewInstance(view: Surface) {
        view.dispose()
        super.onDropViewInstance(view)
    }
}