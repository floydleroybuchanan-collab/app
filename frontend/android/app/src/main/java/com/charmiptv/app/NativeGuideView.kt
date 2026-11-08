package com.charmiptv.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * Constant-view-count TV guide. Selection is logical coordinates, never Android focus nodes.
 * Program X/width are always derived from real start/end times against the same viewport used
 * by the header. SQLite reads follow the visible time runway so horizontal navigation cannot
 * outrun the queried EPG window and expose false empty columns.
 */
class NativeGuideView(context: Context) : View(context) {
  private data class ChannelRow(val id: String, val name: String, val number: String, val label: String, val displayNumber: String)
  private data class GuideQuery(val token: Int, val startMs: Long, val endMs: Long, val ids: List<String>)

  // Reads every enabled guide store through the same binding-aware repository
  // as the React bridge; the canvas must never fall back to primary-only SQL.
  private val combinedGuide = CombinedGuideRepository(context.applicationContext)
  private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "CharmGuideRead").apply { isDaemon = true } }
  private val rows = ArrayList<ChannelRow>()
  @Volatile private var programs = emptyMap<String, Array<NativeEpgProgram>>()

  private var windowStartMs = System.currentTimeMillis() - 30L * 60_000L
  private var windowEndMs = windowStartMs + 6L * 60L * 60_000L
  private var viewportStartMs = windowStartMs
  private var selectedRow = 0
  private var selectedTimeMs = System.currentTimeMillis().coerceIn(windowStartMs, windowEndMs - 1)
  private var firstVisibleRow = 0
  private var generation = 0
  private val pendingQuery = AtomicReference<GuideQuery?>(null)
  private val guideMainHandler = Handler(Looper.getMainLooper())
  private var latestQuery: GuideQuery? = null
  private val queryDrainScheduled = AtomicBoolean(false)
  @Volatile private var disposed = false
  private var enabled = true
  private var lastMoveAt = 0L
  private var lastHorizontalMoveAt = 0L
  private var moveVelocity = 0
  private var navigationKeyDown = false
  private var channelRailSelected = false
  private var selectKeyDown = false
  private var selectLongPressSeen = false
  private var pendingRestoreChannelId: String? = null
  private var pendingRestoreTimeMs: Long? = null
  private var reloadGeneration = 0
  // Keep the live Guide runway moving with wall-clock time. Manual horizontal
  // browsing disables follow so the cursor is never dragged away from a future
  // programme the viewer intentionally selected.
  private var liveFollowEnabled = true
  private var lastLiveFollowQueryStartMs = Long.MIN_VALUE
  private val liveClockRunnable = Runnable {
    if (!disposed && enabled && isAttachedToWindow) {
      invalidate()
      scheduleLiveClock()
    }
  }
  private val settleSelectionRunnable = Runnable {
    if (enabled && !disposed && rows.isNotEmpty()) emitSelection(true)
  }
  private var focusEntryPending = false
  private var focusEntryAttempts = 0
  private val focusEntryRunnable = object : Runnable {
    override fun run() {
      if (!focusEntryPending || !enabled || disposed) return
      if (isAttachedToWindow && isShown && hasWindowFocus() && rows.isNotEmpty() &&
          TvRemoteModule.remoteContext == "guide" && TvRemoteModule.guideNavigationActive && requestFocus()) {
        focusEntryPending = false
        return
      }
      // Route attachment and the remote owner can arrive after the active prop.
      // Bound retries; a menu/preview owner must never lose focus to this view.
      focusEntryAttempts += 1
      if (focusEntryAttempts < 6) postDelayed(this, 80L)
    }
  }

  private fun requestEntryFocus() {
    removeCallbacks(focusEntryRunnable)
    focusEntryPending = true
    focusEntryAttempts = 0
    post(focusEntryRunnable)
  }

  private val unregisterMemoryListener = CharmMemoryCoordinator.register { level, _ ->
    if (level != CharmTrimLevel.CRITICAL) return@register
    post {
      if (disposed) return@post
      programs = emptyMap()
      invalidateProgramQuery()
      loadPrograms()
      invalidate()
    }
  }

  private val density = resources.displayMetrics.density
  // Supplied recording at 20s: 420px column / 1.667 density ~=252dp.
  // This matches clone dimens 0x7f070058; the recording overrides the 190dp default.
  private val channelWidth = 252f * density
  // Clone guide clock/header is 29dp (0058.xml).
  private val headerHeight = 29f * density
  // Recorded cells advance ~65px at 1.667 density; retain 40dp logical rows.
  private val rowHeight = 40f * density
  private val pad = 8f * density

  /** Three visible hours gives six equal 30-minute header columns on every TV size. */
  private val visibleWindowMs = 3L * 60L * 60_000L
  private val horizontalPrefetchBeforeMs = 30L * 60_000L
  private val horizontalPrefetchAfterMs = 60L * 60_000L
  private val liveWindowHistoryMs = 60L * 60_000L
  private val liveWindowAdvanceThresholdMs = 60_000L

  private val background = Paint().apply { color = Color.rgb(12, 14, 18) }
  private val header = Paint().apply { color = Color.rgb(27, 30, 37) }
  private val channel = Paint().apply { color = Color.rgb(27, 30, 37) }
  private val rowSurface = Paint().apply { color = Color.rgb(12, 14, 18) }
  private val cell = Paint().apply { color = Color.rgb(37, 41, 51) }
  private val selected = Paint().apply { color = Color.rgb(168, 44, 255) }
  private val divider = Paint().apply { color = Color.argb(152, 157, 169, 190); strokeWidth = density }
  private val nowPaint = Paint().apply { color = Color.rgb(210, 156, 255); strokeWidth = 2f * density }
  private val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(240, 242, 247); textSize = 13f * density }
  private val numberPaint = android.text.TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(185, 191, 205); textSize = 8f * density }
  private val muted = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(212, 218, 231); textSize = 11f * density }
  private var timeFormatter = SimpleDateFormat("h:mm a", Locale.getDefault())
  private val tickDate = Date()
  private var use24HourClock = false

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    setBackgroundColor(Color.BLACK)
  }

  private fun scheduleLiveClock() {
    removeCallbacks(liveClockRunnable)
    if (!disposed && enabled && isAttachedToWindow) {
      postDelayed(liveClockRunnable, LIVE_CLOCK_TICK_MS)
    }
  }

  private fun stopLiveClock() {
    removeCallbacks(liveClockRunnable)
  }

  fun setChannels(value: ReadableArray?) {
    val wasEmpty = rows.isEmpty()
    val nextRows = ArrayList<ChannelRow>()
    if (value != null) for (index in 0 until value.size()) {
      val item = value.getMap(index) ?: continue
      val id = item.getString("id") ?: continue
      val name = item.getString("name") ?: "Channel"
      val number = item.getString("number") ?: ""
      // Keep the full number for accessibility; unusually long identifiers get
      // a bounded, precomputed display label rather than bleeding into logos.
      val displayNumber = if (number.length <= 4) number else android.text.TextUtils.ellipsize(number, numberPaint, 25f * density, android.text.TextUtils.TruncateAt.END).toString()
      nextRows.add(ChannelRow(id, name, number, if (number.isBlank()) name else "$number  $name", displayNumber))
    }
    if (rows == nextRows) {
      applyPendingRestoreChannel()
      return
    }
    val currentRestoreId = rows.getOrNull(selectedRow)?.id
    rows.clear()
    rows.addAll(nextRows)
    val keepIds = nextRows.asSequence().map { it.id }.toHashSet()
    programs = programs.filterKeys { it in keepIds }

    val wantedId = pendingRestoreChannelId ?: currentRestoreId
    val restoreIndex = wantedId?.let { wanted -> rows.indexOfFirst { it.id == wanted } } ?: -1
    selectedRow = if (restoreIndex >= 0) restoreIndex else selectedRow.coerceIn(0, max(0, rows.lastIndex))
    if (restoreIndex >= 0 && wantedId == pendingRestoreChannelId) pendingRestoreChannelId = null
    if (rows.isEmpty()) selectedRow = 0
    ensureVisible()
    loadPrograms()
    invalidate()
    if (enabled && rows.isNotEmpty()) {
      // Active can arrive before the first channel payload. In that ordering,
      // setActive cannot focus an empty canvas and Android otherwise falls back
      // to the first React Pressable (Guide Play). Claim once when the Guide
      // becomes focusable; later EPG/channel updates never steal focus.
      if (wasEmpty) requestEntryFocus()
      emitSelection(true)
    }
  }

  fun setWindow(start: Double, end: Double) {
    val nextStart = start.toLong()
    val nextEnd = end.toLong()
    if (nextEnd <= nextStart) return
    val changed = nextStart != windowStartMs || nextEnd != windowEndMs
    windowStartMs = nextStart
    windowEndMs = nextEnd

    val pending = pendingRestoreTimeMs
    if (pending != null && pending >= windowStartMs && pending < windowEndMs) {
      selectedTimeMs = pending
      pendingRestoreTimeMs = null
    } else {
      selectedTimeMs = selectedTimeMs.coerceIn(windowStartMs, windowEndMs - 1)
    }
    viewportStartMs = clampViewportStart(viewportStartMs)
    if (selectedTimeMs < viewportStartMs || selectedTimeMs >= viewportEndMs()) {
      viewportStartMs = clampViewportStart(selectedTimeMs - 15L * 60_000L)
    }
    if (changed || pendingRestoreTimeMs == null) loadPrograms()
    invalidate()
  }

  fun setWindowStart(start: Double) = setWindow(start, windowEndMs.toDouble())
  fun setWindowEnd(end: Double) = setWindow(windowStartMs.toDouble(), end)

  private var showLogos = true
  fun setShowLogos(value: Boolean) { showLogos = value; invalidate() }
  private var lastLogoFirst = -1
  private var lastLogoIds: List<String> = emptyList()
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    ensureVisible()
    // The first attached read can run before layout. Rewarm on height changes
    // so a tall viewport is covered before the first navigation key.
    if (h != oldh) loadPrograms()
  }
  private var overlayMode = false
  // The guide's original transparency setting of 50 translates to 25%
  // see-through backgrounds, not 50%. Preview mode remains fully opaque.
  private var transparencyLevel = 50
  var rightBoundaryEnabled = false
  var enableUpBoundary = false
  fun setTransparencyLevel(value: Int) {
    val next = value.coerceIn(0, 100)
    if (next == transparencyLevel) return
    transparencyLevel = next
    applyGuideOpacity()
  }
  fun setOverlayMode(value: Boolean) {
    if (overlayMode == value) return
    overlayMode = value
    applyGuideOpacity()
  }
  private fun applyGuideOpacity() {
    val opacity = if (overlayMode) (255f * (1f - 0.005f * transparencyLevel))
      .toInt().coerceIn(0, 255) else 255
    // Do not stack two 75%-opaque rectangles on top of each other: that would
    // make programme cells 94% opaque and hide the video. Only the *visible*
    // cell/channel surface gets the configured alpha.
    setBackgroundColor(if (overlayMode) Color.TRANSPARENT else Color.rgb(12, 14, 18))
    background.alpha = if (overlayMode) 0 else 255
    header.alpha = opacity
    rowSurface.alpha = if (overlayMode) 0 else 255
    cell.alpha = opacity
    invalidate()
  }

  fun setClock24h(value: Boolean) {
    if (value == use24HourClock) return
    use24HourClock = value
    timeFormatter = SimpleDateFormat(if (value) "HH:mm" else "h:mm a", Locale.getDefault())
    invalidate()
  }

  fun setActive(value: Boolean) {
    val wasEnabled = enabled
    enabled = value
    isFocusableInTouchMode = value
    isFocusable = value
    if (!value) {
      focusEntryPending = false
      removeCallbacks(focusEntryRunnable)
      stopLiveClock()
      removeCallbacks(settleSelectionRunnable)
      navigationKeyDown = false
      selectKeyDown = false
      selectLongPressSeen = false
      moveVelocity = 0
      return
    }
    scheduleLiveClock()
    applyPendingRestoreChannel()
    // React may re-apply an unchanged active=true prop.
    // Only a real inactive -> active ownership transition may take Android focus
    // back into the Guide; otherwise keep the user's current focused surface.
    if (!wasEnabled && rows.isNotEmpty()) {
      requestEntryFocus()
      emitSelection(true)
    }
  }

  fun restoreChannel(channelId: String?) {
    val wanted = channelId?.trim().orEmpty()
    if (wanted.isEmpty()) return
    pendingRestoreChannelId = wanted
    applyPendingRestoreChannel()
  }

  private fun applyPendingRestoreChannel() {
    val wanted = pendingRestoreChannelId ?: return
    val index = rows.indexOfFirst { it.id == wanted }
    if (index < 0) return
    pendingRestoreChannelId = null
    selectedRow = index
    ensureVisible()
    loadPrograms()
    invalidate()
    if (enabled) emitSelection(true)
  }

  fun setReloadGeneration(value: Int) {
    if (value == reloadGeneration) return
    removeCallbacks(settleSelectionRunnable)
    reloadGeneration = value
    invalidateProgramQuery()
    // Logical Guide resets (group switch/Search/fullscreen return) keep the
    // same native view and cursor, but must always request a fresh bounded
    // visible runway even when the channel array itself is unchanged.
    loadPrograms()
    invalidate()
    if (enabled && rows.isNotEmpty()) emitSelection(true)
  }

  fun restoreTime(value: Double) {
    if (!value.isFinite() || value <= 0.0) return
    val wanted = value.toLong()
    pendingRestoreTimeMs = wanted
    if (windowEndMs <= windowStartMs || wanted < windowStartMs || wanted >= windowEndMs) return
    pendingRestoreTimeMs = null
    liveFollowEnabled = abs(wanted - System.currentTimeMillis()) <= 30L * 60_000L
    if (wanted == selectedTimeMs) return
    selectedTimeMs = wanted
    viewportStartMs = clampViewportStart(selectedTimeMs - visibleWindowMs / 6L)
    loadPrograms()
    invalidate()
    if (enabled) emitSelection(true)
  }

  private fun updateLiveFollowFromSelection() {
    val now = System.currentTimeMillis()
    val current = selectedProgram()
    liveFollowEnabled = current?.let { now >= it.startMs && now < it.endMs }
      ?: (abs(selectedTimeMs - now) <= 60_000L)
  }

  private fun clampViewportStart(value: Long): Long {
    val latest = max(windowStartMs, windowEndMs - visibleWindowMs)
    return value.coerceIn(windowStartMs, latest)
  }

  private fun viewportEndMs(): Long = min(windowEndMs, viewportStartMs + visibleWindowMs)

  private fun ensureSelectedTimeVisible() {
    val end = viewportEndMs()
    val rightGuard = viewportStartMs + (visibleWindowMs * 5L / 6L)
    val leftGuard = viewportStartMs + (visibleWindowMs / 6L)
    val next = when {
      selectedTimeMs >= rightGuard -> selectedTimeMs - (visibleWindowMs * 2L / 3L)
      selectedTimeMs < leftGuard -> selectedTimeMs - (visibleWindowMs / 6L)
      selectedTimeMs >= end -> selectedTimeMs - (visibleWindowMs * 2L / 3L)
      else -> viewportStartMs
    }
    val clamped = clampViewportStart(next)
    if (clamped != viewportStartMs) {
      viewportStartMs = clamped
      loadPrograms()
    }
  }

  private fun invalidateProgramQuery() {
    generation += 1
    latestQuery = null
    pendingQuery.set(null)
  }

  private fun loadPrograms() {
    if (disposed || io.isShutdown || !isAttachedToWindow) return
    val visible = max(6, ((height - headerHeight) / rowHeight).toInt())
    val ahead = 8 + min(28, moveVelocity * 2)
    val from = max(0, firstVisibleRow - ahead)
    val to = min(rows.size, firstVisibleRow + visible + ahead)
    val ids = rows.subList(from, to).map { it.id }
    if (ids.isEmpty()) {
      invalidateProgramQuery()
      programs = emptyMap()
      return
    }

    val queryStart = max(windowStartMs, viewportStartMs - horizontalPrefetchBeforeMs)
    val queryEnd = min(windowEndMs, viewportEndMs() + horizontalPrefetchAfterMs)
    // Focus can move across several already covered rows without changing the
    // query. Do not invalidate the outstanding result on each key event.
    val current = latestQuery
    if (current != null && current.startMs == queryStart && current.endMs == queryEnd && current.ids == ids) return
    val request = GuideQuery(++generation, queryStart, queryEnd, ids)
    latestQuery = request
    pendingQuery.set(request)
    scheduleQueryDrain()
  }

  /** Keep at most one active read plus the newest requested runway. */
  private fun scheduleQueryDrain() {
    if (disposed || io.isShutdown || !queryDrainScheduled.compareAndSet(false, true)) return
    try {
      io.execute(::drainProgramQueries)
    } catch (_: RejectedExecutionException) {
      // Disposal can shut down the executor between the guard and execute.
      queryDrainScheduled.set(false)
    }
  }

  private fun drainProgramQueries() {
      try {
        while (!disposed) {
          val request = pendingQuery.getAndSet(null) ?: break
          // A table swap during EPG refresh can briefly make a read fail. Keep
          // the last-good painted rows instead of replacing the canvas with an
          // empty map (the reported black-guide failure).
          val loaded = try { combinedGuide.queryGuideWindow(request.startMs, request.endMs, request.ids) } catch (_: Throwable) { null }
          if (loaded == null) {
            guideMainHandler.post {
              if (latestQuery?.token == request.token) latestQuery = null
            }
            continue
          }
          val grouped = LinkedHashMap<String, MutableList<NativeEpgProgram>>()
          for (program in loaded) grouped.getOrPut(program.channelId) { ArrayList() }.add(program)
          val frozen = grouped.mapValues { (_, list) -> list.sortedBy { it.startMs }.toTypedArray() }
          guideMainHandler.post {
            if (disposed || request.token != generation) return@post
            latestQuery = null
            // Stale-while-revalidate paint cache: replace only the rows this
            // query owned, preserve recently painted neighbours for fast reverse
            // navigation, and keep the cache strictly bounded for TV RAM.
            val merged = LinkedHashMap<String, Array<NativeEpgProgram>>()
            for ((id, list) in programs) {
              if (id !in request.ids) merged[id] = list
            }
            for (id in request.ids) {
              val list = frozen[id]
              if (list != null) merged[id] = list
            }
            val cap = if (CharmMemoryCoordinator.budgets().lowRam) LOW_RAM_PAINT_CACHE_CHANNELS else PAINT_CACHE_CHANNELS
            while (merged.size > cap) {
              val oldest = merged.keys.firstOrNull() ?: break
              merged.remove(oldest)
            }
            programs = merged
            invalidate()
            // Data arrival may update the selected programme payload, but only
            // key-up/focus ownership may declare navigation settled. If a drawer,
            // modal, or route owns focus, repaint the cache silently instead of
            // sending a late Guide selection back across the React bridge.
            if (enabled) emitSelection(false)
          }
        }
      } finally {
        queryDrainScheduled.set(false)
        if (!disposed && pendingQuery.get() != null) scheduleQueryDrain()
      }
  }

  override fun onDetachedFromWindow() {
    stopLiveClock()
    removeCallbacks(focusEntryRunnable)
    removeCallbacks(settleSelectionRunnable)
    navigationKeyDown = false
    selectKeyDown = false
    selectLongPressSeen = false
    moveVelocity = 0
    invalidateProgramQuery()
    super.onDetachedFromWindow()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (focusEntryPending && enabled) requestEntryFocus()
    scheduleLiveClock()
    applyPendingRestoreChannel()
    loadPrograms()
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (!hasWindowFocus) {
      removeCallbacks(settleSelectionRunnable)
      navigationKeyDown = false
      selectKeyDown = false
      selectLongPressSeen = false
      moveVelocity = 0
      return
    }
    if (hasWindowFocus && focusEntryPending && enabled) requestEntryFocus()
    if (enabled && hasFocus() && TvRemoteModule.remoteContext == "guide" && TvRemoteModule.guideNavigationActive) {
      emitSelection(true)
    }
  }

  fun dispose() {
    if (disposed) return
    stopLiveClock()
    focusEntryPending = false
    removeCallbacks(focusEntryRunnable)
    removeCallbacks(settleSelectionRunnable)
    navigationKeyDown = false
    moveVelocity = 0
    disposed = true
    invalidateProgramQuery()
    programs = emptyMap()
    unregisterMemoryListener()
    io.shutdownNow()
    // Shared EPG databases remain process-owned; Guide disposal only stops its reader.
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (!enabled) return super.onKeyDown(keyCode, event)
    if (rightBoundaryEnabled && keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
      if (event.repeatCount == 0) emit("rightBoundary", null)
      return true
    }
    if (rows.isEmpty()) {
      if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
        if (event.repeatCount == 0) emit("topLeftBoundary", null)
        return true
      }
      return super.onKeyDown(keyCode, event)
    }
    if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
      keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
      navigationKeyDown = true
      removeCallbacks(settleSelectionRunnable)
    }
    when (keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> {
        if (selectedRow > 0) moveVertical(-1)
        else if ((overlayMode || enableUpBoundary) && event.repeatCount == 0) emit("upBoundary", null)
      }
      KeyEvent.KEYCODE_DPAD_DOWN -> moveVertical(1)
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        liveFollowEnabled = false
        if (event.repeatCount > 0 && event.eventTime - lastHorizontalMoveAt < 55L) return true
        lastHorizontalMoveAt = event.eventTime
        if (channelRailSelected) {
          if (event.repeatCount == 0) emit("topLeftBoundary", null)
          return true
        }
        val current = selectedProgram()
        if (selectedTimeMs <= windowStartMs + 60_000L || current?.startMs == windowStartMs) {
          channelRailSelected = true
          invalidate(); emitSelection(true)
          return true
        }
        // A missing painted programme means the newest bounded SQLite runway is
        // still arriving; it is not evidence that the cursor reached Guide Left.
        val nextTime = max(
          windowStartMs,
          current?.let { it.startMs - 1L } ?: (selectedTimeMs - 30L * 60_000L),
        )
        if (nextTime == selectedTimeMs) return true
        selectedTimeMs = nextTime
        ensureSelectedTimeVisible()
        updateLiveFollowFromSelection()
        loadPrograms()
        invalidate(); emitSelection(false)
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        liveFollowEnabled = false
        if (event.repeatCount > 0 && event.eventTime - lastHorizontalMoveAt < 55L) return true
        lastHorizontalMoveAt = event.eventTime
        if (channelRailSelected) {
          channelRailSelected = false
          updateLiveFollowFromSelection()
          invalidate(); emitSelection(true)
          return true
        }
        val current = selectedProgram()
        val nextTime = min(windowEndMs - 1, current?.endMs ?: selectedTimeMs + 30L * 60_000L)
        if (nextTime == selectedTimeMs) return true
        selectedTimeMs = nextTime
        ensureSelectedTimeVisible()
        updateLiveFollowFromSelection()
        // Horizontal cache misses must request the newest runway even when the
        // viewport guard did not move. scheduleQueryDrain coalesces old requests.
        loadPrograms()
        invalidate(); emitSelection(false)
      }
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A -> {
        if (event.repeatCount == 0) {
          selectKeyDown = true
          selectLongPressSeen = false
        } else if (selectKeyDown) {
          selectLongPressSeen = true
        }
      }
      else -> return super.onKeyDown(keyCode, event)
    }
    return true
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
      keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
      navigationKeyDown = false
      moveVelocity = 0
      removeCallbacks(settleSelectionRunnable)
      if (enabled) postDelayed(settleSelectionRunnable, 80L)
      return true
    }
    if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER ||
      keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER || keyCode == KeyEvent.KEYCODE_BUTTON_A) {
      val shortPress = selectKeyDown && !selectLongPressSeen
      selectKeyDown = false
      selectLongPressSeen = false
      if (shortPress) emitSelection(true, pressed = !channelRailSelected)
      return true
    }
    return super.onKeyUp(keyCode, event)
  }

  private fun moveVertical(delta: Int) {
    val nextRow = (selectedRow + delta).coerceIn(0, rows.lastIndex)
    if (nextRow == selectedRow) return
    val now = SystemClock.uptimeMillis()
    moveVelocity = if (now - lastMoveAt < 150L) min(4, moveVelocity + 1) else 0
    lastMoveAt = now
    selectedRow = nextRow
    ensureVisible()
    loadPrograms()
    invalidate()
    emitSelection(false)
    emitRunway(delta)
  }

  private fun ensureVisible() {
    val visible = max(1, ((height - headerHeight) / rowHeight).toInt())
    if (selectedRow < firstVisibleRow) firstVisibleRow = selectedRow
    if (selectedRow >= firstVisibleRow + visible) firstVisibleRow = selectedRow - visible + 1
    firstVisibleRow = firstVisibleRow.coerceIn(0, max(0, rows.size - visible))
    val logoCount = ceil((height - headerHeight).coerceAtLeast(0f) / rowHeight).toInt().coerceIn(0, 32)
    val ids = rows.subList(firstVisibleRow, min(rows.size, firstVisibleRow + logoCount)).map { it.id }
    if (lastLogoFirst != firstVisibleRow || ids != lastLogoIds) {
      lastLogoFirst = firstVisibleRow
      lastLogoIds = ids
      emit("logoViewport", Arguments.createMap().apply {
        putArray("ids", Arguments.fromList(ids))
        putDouble("rowHeight", (rowHeight / density).toDouble())
        putDouble("headerHeight", (headerHeight / density).toDouble())
      })
    }
  }

  private fun selectedProgram(): NativeEpgProgram? {
    val id = rows.getOrNull(selectedRow)?.id ?: return null
    val list = programs[id] ?: return null
    var low = 0
    var high = list.size
    while (low < high) { val mid = (low + high) ushr 1; if (list[mid].startMs <= selectedTimeMs) low = mid + 1 else high = mid }
    val candidate = list.getOrNull(max(0, low - 1))
    return if (candidate != null && candidate.endMs > selectedTimeMs) candidate else list.getOrNull(low)
  }

  private fun emitSelection(immediate: Boolean, pressed: Boolean = false) {
    val row = rows.getOrNull(selectedRow) ?: return
    val program = selectedProgram()
    contentDescription = if (program == null) row.label else "${row.label}, ${program.title}"
    val payload = Arguments.createMap().apply {
      putString("channelId", row.id)
      putInt("row", selectedRow)
      putBoolean("settled", immediate || (!navigationKeyDown && moveVelocity == 0))
      putBoolean("pressed", pressed)
      putString("surface", if (channelRailSelected) "channel" else "program")
      if (program != null) {
        putMap("program", Arguments.createMap().apply {
          putString("title", program.title); putString("desc", program.description ?: "")
          putString("category", program.category ?: ""); putDouble("startMs", program.startMs.toDouble())
          putDouble("endMs", program.endMs.toDouble())
        })
      }
    }
    emit("selectionChange", payload)
  }

  private fun emitRunway(direction: Int) {
    val visible = max(6, ((height - headerHeight) / rowHeight).toInt())
    val aheadPages = 2 + moveVelocity
    val behind = visible
    val ahead = visible * aheadPages
    val from = max(0, selectedRow - if (direction < 0) ahead else behind)
    val to = min(rows.size, selectedRow + if (direction > 0) ahead else behind + 1)
    val payload = Arguments.createMap().apply {
      putArray("ids", Arguments.fromList(rows.subList(from, to).map { it.id }))
      putArray("priorityIds", Arguments.fromList(rows.subList(selectedRow, min(rows.size, selectedRow + max(3, visible))).map { it.id }))
      putInt("pageSize", visible); putInt("velocity", moveVelocity); putInt("direction", direction)
    }
    emit("runwayChange", payload)
  }

  @Suppress("DEPRECATION")
  private fun emit(name: String, payload: com.facebook.react.bridge.WritableMap?) {
    (context as? ThemedReactContext)?.getJSModule(RCTEventEmitter::class.java)?.receiveEvent(id, name, payload)
  }

  private fun timeToX(timeMs: Long, visibleStartMs: Long, visibleEndMs: Long): Float {
    val guideWidth = max(1f, width.toFloat() - channelWidth)
    val duration = max(1L, visibleEndMs - visibleStartMs)
    return channelWidth + ((timeMs - visibleStartMs).toFloat() / duration.toFloat()) * guideWidth
  }

  private fun advanceLiveViewport(now: Long) {
    if (!enabled || !liveFollowEnabled || windowEndMs <= windowStartMs) return
    val configuredWindowMs = max(visibleWindowMs, windowEndMs - windowStartMs)
    val rollingStart = now - liveWindowHistoryMs
    if (rollingStart >= windowStartMs + liveWindowAdvanceThresholdMs) {
      windowStartMs = rollingStart
      windowEndMs = rollingStart + configuredWindowMs
    }
    val liveTime = now.coerceIn(windowStartMs, windowEndMs - 1)
    val desiredStart = clampViewportStart(liveTime - 15L * 60_000L)
    if (abs(desiredStart - viewportStartMs) < 60_000L) return
    viewportStartMs = desiredStart
    selectedTimeMs = liveTime
    // Query only when the live runway has materially advanced. Repaint movement
    // is cheap; SQLite reads remain bounded and coalesced.
    if (abs(viewportStartMs - lastLiveFollowQueryStartMs) >= 2L * 60_000L) {
      lastLiveFollowQueryStartMs = viewportStartMs
      loadPrograms()
    }
    if (enabled && rows.isNotEmpty()) emitSelection(false)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val wallClockNow = System.currentTimeMillis()
    advanceLiveViewport(wallClockNow)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), background)
    canvas.drawRect(0f, 0f, width.toFloat(), headerHeight, header)

    val visibleStartMs = viewportStartMs
    val visibleEndMs = viewportEndMs()
    drawHeader(canvas, visibleStartMs, visibleEndMs)

    val visibleRows = max(1, ceil((height - headerHeight) / rowHeight).toInt())
    for (slot in 0 until visibleRows) {
      val rowIndex = firstVisibleRow + slot
      val row = rows.getOrNull(rowIndex) ?: break
      val top = headerHeight + slot * rowHeight
      channel.color = if (rowIndex == selectedRow && channelRailSelected) Color.rgb(168, 44, 255) else Color.rgb(27, 30, 37)
      channel.alpha = if (overlayMode && !(rowIndex == selectedRow && channelRailSelected))
        (255f * (1f - 0.005f * transparencyLevel)).toInt().coerceIn(0, 255) else 255
      canvas.drawRect(0f, top, channelWidth, top + rowHeight - density, channel)
      canvas.drawRect(channelWidth, top, width.toFloat(), top + rowHeight - density, rowSurface)
      if (showLogos) {
        drawClippedText(canvas, row.displayNumber, pad, top + rowHeight * .62f, 33f * density, if (row.number.length <= 4) muted else numberPaint)
        drawClippedText(canvas, row.name, 90f * density, top + rowHeight * .62f, channelWidth - pad, title)
      } else {
        drawClippedText(canvas, row.label, pad, top + rowHeight * .62f, channelWidth - pad, title)
      }

      val list = programs[row.id].orEmpty()
      var gapStart = visibleStartMs
      val programmeRowSelected = !channelRailSelected && rowIndex == selectedRow
      for (program in list) {
        if (program.endMs <= visibleStartMs || program.startMs >= visibleEndMs) continue
        if (program.startMs > gapStart) {
          drawProgrammeGap(canvas, gapStart, program.startMs, visibleStartMs, visibleEndMs, top, programmeRowSelected)
        }
        gapStart = max(gapStart, min(program.endMs, visibleEndMs))
        val left = timeToX(program.startMs, visibleStartMs, visibleEndMs)
        val right = timeToX(program.endMs, visibleStartMs, visibleEndMs)
        val clippedLeft = max(channelWidth, left)
        val clippedRight = min(width.toFloat(), right)
        if (clippedRight <= clippedLeft) continue
        val chosen = programmeRowSelected && program.startMs <= selectedTimeMs && program.endMs > selectedTimeMs
        canvas.drawRect(clippedLeft + density, top + density, clippedRight - density,
          top + rowHeight - 2f * density, if (chosen) selected else cell)
        drawClippedText(canvas, program.title, clippedLeft + pad, top + rowHeight * .60f, clippedRight - pad, title)
      }
      if (gapStart < visibleEndMs) {
        drawProgrammeGap(canvas, gapStart, visibleEndMs, visibleStartMs, visibleEndMs, top, programmeRowSelected)
      }
      canvas.drawLine(0f, top + rowHeight, width.toFloat(), top + rowHeight, divider)
    }

    if (wallClockNow in visibleStartMs..visibleEndMs) {
      val x = timeToX(wallClockNow, visibleStartMs, visibleEndMs)
      canvas.drawLine(x, headerHeight, x, height.toFloat(), nowPaint)
    }
  }

  /** Draw uncovered time slots without allocating or persisting placeholder programmes. */
  private fun drawProgrammeGap(
    canvas: Canvas, gapStart: Long, gapEnd: Long, visibleStart: Long, visibleEnd: Long,
    top: Float, rowSelected: Boolean,
  ) {
    val halfHourMs = 30L * 60_000L
    var start = gapStart
    var labelDrawn = false
    while (start < gapEnd) {
      val end = min(gapEnd, ((start / halfHourMs) + 1L) * halfHourMs)
      if (end <= start) break
      val left = timeToX(start, visibleStart, visibleEnd)
      val right = timeToX(end, visibleStart, visibleEnd)
      if (right - left > 2f * density) {
        val chosen = rowSelected && selectedTimeMs >= start && selectedTimeMs < end
        canvas.drawRect(left + density, top + density, right - density,
          top + rowHeight - 2f * density, if (chosen) selected else cell)
        canvas.drawLine(right, top, right, top + rowHeight, divider)
        if (!labelDrawn && right - left >= 72f * density) {
          drawClippedText(canvas, "No information", left + pad, top + rowHeight * .60f, right - pad, muted)
          labelDrawn = true
        }
      }
      start = end
    }
  }

  private fun drawHeader(canvas: Canvas, start: Long, end: Long) {
    canvas.drawText("CHANNEL", pad, headerHeight * .66f, muted)
    var tick = ((start / 1_800_000L) + 1) * 1_800_000L
    while (tick < end) {
      val x = timeToX(tick, start, end)
      tickDate.time = tick
      val timeLabel = timeFormatter.format(tickDate)
      canvas.drawText(timeLabel, x + pad, headerHeight * .66f, muted)
      canvas.drawLine(x, headerHeight, x, height.toFloat(), divider)
      tick += 1_800_000L
    }
  }

  private fun drawClippedText(canvas: Canvas, value: String, x: Float, baseline: Float, right: Float, paint: Paint) {
    if (right <= x) return
    canvas.save(); canvas.clipRect(x, baseline - rowHeight, right, baseline + pad)
    canvas.drawText(value, x, baseline, paint); canvas.restore()
  }

  companion object {
    private const val LIVE_CLOCK_TICK_MS = 30_000L
    private const val PAINT_CACHE_CHANNELS = 128
    private const val LOW_RAM_PAINT_CACHE_CHANNELS = 64
  }
}
