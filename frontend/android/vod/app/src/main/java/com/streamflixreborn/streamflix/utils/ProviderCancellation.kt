package com.streamflixreborn.streamflix.utils

import kotlinx.coroutines.CancellationException

/** A failed host can fall back; leaving the screen must cancel the entire request. */
internal inline fun <T> providerRunCatching(block: () -> T): Result<T> = try {
    Result.success(block())
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (failure: Throwable) {
    Result.failure(failure)
}
