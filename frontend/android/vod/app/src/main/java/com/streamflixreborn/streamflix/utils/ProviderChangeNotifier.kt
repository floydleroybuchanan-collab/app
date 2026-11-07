package com.streamflixreborn.streamflix.utils

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** Broadcast refresh invalidations; new models perform their own initial load. */
object ProviderChangeNotifier {
    private val changes = MutableSharedFlow<Unit>(
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val providerChangeFlow = changes.asSharedFlow()

    fun notifyProviderChanged() {
        changes.tryEmit(Unit)
    }
}
