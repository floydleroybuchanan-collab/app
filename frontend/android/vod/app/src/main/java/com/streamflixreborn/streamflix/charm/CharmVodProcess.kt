package com.streamflixreborn.streamflix.charm

import android.app.Application
import android.os.Build
import java.io.File

/** Internal process isolation keeps VOD networking/Glide out of Live TV's process. */
object CharmVodProcess {
    val isVod: Boolean by lazy {
        val name = if (Build.VERSION.SDK_INT >= 28) Application.getProcessName() else
            runCatching { File("/proc/self/cmdline").readText().substringBefore('\u0000') }.getOrDefault("")
        name.endsWith(":vod")
    }
}
