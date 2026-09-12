package com.streamflixreborn.streamflix.vod

import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal class DebridLinkViewModel : ViewModel() {
    data class State(val code: DebridOAuth.Code? = null, val seconds: Long = 0,
        val message: String = "Requesting a code…", val complete: Boolean = false, val failed: Boolean = false)
    private val mutable = MutableStateFlow(State())
    val state = mutable.asStateFlow()
    private var job: Job? = null
    private var started = false
    fun start() {
        if (started) return
        started = true
        job = viewModelScope.launch(Dispatchers.IO) {
            val revision = RealDebrid.sessionRevision
            try {
                val oauth = DebridOAuth()
                val code = oauth.begin()
                ensureActive()
                val deadline = SystemClock.elapsedRealtime() + code.expiresSeconds * 1000
                var nextPoll = SystemClock.elapsedRealtime() + code.intervalSeconds * 1000
                while (SystemClock.elapsedRealtime() < deadline) {
                    ensureActive()
                    val remaining = ((deadline - SystemClock.elapsedRealtime()) / 1000).coerceAtLeast(0)
                    mutable.value = State(code, remaining, "Waiting for approval")
                    if (SystemClock.elapsedRealtime() >= nextPoll) {
                        val credentials = oauth.credentials(code)
                        if (credentials != null) {
                            val token = oauth.token(credentials.getString("client_id"), credentials.getString("client_secret"), code.device)
                            ensureActive()
                            RealDebrid.connectOAuth(token, revision)
                            mutable.value = State(message = "Account connected", complete = true)
                            return@launch
                        }
                        nextPoll = SystemClock.elapsedRealtime() + code.intervalSeconds * 1000
                    }
                    delay(1000)
                }
                mutable.value = State(message = "Code expired. Generate a new code.", failed = true)
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { mutable.value = State(message = "Could not link the account. Check your connection and try a new code.", failed = true) }
        }
    }
    fun restart() { cancel(); mutable.value = State(); started = false; start() }
    fun cancel() { job?.cancel(); job = null }
}
