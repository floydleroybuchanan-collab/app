package com.charmiptv.app

import android.graphics.Color
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
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
        private var layoutPassPending = false
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

        /**
         * React Native's parent views end requestLayout() without scheduling a
         * pass, so children added after RN sized this view (the VOD fragment)
         * would stay 0x0 and show a blank page. Run that pass here instead.
         */
        override fun requestLayout() {
            super.requestLayout()
            if (layoutPassPending) return
            layoutPassPending = true
            post {
                layoutPassPending = false
                if (isAttachedToWindow && width > 0 && height > 0) {
                    measure(
                        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
                    )
                    layout(left, top, right, bottom)
                }
            }
        }

        /** Sizes the native page from this view, or its parent while RN is still laying it out. */
        fun forceLayoutPass() {
            if (!isAttachedToWindow) return
            val host = parent as? View
            val w = if (width > 0) width else host?.width ?: 0
            val h = if (height > 0) height else host?.height ?: 0
            if (w <= 0 || h <= 0) return
            measure(
                View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY),
            )
            layout(left, top, left + w, top + h)
        }

        private fun showFailure(message: String) {
            // Native fallback is reliable even if React has not registered the
            // failure event listener yet. Never leave an unexplained black view.
            if (findViewWithTag<View>("charm_vod_failure") != null) return
            addView(TextView(context).apply {
                tag = "charm_vod_failure"
                text = "VOD couldn't open. Use Back and select Video OnDemand again.\n\n$message"
                setTextColor(Color.WHITE)
                textSize = 17f
                gravity = Gravity.CENTER
                setPadding(32, 32, 32, 32)
                setBackgroundColor(0xFF190B29.toInt())
            }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
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
                showFailure(message)
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
                // Prefer a direct native handoff. A React event is only a
                // fallback when the rail was hidden by its idle timeout.
                if (host.focusVodRailFromContent()) true else {
                    emit("CharmVodFocusHostRail", "")
                    true
                }
            }
            screen.onNeedsLayout = { forceLayoutPass() }
            screen.onImmersiveChanged = { playing ->
                host.setVodImmersive(playing)
                emit("CharmVodImmersiveChanged", if (playing) "true" else "false")
            }
            screen.onRootError = { message ->
                if (fragment === screen && isAttachedToWindow) {
                    showFailure(message)
                    emit("CharmVodMountError", message)
                }
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
                runCatching {
                    if (screen.isAdded) fm.beginTransaction().remove(screen).commitNowAllowingStateLoss()
                }
                val message = failureSummary(e)
                showFailure(message)
                emit("CharmVodMountError", message)
            }
        }

        fun restoreNativeFocus(): Boolean =
            isAttachedToWindow && fragment?.restoreFocusFromRail() == true

        fun dispose() {
            activity?.detachVodInput(this)
            fragment?.apply {
                onHostBack = null
                onHostIconRail = null
                onImmersiveChanged = null
                onNeedsLayout = null
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

    @ReactProp(name = "startSection")
    fun setStartSection(view: Surface, section: String?) {
        view.startSection = section ?: "home"
    }

    override fun onDropViewInstance(view: Surface) {
        view.dispose()
        super.onDropViewInstance(view)
    }
}