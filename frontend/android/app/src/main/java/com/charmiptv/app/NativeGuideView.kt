package com.charmiptv.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import com.facebook.react.bridge.Arguments
import com.bumptech.glide.Glide
import com.bumptech.glide.request.target.CustomTarget
import com.bumptech.glide.request.transition.Transition
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Constant-view-count TV guide. Selection is logical coordinates, never Android focus nodes.
 * Program X/width are always derived from real start/end times against the same viewport used
 * by the header. SQLite reads follow the visible time runway so horizontal navigation cannot
 * outrun the queried EPG window and expose false empty columns.
 */
class NativeGuideView(context: Context) : View(context) {
  private data class ChannelRow(val id: String, val name: String, val number: String, val label: String)
  private data class GuideQuery(val token: Int, val startMs: Long, val endMs: Long, val ids: List<String>)

  // Reads every enabled guide store through the same binding-aware repository
  // as the React bridge; the canvas must never fall back to primary-only SQL.
  private val combinedGuide = CombinedGuideRepository(context.applicationContext, PAINT_DESCRIPTION_CHARS)
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
  @Volatile private var pendingQuery: GuideQuery? = null
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
  private var lastRestoreChannelId: String? = null
  private var restoreGeneration = 0
  // Rows whose read already covers this time range, including rows with no
  // programmes. These skip SQLite until the range changes or the TTL lapses,
  // and the TTL lets a finished EPG refresh reach rows that stay on screen.
  private val coveredRows = HashSet<String>()
  private var coveredStartMs = 0L
  private var coveredEndMs = 0L
  private var coveredAtMs = 0L
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
      // Growing delays span about 1.8s, enough for a closing drawer to hand back
      // the remote owner.
      focusEntryAttempts += 1
      if (focusEntryAttempts < 6) postDelayed(this, 120L * focusEntryAttempts)
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
      coveredRows.clear()
      generation += 1
      pendingQuery = null
      loadPrograms()
      invalidate()
    }
  }

  private val density = resources.displayMetrics.density
  // Phone ("compact") layout changes these, so they are variables. The TV values are the defaults.
  private var channelWidth = 184f * density
  private var headerHeight = 38f * density
  private var baseRowHeight = 54f * density
  // Stretched in onSizeChanged so a whole number of rows fills the grid exactly.
  private var rowHeight = baseRowHeight
  private val pad = 8f * density

  /** Three visible hours gives six equal 30-minute header columns on every TV size. */
  private var visibleWindowMs = 3L * 60L * 60_000L
  private val horizontalPrefetchBeforeMs = 30L * 60_000L
  private val horizontalPrefetchAfterMs = 60L * 60_000L
  private val liveWindowHistoryMs = 60L * 60_000L
  private val liveWindowAdvanceThresholdMs = 60_000L

  // Neon-glass palette shared with the rest of the app. Plain fills and one
  // stroke: rounded cells cost the same as the old rectangles to paint.
  private val background = Paint().apply { color = Color.rgb(18, 8, 38) }
  private val header = Paint().apply { color = Color.rgb(30, 14, 60) }
  private val channel = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = CHANNEL_COLOR }
  private val rowSurface = Paint().apply { color = Color.rgb(20, 9, 42) }
  private val cell = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(44, 22, 84) }
  private val selected = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = SELECTED_COLOR }
  private val selectedEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 1.5f * density }
  private val divider = Paint().apply { color = Color.argb(40, 235, 205, 255); strokeWidth = density }
  private val nowPaint = Paint().apply { color = Color.rgb(232, 121, 249); strokeWidth = 2f * density }
  private val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 13f * density }
  private val muted = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(196, 166, 240); textSize = 11f * density }
  private val cellRadius = 12f * density
  // Colour-coded programme cells (as in the approved Guide design): tinted by genre, purple when the genre is unknown.
  private val tintPaints = arrayOf(
    Color.rgb(78, 34, 150),   // 0 purple: default
    Color.rgb(135, 48, 62),   // 1 red: news, crime, documentary
    Color.rgb(20, 98, 92),    // 2 teal: sport
    Color.rgb(34, 68, 148),   // 3 blue: talk, reality, kids, education
    Color.rgb(128, 82, 36),   // 4 amber: game shows, comedy, music
    Color.rgb(132, 50, 120),  // 5 magenta: movies, drama, series
  ).map { colour -> Paint(Paint.ANTI_ALIAS_FLAG).apply { color = colour } }
  private val noInfoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(52, 46, 78) }
  private val cellEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(80, 235, 205, 255); style = Paint.Style.STROKE; strokeWidth = density }
  private val elapsedShade = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(70, 0, 0, 0) }
  private val tileFill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val tileText = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD }
  private val headerLabel = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 14f * density; typeface = android.graphics.Typeface.DEFAULT_BOLD }

  private fun tintFor(program: NativeEpgProgram): Paint {
    val category = program.category?.lowercase(Locale.ROOT).orEmpty()
    val index = when {
      category.isBlank() -> (program.title.hashCode() and 0x7fffffff) % tintPaints.size
      "news" in category || "crime" in category || "document" in category || "true" in category -> 1
      "sport" in category -> 2
      "talk" in category || "reality" in category || "kid" in category || "child" in category || "educ" in category -> 3
      "game" in category || "comedy" in category || "music" in category || "variety" in category -> 4
      "movie" in category || "film" in category || "drama" in category || "series" in category -> 5
      else -> 0
    }
    return tintPaints[index].also { it.alpha = cell.alpha }
  }
  // Reused for every cell so a repaint allocates nothing.
  private val cellRect = RectF()

  // Channel logos. JS sends logo addresses only for the rows near the cursor
  // (never the whole catalog); Glide decodes each at a small fixed size and at
  // most MAX_LOGO_BITMAPS stay referenced here, so memory stays bounded.
  private val logoUrlById = HashMap<String, String>()
  private val logoBox = 34f * density
  private val logoPx = (logoBox * 1.25f).toInt().coerceIn(48, 128)
  private val logoBacking = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(235, 255, 255, 255) }
  private val logoPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
  private val logoRect = RectF()
  private inner class LogoTarget : CustomTarget<Bitmap>(logoPx, logoPx) {
    var bitmap: Bitmap? = null
    override fun onResourceReady(resource: Bitmap, transition: Transition<in Bitmap>?) { bitmap = resource; invalidate() }
    override fun onLoadCleared(placeholder: Drawable?) { bitmap = null }
    override fun onLoadFailed(errorDrawable: Drawable?) { bitmap = null }
  }
  private val logoTargets = object : LinkedHashMap<String, LogoTarget>(32, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, LogoTarget>): Boolean {
      if (size <= MAX_LOGO_BITMAPS) return false
      releaseLogo(eldest.value)
      return true
    }
  }

  private fun releaseLogo(target: LogoTarget) {
    target.bitmap = null
    try { Glide.with(context.applicationContext).clear(target) } catch (_: Throwable) {}
  }

  private fun releaseAllLogos() {
    for (target in logoTargets.values) releaseLogo(target)
    logoTargets.clear()
  }

  fun setVisibleLogos(value: ReadableMap?) {
    logoUrlById.clear()
    if (value != null) {
      val iterator = value.keySetIterator()
      while (iterator.hasNextKey()) {
        val id = iterator.nextKey()
        val url = value.getString(id)
        if (!url.isNullOrBlank()) logoUrlById[id] = url
      }
    }
    if (logoUrlById.isEmpty()) releaseAllLogos()
    invalidate()
  }

  private fun logoFor(url: String): Bitmap? {
    logoTargets[url]?.let { return it.bitmap }
    if (disposed) return null
    val target = LogoTarget()
    logoTargets[url] = target
    try {
      Glide.with(context.applicationContext).asBitmap().load(url).fitCenter().into(target)
    } catch (_: Throwable) {}
    return null
  }

  /** Draws the logo on a light tile (dark logos stay readable); returns the space it used. */
  private fun drawRowLogo(canvas: Canvas, rowId: String, name: String, top: Float): Float {
    val size = min(if (compact) 40f * density else logoBox, rowHeight - 12f * density)
    if (size <= 8f * density) return 0f
    val left = pad
    val boxTop = top + (rowHeight - density - size) / 2f
    val url = logoUrlById[rowId]
    if (url == null) {
      // No logo yet: a colourful tile with the channel's letters, as in the approved design.
      logoRect.set(left, boxTop, left + size, boxTop + size)
      tileFill.color = TILE_COLORS[(name.hashCode() and 0x7fffffff) % TILE_COLORS.size]
      canvas.drawRoundRect(logoRect, 9f * density, 9f * density, tileFill)
      val initials = tileLetters(name)
      tileText.textSize = size * (if (initials.length > 2) 0.30f else 0.38f)
      canvas.drawText(initials, left + size / 2f, boxTop + size / 2f + tileText.textSize * 0.35f, tileText)
      return size + pad
    }
    logoRect.set(left, boxTop, left + size, boxTop + size)
    canvas.drawRoundRect(logoRect, 6f * density, 6f * density, logoBacking)
    val bitmap = logoFor(url)
    if (bitmap != null && !bitmap.isRecycled && bitmap.width > 0 && bitmap.height > 0) {
      val inset = 3f * density
      val maxW = size - 2f * inset
      val scale = min(maxW / bitmap.width, maxW / bitmap.height)
      val w = bitmap.width * scale
      val h = bitmap.height * scale
      logoRect.set(left + (size - w) / 2f, boxTop + (size - h) / 2f, left + (size + w) / 2f, boxTop + (size + h) / 2f)
      canvas.drawBitmap(bitmap, null, logoRect, logoPaint)
    }
    return size + pad
  }
  /** Letters for a logo-less tile: skips a leading "USA:" / "UK |" style prefix, so channels do not all read "USA". */
  private fun tileLetters(name: String): String {
    var text = name.trim()
    val cut = text.indexOfFirst { it == ':' || it == '|' }
    if (cut in 1..6 && text.substring(cut + 1).isNotBlank()) text = text.substring(cut + 1).trim()
    text = text.trimStart('*', '-', ' ')
    return text.split(' ').firstOrNull().orEmpty().take(3).uppercase(Locale.ROOT)
  }

  private val nameText = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; typeface = android.graphics.Typeface.DEFAULT_BOLD }

  /** The phone's channel name: the whole name on up to two lines beside the tile, never cut to a few letters. */
  private fun drawChannelName(canvas: Canvas, name: String, x: Float, top: Float, right: Float) {
    val room = right - x
    if (room <= 8f * density) return
    nameText.textSize = 12f * density
    val mid = top + rowHeight / 2f
    val whole = nameText.breakText(name, true, room, null)
    if (whole >= name.length) {
      canvas.drawText(name, x, mid + nameText.textSize * 0.35f, nameText)
      return
    }
    var cut = name.lastIndexOf(' ', whole)
    if (cut <= 0) cut = whole
    val first = name.substring(0, cut).trim()
    var second = name.substring(cut).trim()
    val fits = nameText.breakText(second, true, room, null)
    if (fits < second.length) second = second.substring(0, max(0, fits - 1)).trimEnd() + "…"
    canvas.drawText(first, x, mid - nameText.textSize * 0.1f, nameText)
    canvas.drawText(second, x, mid + nameText.textSize * 1.1f, nameText)
  }

  /** Phone only: how far the channel column has slid out of view as the guide scrolls forward in time. */
  private fun channelSlidePx(): Float {
    if (!compact) return 0f
    val liveBase = max(windowStartMs, System.currentTimeMillis() - 15L * 60_000L)
    val pxPerMs = max(1f, width.toFloat() - channelWidth) / max(1L, visibleWindowMs).toFloat()
    return ((viewportStartMs - liveBase).toFloat() * pxPerMs).coerceIn(0f, channelWidth)
  }

  private var timeFormatter = SimpleDateFormat("h:mm a", Locale.getDefault())
  private val tickDate = Date()
  private var use24HourClock = false

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    setBackgroundColor(Color.TRANSPARENT)
    background.alpha = 0
    rowSurface.alpha = 0
    header.alpha = 110
  }

  private var overlayMode = false
  // Direct see-through percentages. Preview mode remains fully opaque.
  private var transparencyLevel = 60
  private var channelTransparencyLevel = 75
  var enableUpBoundary = false
  fun setTransparencyLevel(value: Int) {
    val next = value.coerceIn(0, 100)
    if (next == transparencyLevel) return
    transparencyLevel = next
    applyGuideOpacity()
  }
  fun setChannelTransparencyLevel(value: Int) {
    val next = value.coerceIn(0, 100)
    if (next == channelTransparencyLevel) return
    channelTransparencyLevel = next
    invalidate()
  }
  fun setOverlayMode(value: Boolean) {
    if (overlayMode == value) return
    overlayMode = value
    applyGuideOpacity()
  }
  private fun guideOpacity(): Int =
    if (overlayMode) (255f * (1f - 0.01f * transparencyLevel)).toInt().coerceIn(0, 255) else 255
  private fun applyGuideOpacity() {
    val opacity = guideOpacity()
    // Only the visible cell/channel surface takes the configured alpha, so two
    // stacked translucent rectangles never hide the video behind the guide.
    // Clear in both modes: on the Guide page the crown background shows between the cells.
    setBackgroundColor(Color.TRANSPARENT)
    background.alpha = 0
    header.alpha = if (overlayMode) opacity else 110
    rowSurface.alpha = 0
    cell.alpha = opacity
    invalidate()
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
      nextRows.add(ChannelRow(id, name, number, if (number.isBlank()) name else "$number  $name"))
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
    coveredRows.clear()

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

  fun setClock24h(value: Boolean) {
    if (value == use24HourClock) return
    use24HourClock = value
    timeFormatter = SimpleDateFormat(if (value) "HH:mm" else "h:mm a", Locale.getDefault())
    invalidate()
  }

  fun setActive(value: Boolean) {
    val wasEnabled = enabled
    enabled = value
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
    // React may re-apply an unchanged active=true prop while Preview owns focus.
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
    lastRestoreChannelId = wanted
    pendingRestoreChannelId = wanted
    applyPendingRestoreChannel()
  }

  /** Re-applies an unchanged restore id: a repeat jump to the same channel sends no new id. */
  fun setRestoreGeneration(value: Int) {
    if (value == restoreGeneration) return
    restoreGeneration = value
    pendingRestoreChannelId = lastRestoreChannelId ?: return
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
    coveredRows.clear()
    generation += 1
    pendingQuery = null
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

  private fun loadPrograms() {
    if (disposed || io.isShutdown) return
    val visible = max(6, ((height - headerHeight) / rowHeight).toInt())
    val ahead = 8 + min(28, moveVelocity * 2)
    val from = max(0, firstVisibleRow - ahead)
    val to = min(rows.size, firstVisibleRow + visible + ahead)
    val ids = rows.subList(from, to).map { it.id }
    if (ids.isEmpty()) {
      generation += 1
      pendingQuery = null
      programs = emptyMap()
      return
    }

    val queryStart = max(windowStartMs, viewportStartMs - horizontalPrefetchBeforeMs)
    val queryEnd = min(windowEndMs, viewportEndMs() + horizontalPrefetchAfterMs)
    val coverageFresh = SystemClock.uptimeMillis() - coveredAtMs < COVERAGE_TTL_MS
    if (coverageFresh && queryStart >= coveredStartMs && queryEnd <= coveredEndMs && coveredRows.containsAll(ids)) return
    pendingQuery = GuideQuery(++generation, queryStart, queryEnd, ids)
    scheduleQueryDrain()
  }

  /** Keep at most one active read plus the newest requested runway. */
  private fun scheduleQueryDrain() {
    if (disposed || io.isShutdown || !queryDrainScheduled.compareAndSet(false, true)) return
    io.execute {
      try {
        while (!disposed) {
          val request = pendingQuery ?: break
          pendingQuery = null
          // A table swap during EPG refresh can briefly make a read fail. Keep
          // the last-good painted rows instead of replacing the canvas with an
          // empty map (the reported black-guide failure).
          val loaded = try { combinedGuide.queryGuideWindow(request.startMs, request.endMs, request.ids) } catch (_: Throwable) { null }
          if (loaded == null) continue
          val grouped = LinkedHashMap<String, MutableList<NativeEpgProgram>>()
          for (program in loaded) grouped.getOrPut(program.channelId) { ArrayList() }.add(program)
          val frozen = grouped.mapValues { (_, list) -> list.sortedBy { it.startMs }.toTypedArray() }
          post {
            if (disposed || request.token != generation) return@post
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
              coveredRows.remove(oldest)
            }
            val readAt = SystemClock.uptimeMillis()
            if (request.startMs != coveredStartMs || request.endMs != coveredEndMs || readAt - coveredAtMs >= COVERAGE_TTL_MS) {
              coveredRows.clear()
              coveredStartMs = request.startMs
              coveredEndMs = request.endMs
              coveredAtMs = readAt
            }
            coveredRows.addAll(request.ids)
            for (id in request.ids) if (id !in merged && frozen[id] != null) coveredRows.remove(id)
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
        if (!disposed && pendingQuery != null) scheduleQueryDrain()
      }
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
    generation += 1
    pendingQuery = null
    releaseAllLogos()
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
    if (hasWindowFocus && focusEntryPending && enabled) requestEntryFocus()
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
    generation += 1
    pendingQuery = null
    programs = emptyMap()
    releaseAllLogos()
    logoUrlById.clear()
    unregisterMemoryListener()
    io.shutdownNow()
    // Shared EPG databases remain process-owned; Guide disposal only stops its reader.
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (!enabled) return super.onKeyDown(keyCode, event)
    if (rows.isEmpty()) {
      if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) { emit("topLeftBoundary", null); return true }
      return super.onKeyDown(keyCode, event)
    }
    if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
      keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
      navigationKeyDown = true
      removeCallbacks(settleSelectionRunnable)
    }
    when (keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> if (selectedRow != 0) moveVertical(-1) else if (overlayMode || enableUpBoundary) emit("upBoundary", null)
      KeyEvent.KEYCODE_DPAD_DOWN -> moveVertical(1)
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        liveFollowEnabled = false
        if (event.repeatCount > 0 && event.eventTime - lastHorizontalMoveAt < 55L) return true
        lastHorizontalMoveAt = event.eventTime
        if (channelRailSelected) {
          emit("topLeftBoundary", null)
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
      // OK plays from both surfaces: a programme cell (details/watch) and the
      // channel name itself, now that the preview row has no Play button.
      if (shortPress) emitSelection(true, pressed = true)
      return true
    }
    return super.onKeyUp(keyCode, event)
  }

  // ---- Touch (phones, tablets, mouse): a tap picks the cell under the finger
  // and opens it like OK; a drag scrolls channels (up/down) and time (sideways).
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
  private var touchDownX = 0f
  private var touchDownY = 0f
  private var touchLastX = 0f
  private var touchLastY = 0f
  private var touchDragging = false
  private var touchRowCarry = 0f

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!enabled || rows.isEmpty()) return super.onTouchEvent(event)
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        touchDownX = event.x; touchDownY = event.y
        touchLastX = event.x; touchLastY = event.y
        touchDragging = false
        touchRowCarry = 0f
        // A page that scrolls must not take the drag away from the grid.
        parent?.requestDisallowInterceptTouchEvent(true)
      }
      MotionEvent.ACTION_MOVE -> {
        if (!touchDragging && (abs(event.x - touchDownX) > touchSlop || abs(event.y - touchDownY) > touchSlop)) {
          touchDragging = true
          touchLastX = event.x; touchLastY = event.y
        }
        if (touchDragging) {
          touchRowCarry += (touchLastY - event.y) / rowHeight
          val wholeRows = touchRowCarry.toInt()
          if (wholeRows != 0) {
            touchRowCarry -= wholeRows
            scrollRowsByTouch(wholeRows)
          }
          if (touchDownX > channelWidth - channelSlidePx()) scrollTimeByTouch(touchLastX - event.x)
          touchLastX = event.x; touchLastY = event.y
          invalidate()
        }
      }
      MotionEvent.ACTION_UP -> {
        if (touchDragging) {
          touchDragging = false
          loadPrograms()
          emitSelection(true)
        } else {
          tapAt(event.x, event.y)
        }
      }
      MotionEvent.ACTION_CANCEL -> touchDragging = false
      else -> return super.onTouchEvent(event)
    }
    return true
  }

  private fun scrollRowsByTouch(delta: Int) {
    val visible = fullRowCount()
    val next = (firstVisibleRow + delta).coerceIn(0, max(0, rows.size - visible))
    if (next == firstVisibleRow) return
    firstVisibleRow = next
    // The cursor follows only when it would leave the screen.
    val kept = selectedRow.coerceIn(firstVisibleRow, min(rows.lastIndex, firstVisibleRow + visible - 1))
    val moved = kept != selectedRow
    selectedRow = kept
    loadPrograms()
    emitRunway(if (delta > 0) 1 else -1)
    if (moved) emitSelection(false)
  }

  private fun scrollTimeByTouch(dx: Float) {
    if (dx == 0f) return
    val guideWidth = max(1f, width.toFloat() - channelWidth)
    val shift = (dx / guideWidth * visibleWindowMs.toFloat()).toLong()
    if (shift == 0L) return
    val next = clampViewportStart(viewportStartMs + shift)
    if (next == viewportStartMs) return
    liveFollowEnabled = false
    viewportStartMs = next
    selectedTimeMs = selectedTimeMs.coerceIn(viewportStartMs, max(viewportStartMs, viewportEndMs() - 1))
  }

  private fun tapAt(x: Float, y: Float) {
    if (y < headerHeight) return
    val row = firstVisibleRow + ((y - headerHeight) / rowHeight).toInt()
    if (row < 0 || row > rows.lastIndex) return
    requestFocus()
    selectedRow = row
    if (x < channelWidth - channelSlidePx()) {
      channelRailSelected = true
    } else {
      channelRailSelected = false
      val guideWidth = max(1f, width.toFloat() - channelWidth)
      val span = max(1L, viewportEndMs() - viewportStartMs)
      val time = viewportStartMs + ((x - channelWidth) / guideWidth * span.toFloat()).toLong()
      selectedTimeMs = time.coerceIn(windowStartMs, windowEndMs - 1)
      updateLiveFollowFromSelection()
    }
    ensureVisible()
    loadPrograms()
    invalidate()
    emitSelection(true, pressed = true)
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

  /** The small bias keeps float rounding from counting an exact fit one row short. */
  private fun fullRowCount(): Int = max(1, ((height - headerHeight) / rowHeight + 0.01f).toInt())

  private var compact = false

  /**
   * The phone layout of the Guide: a narrow column of channel tiles, taller rows, bigger text and a shorter
   * time window (90 minutes upright, 2 hours sideways) so every programme is readable. The TV keeps its own values.
   */
  fun setCompact(value: Boolean) {
    if (compact == value) return
    compact = value
    channelWidth = (if (value) 142f else 184f) * density
    headerHeight = (if (value) 40f else 38f) * density
    baseRowHeight = (if (value) 68f else 54f) * density
    title.textSize = (if (value) 14f else 13f) * density
    muted.textSize = (if (value) 12f else 11f) * density
    headerLabel.textSize = (if (value) 13f else 14f) * density
    if (width > 0 && height > 0) onSizeChanged(width, height, width, height)
    invalidate()
  }

  private fun applyCompactWindow(w: Int, h: Int) {
    visibleWindowMs = if (!compact) 3L * 60L * 60_000L else if (h > w) 90L * 60_000L else 120L * 60_000L
    viewportStartMs = clampViewportStart(viewportStartMs)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    applyCompactWindow(w, h)
    val gridHeight = h - headerHeight
    if (gridHeight <= 0f) return
    rowHeight = gridHeight / max(1, (gridHeight / baseRowHeight).toInt())
    ensureVisible()
    loadPrograms()
    invalidate()
  }

  private fun ensureVisible() {
    val visible = fullRowCount()
    if (selectedRow < firstVisibleRow) firstVisibleRow = selectedRow
    if (selectedRow >= firstVisibleRow + visible) firstVisibleRow = selectedRow - visible + 1
    firstVisibleRow = firstVisibleRow.coerceIn(0, max(0, rows.size - visible))
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
    // The last physical channel is also the bottom of the EPG grid.
    // Clipping both cells and time markers prevents phantom partial rows below it.
    val visibleRows = fullRowCount()
    val drawnRows = min(visibleRows, (rows.size - firstVisibleRow).coerceAtLeast(0))
    val gridBottom = min(height.toFloat(), headerHeight + drawnRows * rowHeight)
    val slide = channelSlidePx()
    val guideLeft = channelWidth - slide
    // The time that now shows in the strip the channel column left behind.
    val slideMs = if (slide > 0f) (slide / (max(1f, width.toFloat() - channelWidth) / max(1L, visibleEndMs - visibleStartMs).toFloat())).toLong() else 0L
    drawHeader(canvas, visibleStartMs, visibleEndMs, gridBottom, slide, slideMs)

    canvas.save()
    canvas.clipRect(0f, headerHeight, width.toFloat(), gridBottom)
    for (slot in 0 until drawnRows) {
      val rowIndex = firstVisibleRow + slot
      val row = rows.getOrNull(rowIndex) ?: break
      val top = headerHeight + slot * rowHeight
      val channelChosen = rowIndex == selectedRow && channelRailSelected
      channel.color = if (channelChosen) SELECTED_COLOR else CHANNEL_COLOR
      // Setting a color resets alpha, so the channel column's opacity is applied per row.
      channel.alpha = if (overlayMode && !(rowIndex == selectedRow && channelRailSelected))
        (255f * (1f - 0.01f * channelTransparencyLevel)).toInt().coerceIn(0, 255) else 255
      canvas.drawRect(guideLeft, top, width.toFloat(), top + rowHeight - density, rowSurface)
      if (slide < channelWidth) {
        canvas.save()
        canvas.translate(-slide, 0f)
        paintCell(canvas, density, top + density, channelWidth - density, top + rowHeight - 2f * density, channel, channelChosen)
        val logoSpace = drawRowLogo(canvas, row.id, row.name, top)
        // Phone: the logo tile with the whole channel name beside it (two lines if needed).
        if (compact) drawChannelName(canvas, row.name, pad + logoSpace, top, channelWidth - pad)
        else drawClippedText(canvas, row.label, pad + logoSpace, top + rowHeight * .62f, channelWidth - pad, title)
        canvas.restore()
      }

      val list = programs[row.id].orEmpty()
      // Every stretch of the row is painted: a hole in the EPG data shows a
      // selectable "No information" cell rather than black space with no focus.
      var gapStart = visibleStartMs - slideMs
      var paintedProgramme = false
      fun paintGap(start: Long, end: Long) {
        val left = max(guideLeft, timeToX(start, visibleStartMs, visibleEndMs)) + density
        val right = min(width.toFloat(), timeToX(end, visibleStartMs, visibleEndMs)) - density
        if (right <= left) return
        val chosen = !channelRailSelected && rowIndex == selectedRow && selectedTimeMs >= start && selectedTimeMs < end
        paintCell(canvas, left, top + density, right, top + rowHeight - 2f * density, if (chosen) selected else noInfoPaint.also { it.alpha = cell.alpha }, chosen)
        drawClippedText(canvas, "No information", left + pad, top + rowHeight * .60f, right - pad, muted)
      }
      for (program in list) {
        if (program.endMs <= visibleStartMs - slideMs || program.startMs >= visibleEndMs) continue
        val left = timeToX(program.startMs, visibleStartMs, visibleEndMs)
        val right = timeToX(program.endMs, visibleStartMs, visibleEndMs)
        val clippedLeft = max(guideLeft, left)
        val clippedRight = min(width.toFloat(), right)
        if (clippedRight <= clippedLeft) continue
        paintedProgramme = true
        if (program.startMs > gapStart) paintGap(gapStart, program.startMs)
        gapStart = max(gapStart, program.endMs)
        val chosen = !channelRailSelected && rowIndex == selectedRow && program.startMs <= selectedTimeMs && program.endMs > selectedTimeMs
        paintCell(canvas, clippedLeft + density, top + density, clippedRight - density, top + rowHeight - 2f * density, if (chosen) selected else tintFor(program), chosen)
        if (!chosen && wallClockNow > program.startMs && wallClockNow < program.endMs) {
          // The part of the show that has already aired is a little darker.
          val shadeRight = min(clippedRight, timeToX(wallClockNow, visibleStartMs, visibleEndMs)) - density
          if (shadeRight > clippedLeft + density) {
            cellRect.set(clippedLeft + density, top + density, shadeRight, top + rowHeight - 2f * density)
            canvas.drawRoundRect(cellRect, cellRadius, cellRadius, elapsedShade)
          }
        }
        if (clippedRight - clippedLeft > 90f * density) {
          tickDate.time = program.startMs
          drawClippedText(canvas, timeFormatter.format(tickDate), clippedLeft + pad, top + rowHeight * .34f, clippedRight - pad, muted)
          drawClippedText(canvas, program.title, clippedLeft + pad, top + rowHeight * .76f, clippedRight - pad, title)
        } else drawClippedText(canvas, program.title, clippedLeft + pad, top + rowHeight * .60f, clippedRight - pad, title)
      }
      if (!paintedProgramme) {
        // A legitimate unmatched/empty EPG row must never look like a broken
        // black canvas. Keep the row selectable/playable and show a neutral
        // TiviMate-style placeholder without inventing persisted programme data.
        val left = guideLeft + density
        val right = width.toFloat() - density
        if (right > left) {
          val fill = if (!channelRailSelected && rowIndex == selectedRow) selected else noInfoPaint.also { it.alpha = cell.alpha }
          paintCell(canvas, left, top + density, right, top + rowHeight - 2f * density, fill, fill === selected)
          drawClippedText(canvas, "No information", left + pad, top + rowHeight * .60f, right - pad, muted)
        }
      }
      else if (gapStart < visibleEndMs) paintGap(gapStart, visibleEndMs)
      canvas.drawLine(0f, top + rowHeight, width.toFloat(), top + rowHeight, divider)
    }
    canvas.restore()

    if (drawnRows > 0 && wallClockNow in visibleStartMs..visibleEndMs) {
      val x = timeToX(wallClockNow, visibleStartMs, visibleEndMs)
      canvas.drawLine(x, headerHeight, x, gridBottom, nowPaint)
    }
  }

  private fun drawHeader(canvas: Canvas, start: Long, end: Long, gridBottom: Float, slide: Float = 0f, slideMs: Long = 0L) {
    if (slide < channelWidth) canvas.drawText("Today", pad - slide, headerHeight * .66f, headerLabel)
    var tick = (((start - slideMs) / 1_800_000L) + 1) * 1_800_000L
    while (tick < end) {
      val x = timeToX(tick, start, end)
      tickDate.time = tick
      val timeLabel = timeFormatter.format(tickDate)
      canvas.drawText(timeLabel, x + pad, headerHeight * .66f, headerLabel)
      canvas.drawLine(x, headerHeight, x, gridBottom, divider)
      tick += 1_800_000L
    }
  }

  private fun paintCell(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float, fill: Paint, chosen: Boolean) {
    if (right <= left) return
    cellRect.set(left, top, right, bottom)
    canvas.drawRoundRect(cellRect, cellRadius, cellRadius, fill)
    if (!chosen) {
      val half = cellEdge.strokeWidth / 2f
      cellRect.inset(half, half)
      canvas.drawRoundRect(cellRect, cellRadius, cellRadius, cellEdge)
      cellRect.inset(-half, -half)
    }
    if (chosen) {
      val inset = selectedEdge.strokeWidth / 2f
      cellRect.inset(inset, inset)
      canvas.drawRoundRect(cellRect, cellRadius, cellRadius, selectedEdge)
    }
  }

  private fun drawClippedText(canvas: Canvas, value: String, x: Float, baseline: Float, right: Float, paint: Paint) {
    if (right <= x) return
    canvas.save(); canvas.clipRect(x, baseline - rowHeight, right, baseline + pad)
    canvas.drawText(value, x, baseline, paint); canvas.restore()
  }

  companion object {
    private const val MAX_LOGO_BITMAPS = 28
    private val CHANNEL_COLOR = Color.rgb(34, 16, 68)
    private val SELECTED_COLOR = Color.rgb(160, 72, 245)
    // Channel tile colours for channels without a logo.
    private val TILE_COLORS = intArrayOf(
      Color.rgb(219, 61, 140), Color.rgb(150, 190, 40), Color.rgb(40, 190, 90), Color.rgb(140, 60, 210),
      Color.rgb(30, 180, 170), Color.rgb(230, 120, 40), Color.rgb(60, 110, 240), Color.rgb(190, 60, 200),
    )
    private const val LIVE_CLOCK_TICK_MS = 30_000L
    private const val COVERAGE_TTL_MS = 60_000L
    // The grid paints titles only. This short text covers the preview until the
    // selected channel's full description arrives from React.
    private const val PAINT_DESCRIPTION_CHARS = 200
    private const val PAINT_CACHE_CHANNELS = 128
    private const val LOW_RAM_PAINT_CACHE_CHANNELS = 64
  }
}
