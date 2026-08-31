package com.charmiptv.app

import android.content.Context
import android.util.Log
import com.bumptech.glide.GlideBuilder
import com.bumptech.glide.Glide
import com.bumptech.glide.Registry
import com.bumptech.glide.module.AppGlideModule
import com.bumptech.glide.annotation.GlideModule
import com.streamflixreborn.streamflix.charm.CharmVodProcess
import com.streamflixreborn.streamflix.ui.GlideCustomModule

/** Aggregate Expo's library modules and VOD into one generated registry per process. */
@GlideModule
class CharmAppGlideModule : AppGlideModule() {
    private val vodModule = GlideCustomModule()

    override fun registerComponents(context: Context, glide: Glide, registry: Registry) {
        vodModule.registerComponents(context, glide, registry)
    }
    override fun applyOptions(context: Context, builder: GlideBuilder) {
        super.applyOptions(context, builder)
        if (!CharmVodProcess.isVod) {
            // Preserve the original Expo module's logging option in the host.
            builder.setLogLevel(if (expo.modules.image.BuildConfig.ALLOW_GLIDE_LOGS) Log.VERBOSE else Log.ERROR)
        }
    }
}
