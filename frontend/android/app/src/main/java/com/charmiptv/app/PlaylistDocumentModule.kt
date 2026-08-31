package com.charmiptv.app

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** System document picker grants access only to the file the user chooses. */
class PlaylistDocumentModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var pending: Promise? = null
  override fun getName() = "CharmPlaylistDocument"
  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST) return
      val promise = pending ?: return
      pending = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) { promise.resolve(null); return }
      try {
        context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        promise.resolve(uri.toString())
      } catch (_: Throwable) {
        promise.reject("PLAYLIST_DOCUMENT_PERMISSION", "This location cannot retain file access. Choose a local document provider or use an M3U URL.")
      }
    }
  }
  init { context.addActivityEventListener(listener) }
  @ReactMethod fun pick(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null || pending != null) { promise.reject("PLAYLIST_DOCUMENT_BUSY", "Document picker is unavailable."); return }
    try {
      pending = promise
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        type = "*/*"
        addCategory(Intent.CATEGORY_OPENABLE)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }, REQUEST)
    } catch (_: Throwable) { pending = null; promise.reject("PLAYLIST_DOCUMENT_UNAVAILABLE", "This TV has no document picker. Add your playlist by URL instead.") }
  }
  override fun invalidate() {
    context.removeActivityEventListener(listener)
    pending?.reject("PLAYLIST_DOCUMENT_CLOSED", "Document picker closed.")
    pending = null
    super.invalidate()
  }
  companion object { private const val REQUEST = 28142 }
}
