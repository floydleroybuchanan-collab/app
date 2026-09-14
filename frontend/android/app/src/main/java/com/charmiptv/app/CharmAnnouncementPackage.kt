package com.charmiptv.app

import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class CharmAnnouncementPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CharmAnnouncementModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class CharmAnnouncementModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "CharmAnnouncements"
  @ReactMethod fun playChime(promise: Promise) {
    Handler(Looper.getMainLooper()).post {
      try {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val activity = context.currentActivity
        if (activity == null || activity.isFinishing || audio.isMusicActive ||
            audio.ringerMode != AudioManager.RINGER_MODE_NORMAL || audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION) == 0 ||
            notifications.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL) {
          promise.resolve(false)
        } else {
          val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 20)
          val started = tone.startTone(ToneGenerator.TONE_PROP_ACK, 160)
          Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, 400)
          promise.resolve(started)
        }
      } catch (_: Exception) { promise.resolve(false) }
    }
  }
}
