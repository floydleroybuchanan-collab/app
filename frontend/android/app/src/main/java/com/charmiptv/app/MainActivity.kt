package com.charmiptv.app
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.View
import android.view.ViewGroup
import android.graphics.Rect
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.content.Context

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {

  override fun onStart() {
    EpgImportCoordinator.appVisible = true
    super.onStart()
  }

  override fun onStop() {
    super.onStop()
    EpgImportCoordinator.appVisible = false
  }

  private var lastAcceptedDirectionalRepeatAt = 0L
  private var lastAcceptedDirectionalKeyCode = -1
  private var emittedLongPressKeyCode = -1
  private var shellBoundaryKeyDown = -1
  private var lastShellInteractionAt = 0L
  private fun testId(view: View): String =
    view.getTag(com.facebook.react.R.id.react_test_id) as? String ?: ""

  private fun within(view: View?, ancestor: View): Boolean {
    var at = view
    while (at != null) {
      if (at === ancestor) return true
      at = at.parent as? View
    }
    return false
  }

  private fun visible(view: View?): Boolean {
    if (view == null || !view.isAttachedToWindow || !view.isShown || !view.getGlobalVisibleRect(Rect())) return false
    var ancestor: View? = view
    while (ancestor != null) {
      if (ancestor.alpha <= 0f) return false
      ancestor = ancestor.parent as? View
    }
    return true
  }

  private fun findTagged(view: View, id: String): View? {
    if (testId(view) == id && visible(view)) return view
    if (view is ViewGroup) for (index in 0 until view.childCount) {
      findTagged(view.getChildAt(index), id)?.let { return it }
    }
    return null
  }

  private fun focusContentFromRail(root: View, rail: View, focus: View): Boolean {
    val page = findTagged(root, "phase9-guide-groups-drawer") ?: findTagged(root, "purple-tv-page") ?: return false
    val next = focus.focusSearch(View.FOCUS_RIGHT)
    fun usable(view: View?): Boolean = view != null && view !== page && visible(view) &&
      view.isEnabled && view.isFocusable && within(view, page) && !within(view, rail) &&
      !(view is ReactViewGroup && view.isTVFocusGuide) &&
      view !is android.widget.ScrollView && view !is android.widget.HorizontalScrollView
    // RN TV autoFocus guides expose only themselves to getFocusables() when
    // focus is outside. Walk mounted children instead of accepting that sentinel
    // or restoring a clipped, previously focused descendant behind the viewport.
    val targets = TvFocusTraversal.targets(page, { view ->
      if (!visible(view) || (view is ViewGroup && view.descendantFocusability == ViewGroup.FOCUS_BLOCK_DESCENDANTS)) emptyList()
      else if (view is ViewGroup) (0 until view.childCount).map(view::getChildAt) else emptyList()
    }, ::usable)
    return TvFocusTraversal.transfer(
      listOfNotNull(next?.takeIf(::usable)) + targets,
      { it.requestFocus(View.FOCUS_RIGHT) },
      { usable(currentFocus) },
      { focus.requestFocus() },
    )
  }

  /** UI-thread precondition for removing a rail: it cannot retain focus. */
  fun prepareIconRailHide(shellTag: Int): Boolean {
    val root = window.decorView.findViewById<View>(shellTag) ?: return true
    if (testId(root) != "purple-tv-shell") return false
    val rail = findTagged(root, "purple-icon-rail") ?: return true
    val focus = currentFocus ?: return true
    if (!within(focus, rail)) return true
    return focusContentFromRail(root, rail, focus)
  }

  /** Resolve physical page/rail boundaries against this window's live views. */
  private fun routeShellBoundary(event: android.view.KeyEvent): Boolean {
    if (event.action != android.view.KeyEvent.ACTION_DOWN || TvRemoteModule.pointerActive) return false
    val focus = currentFocus ?: return false
    var shell: View? = focus
    while (shell != null && testId(shell) != "purple-tv-shell") shell = shell.parent as? View
    val root = shell ?: return false
    val now = android.os.SystemClock.elapsedRealtime()
    if (now - lastShellInteractionAt >= 500L) {
      lastShellInteractionAt = now
      emitRemoteEvent("CharmShellInteraction", root.id.toString())
    }
    val key = event.keyCode
    if (key != android.view.KeyEvent.KEYCODE_DPAD_LEFT &&
        key != android.view.KeyEvent.KEYCODE_DPAD_RIGHT && key != android.view.KeyEvent.KEYCODE_BACK) return false
    val rail = findTagged(root, "purple-icon-rail")
    if (rail == null) {
      // NativeGuideView handles its own timeline/channel-column boundary.
      // Preview action controls use the same groups destination at their edge.
      if (key != android.view.KeyEvent.KEYCODE_DPAD_LEFT || focus is NativeGuideView ||
          focus is EditText || TvRemoteModule.remoteContext == "modal" || TvRemoteModule.remoteContext == "main_drawer") return false
      val guidePage = findTagged(root, "purple-tv-guide-page")
      val page = guidePage ?: findTagged(root, "purple-tv-page") ?: return false
      if (!within(focus, page)) return false
      val next = focus.focusSearch(View.FOCUS_LEFT)
      if (next !== focus && visible(next) && within(next, page)) return false
      if (event.repeatCount == 0) {
        if (guidePage != null) emitRemoteEvent("CharmGuideGroupsRequestOpen", "")
        else emitRemoteEvent("CharmIconRailReveal", root.id.toString())
      }
      return true
    }
    val onRail = within(focus, rail)
    if (onRail && (key == android.view.KeyEvent.KEYCODE_DPAD_LEFT || key == android.view.KeyEvent.KEYCODE_BACK)) {
      // Address the shell that actually owns native focus. A generic key event
      // also reaches an open groups drawer and can start a competing handoff.
      if (event.repeatCount == 0) emitRemoteEvent("CharmIconRailOpenMain", root.id.toString())
      return true
    }
    if (onRail && key == android.view.KeyEvent.KEYCODE_DPAD_RIGHT) {
      focusContentFromRail(root, rail, focus)
      // Failure leaves focus on the rail, never on a hidden/stale node.
      return true
    }
    if (key != android.view.KeyEvent.KEYCODE_DPAD_LEFT || focus is EditText || focus is NativeGuideView) return false
    if (TvRemoteModule.remoteContext == "modal" || TvRemoteModule.remoteContext == "guide_groups") return false
    val page = findTagged(root, "purple-tv-page") ?: return false
    if (!within(focus, page)) return false
    val next = focus.focusSearch(View.FOCUS_LEFT)
    if (next !== focus && visible(next) && within(next, page)) return false
    val destination = if (visible(next) && within(next, rail)) next
      else rail.getFocusables(View.FOCUS_FORWARD).firstOrNull { it !== rail && visible(it) && it.isEnabled }
    destination?.requestFocus()
    return true
  }

  private val selectHoldHandler = Handler(Looper.getMainLooper())
  private var selectHoldKeyCode = -1
  private var selectHoldContext: String? = null
  private var selectLongTriggered = false
  private val selectLongPressRunnable = Runnable {
    val owner = selectHoldContext
    if (
      selectHoldKeyCode != -1 &&
        !selectLongTriggered &&
        (owner == "guide" || owner == "player") &&
        TvRemoteModule.remoteContext == owner
    ) {
      selectLongTriggered = true
      emitRemoteEvent("TvRemoteQuickActions", owner)
    }
  }

  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    if (event.action == android.view.KeyEvent.ACTION_UP && event.keyCode == shellBoundaryKeyDown) {
      shellBoundaryKeyDown = -1
      return true
    }
    if (routeShellBoundary(event)) {
      shellBoundaryKeyDown = event.keyCode
      return true
    }
    // Android TV EditText consumes D-pad Up/Down as cursor movement. Settings
    // fields are single-line controls, so move focus to the adjacent control and
    // dismiss the keyboard instead of trapping the user inside the field.
    if (event.action == android.view.KeyEvent.ACTION_DOWN && event.repeatCount == 0 && currentFocus is EditText) {
      val direction = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_UP -> View.FOCUS_UP
        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> View.FOCUS_DOWN
        else -> 0
      }
      if (direction != 0) {
        val field = currentFocus as EditText
        val next = field.focusSearch(direction)
        (getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(field.windowToken, 0)
        // Retain the field when no adjacent control can take focus.
        if (next != null && next !== field) next.requestFocus()
        return true
      }
    }
    // TiViMate-style central action router: hardware media/channel buttons are
    // semantic events only while the fullscreen player owns remote input.
    if (
      event.action == android.view.KeyEvent.ACTION_DOWN &&
        event.repeatCount == 0 &&
        TvRemoteModule.remoteContext == "player" &&
        !TvRemoteModule.pointerActive
    ) {
      val shortcut = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_CHANNEL_UP, android.view.KeyEvent.KEYCODE_PAGE_UP -> "CHANNEL_UP"
        android.view.KeyEvent.KEYCODE_CHANNEL_DOWN, android.view.KeyEvent.KEYCODE_PAGE_DOWN -> "CHANNEL_DOWN"
        android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, android.view.KeyEvent.KEYCODE_MEDIA_PLAY, android.view.KeyEvent.KEYCODE_MEDIA_PAUSE -> "MEDIA_PLAY_PAUSE"
        else -> null
      }
      if (shortcut != null) {
        emitRemoteEvent("TvRemoteShortcut", shortcut)
        return true
      }
    }

    // TiViMate-style window action router: classify OK/Select once per physical
    // hold at the Activity boundary. Fire TV remotes do not all emit repeatCount
    // events, so repeat-based long-press detection can fall through as a short
    // Guide click and open ProgramModal/Watch Now underneath Quick Actions.
    val selectKey =
      event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER ||
        event.keyCode == android.view.KeyEvent.KEYCODE_ENTER ||
        event.keyCode == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER ||
        event.keyCode == android.view.KeyEvent.KEYCODE_BUTTON_A
    if (selectKey && !TvRemoteModule.pointerActive) {
      val context = TvRemoteModule.remoteContext
      if (
        event.action == android.view.KeyEvent.ACTION_DOWN &&
          selectHoldKeyCode == -1 &&
          (context == "guide" || context == "player")
      ) {
        selectHoldKeyCode = event.keyCode
        selectHoldContext = context
        selectLongTriggered = false
        selectHoldHandler.removeCallbacks(selectLongPressRunnable)
        selectHoldHandler.postDelayed(
          selectLongPressRunnable,
          ViewConfiguration.getLongPressTimeout().toLong(),
        )
        // Do not let the child view see the initial DOWN until the hold is
        // classified. That is what prevents Watch Now / normal click bleed.
        return true
      }
      if (selectHoldKeyCode == event.keyCode) {
        if (event.action == android.view.KeyEvent.ACTION_DOWN) {
          // Consume vendor repeat events too; the timer is the sole classifier.
          return true
        }
        if (event.action == android.view.KeyEvent.ACTION_UP) {
          selectHoldHandler.removeCallbacks(selectLongPressRunnable)
          val owner = selectHoldContext
          val wasLong = selectLongTriggered
          selectHoldKeyCode = -1
          selectHoldContext = null
          selectLongTriggered = false
          if (wasLong) return true
          // A route/modal transition during the hold owns the release. Never
          // replay a short click into a different surface.
          if (owner == null || TvRemoteModule.remoteContext != owner) return true

          if (owner == "player") emitRemoteEvent("TvRemoteKey", "SELECT")

          // Re-inject one clean short click below this Activity override. Guide
          // gets a normal NativeGuideView DOWN/UP pair; Player controls retain
          // normal Android Pressable activation while JS gets one semantic key.
          val down = android.view.KeyEvent(
            event.downTime,
            event.eventTime,
            android.view.KeyEvent.ACTION_DOWN,
            event.keyCode,
            0,
            event.metaState,
            event.deviceId,
            event.scanCode,
            event.flags,
            event.source,
          )
          val up = android.view.KeyEvent(
            event.downTime,
            event.eventTime,
            android.view.KeyEvent.ACTION_UP,
            event.keyCode,
            0,
            event.metaState,
            event.deviceId,
            event.scanCode,
            event.flags,
            event.source,
          )
          super.dispatchKeyEvent(down)
          super.dispatchKeyEvent(up)
          return true
        }
      }
    }

    // Generic long Down/Back remains repeat-driven because those actions are
    // repeat/navigation semantics, not click-vs-hold classification.
    if (
      event.action == android.view.KeyEvent.ACTION_DOWN &&
        event.repeatCount > 0 &&
        emittedLongPressKeyCode != event.keyCode
    ) {
      val longKey = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"
        android.view.KeyEvent.KEYCODE_BACK -> "BACK"
        else -> null
      }
      if (longKey != null) {
        emittedLongPressKeyCode = event.keyCode
        emitRemoteEvent("TvRemoteLongPress", longKey)
      }
    } else if (
      event.action == android.view.KeyEvent.ACTION_UP &&
        event.keyCode == emittedLongPressKeyCode
    ) {
      emittedLongPressKeyCode = -1
    }

    // Phase 9 remote ownership. Drawers own only their boundary transitions;
    // Up/Down/OK remain native focus events inside the active drawer.
    if (event.action == android.view.KeyEvent.ACTION_DOWN && event.repeatCount == 0 && !TvRemoteModule.pointerActive) {
      val context = TvRemoteModule.remoteContext
      val boundaryKey = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_LEFT -> "LEFT"
        android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> "RIGHT"
        android.view.KeyEvent.KEYCODE_BACK -> "BACK"
        else -> null
      }
      val owned =
        (context == "guide_groups" && (boundaryKey == "LEFT" || boundaryKey == "RIGHT" || boundaryKey == "BACK")) ||
          (context == "main_drawer" && boundaryKey == "RIGHT") ||
          // RIGHT is native focus traversal back into the visible page. Do not
          // round-trip it through JS: a screen transition can invalidate the
          // stored React node before the event arrives and make focus vanish.
          (context == "icon_rail" && (boundaryKey == "LEFT" || boundaryKey == "BACK")) ||
          (context == "drawer_edge" && boundaryKey == "LEFT")
      if (owned && boundaryKey != null) {
        emitRemoteEvent("TvRemoteKey", boundaryKey)
        return true
      }
    }
    // Dedicated Channel/Page buttons provide safe one-page Guide jumps. They
    // never overload ordinary D-pad taps, so channel-by-channel focus remains
    // deterministic and a held arrow cannot accidentally trigger a page jump.
    if (
      event.action == android.view.KeyEvent.ACTION_DOWN &&
        event.repeatCount == 0 &&
        TvRemoteModule.guideNavigationActive &&
        !TvRemoteModule.pointerActive
    ) {
      val pageKey = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_CHANNEL_UP,
        android.view.KeyEvent.KEYCODE_PAGE_UP,
        android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "UP"
        android.view.KeyEvent.KEYCODE_CHANNEL_DOWN,
        android.view.KeyEvent.KEYCODE_PAGE_DOWN,
        android.view.KeyEvent.KEYCODE_MEDIA_NEXT -> "DOWN"
        else -> when (event.scanCode) {
          // ONN/vendor key layouts can leave the Android keyCode UNKNOWN while
          // retaining Linux channel / 10-channel scan codes.
          0x192, 0x1b8 -> "UP"
          0x193, 0x1b9 -> "DOWN"
          else -> null
        }
      }
      if (pageKey != null) {
        emitRemoteEvent("TvGuidePageKey", pageKey)
        return true
      }
    }

    val directional =
      event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_LEFT ||
        event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_RIGHT

    // Keep the first press and direction reversals instant. Held Guide repeats
    // use a bounded native cadence and never wait for a JS/paint acknowledgement;
    // that old cross-thread lock could release a repeat after a row was recycled.
    if (event.action == android.view.KeyEvent.ACTION_DOWN && directional) {
      val guideActive =
        TvRemoteModule.guideNavigationActive &&
          !TvRemoteModule.pointerActive
      if (event.repeatCount == 0) {
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
      } else {
        val elapsed = event.eventTime - lastAcceptedDirectionalRepeatAt
        val sameDirection = event.keyCode == lastAcceptedDirectionalKeyCode
        if (sameDirection) {
          val repeatFloor = if (guideActive) TvRemoteModule.guideRepeatIntervalMs else MIN_DPAD_REPEAT_MS
          if (elapsed < repeatFloor) {
            return true
          }
        }
        lastAcceptedDirectionalKeyCode = event.keyCode
        lastAcceptedDirectionalRepeatAt = event.eventTime
      }
    } else if (event.action == android.view.KeyEvent.ACTION_UP && directional) {
      lastAcceptedDirectionalKeyCode = -1
      lastAcceptedDirectionalRepeatAt = 0L
    }

    val key: String? = if (event.action == android.view.KeyEvent.ACTION_DOWN) {
      when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_UP -> "UP"
        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"
        android.view.KeyEvent.KEYCODE_DPAD_LEFT -> "LEFT"
        android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> "RIGHT"
        android.view.KeyEvent.KEYCODE_DPAD_CENTER,
        android.view.KeyEvent.KEYCODE_ENTER,
        android.view.KeyEvent.KEYCODE_NUMPAD_ENTER,
        android.view.KeyEvent.KEYCODE_BUTTON_A -> "SELECT"
        android.view.KeyEvent.KEYCODE_BACK -> "BACK"
        else -> null
      }
    } else null
    val mirrorToJs = TvRemoteModule.pointerActive || TvRemoteModule.remoteContext == "player"
    if (key != null && mirrorToJs) {
      emitRemoteEvent("TvRemoteKey", key)
      // Pointer mode owns the D-pad entirely. Ordinary TV pages use Android's
      // native focus engine and must not receive a duplicate JS copy of the
      // same physical arrow; that duplicate was a source of focus drift.
      if (TvRemoteModule.pointerActive) return true
    }
    return super.dispatchKeyEvent(event)
  }

  private fun emitRemoteEvent(name: String, value: String) {
    try {
      val app = application as com.facebook.react.ReactApplication
      val rc = try { app.reactHost?.currentReactContext } catch (e: Throwable) { null }
        ?: try { app.reactNativeHost.reactInstanceManager.currentReactContext } catch (e: Throwable) { null }
      rc?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit(name, value)
    } catch (_: Throwable) {}
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Prevent the Onn box / Android TV from dimming or launching a screensaver
    // while Charming MediaLab is active.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
    enterImmersiveMode()
    (findViewById<android.view.ViewGroup>(android.R.id.content))?.let { content ->
      content.clipChildren = false
      content.clipToPadding = false
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) enterImmersiveMode()
  }

  private fun enterImmersiveMode() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.let { controller ->
        controller.hide(
          android.view.WindowInsets.Type.statusBars() or
            android.view.WindowInsets.Type.navigationBars(),
        )
        controller.systemBarsBehavior =
          android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
      return
    }
    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility =
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
        View.SYSTEM_UI_FLAG_FULLSCREEN or
        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
  }

  override fun getMainComponentName(): String = "main"

  override fun onDestroy() {
    selectHoldHandler.removeCallbacks(selectLongPressRunnable)
    selectHoldKeyCode = -1
    selectHoldContext = null
    selectLongTriggered = false
    // Static remote flags must never survive an Activity/bridge teardown.
    // A stale pointer flag consumes every D-pad key before Android focus sees it.
    TvRemoteModule.pointerActive = false
    TvRemoteModule.guideNavigationActive = false
    TvRemoteModule.remoteContext = "default"
    super.onDestroy()
  }

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              super.invokeDefaultOnBackPressed()
          }
          return
      }
      super.invokeDefaultOnBackPressed()
  }

  companion object {
    // Non-Guide screens retain the existing cap. Guide repeats use the
    // configurable device-profile cadence (72 ms Normal by default).
    private const val MIN_DPAD_REPEAT_MS = 48L
  }
}
