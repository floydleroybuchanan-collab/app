package com.streamflixreborn.streamflix.charm

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Minimal authenticated presence. No titles, provider URLs, passwords or tokens are logged. */
object CharmUsageReporter {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var installed = false
    private var token: String? = null
    private var build = 0
    private var mode = "idle"
    private var foreground: Activity? = null
    private val playing = mutableMapOf<String, Boolean>()
    private var inFlight = false
    private var lastSent = 0L
    private val deferred = Runnable { report() }
    private val tick = object : Runnable { override fun run() { report(); main.postDelayed(this, 30_000) } }
    fun configure(app: Application, sessionToken: String?, versionCode: Int, current: Activity?) = main.post {
        token = sessionToken?.takeIf { it.isNotBlank() }; build = versionCode
        if (!installed) {
            installed = true
            app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
                override fun onActivityResumed(activity: Activity) { foreground=activity;mode=if(activity.javaClass.name.startsWith("com.streamflixreborn")) "vod" else "iptv";report() }
                override fun onActivityPaused(activity: Activity) { if(foreground===activity){foreground=null;mode="idle";report()} }
                override fun onActivityCreated(a: Activity,b: Bundle?) = Unit
                override fun onActivityStarted(a: Activity) = Unit
                override fun onActivityStopped(a: Activity) = Unit
                override fun onActivitySaveInstanceState(a: Activity,b: Bundle) = Unit
                override fun onActivityDestroyed(a: Activity) = Unit
            })
            main.post(tick)
        }
        if (current != null) { foreground=current;mode=if(current.javaClass.name.startsWith("com.streamflixreborn")) "vod" else "iptv" }
        if(token==null){playing.clear();lastSent=0}else report()
    }
    fun playback(source: String, active: Boolean) { main.post { playing[source]=active;report() } }
    private fun report() {
        val credential=token ?: return
        val timestamp=System.currentTimeMillis()
        if(inFlight || timestamp-lastSent<1500){main.removeCallbacks(deferred);main.postDelayed(deferred,1500);return}
        val active=mode!="idle" && playing.any { it.key.startsWith(mode) && it.value }
        val payload=JSONObject().put("sequence",timestamp).put("mode",mode).put("playing",active).put("build",build).toString()
        inFlight=true;lastSent=timestamp
        io.execute {
            var connection: HttpURLConnection?=null
            try {
                connection=URL("https://charmiptv-account-api.agentleakage.workers.dev/me/activity").openConnection() as HttpURLConnection
                connection.requestMethod="POST";connection.connectTimeout=5000;connection.readTimeout=5000;connection.instanceFollowRedirects=false
                connection.setRequestProperty("Authorization","Bearer $credential");connection.setRequestProperty("Content-Type","application/json")
                connection.doOutput=true;connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                connection.responseCode
            } catch (_: Exception) { /* Telemetry failure never interrupts playback or account login. */ }
            finally { connection?.disconnect();main.post { inFlight=false } }
        }
    }
}
