package com.streamflixreborn.streamflix

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import java.security.Security
import org.conscrypt.Conscrypt
import com.streamflixreborn.streamflix.database.AppDatabase
import com.streamflixreborn.streamflix.providers.AniWorldProvider
import com.streamflixreborn.streamflix.providers.SerienStreamProvider
import com.streamflixreborn.streamflix.sync.CloudSyncManager
import com.streamflixreborn.streamflix.sync.SupabaseProvider
import com.streamflixreborn.streamflix.utils.AppLanguageManager
import com.streamflixreborn.streamflix.utils.ArtworkRepairScheduler
import com.streamflixreborn.streamflix.utils.CacheUtils
import com.streamflixreborn.streamflix.utils.DnsResolver
import com.streamflixreborn.streamflix.utils.IsrgRootTrustProvider
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

open class StreamFlixApp : Application(), androidx.work.Configuration.Provider {
    // Android's startup provider runs only in the main process. On-demand setup
    // also lets the internal VOD process enqueue work without an uninitialized singleton.
    override val workManagerConfiguration: androidx.work.Configuration
        get() = androidx.work.Configuration.Builder().setDefaultProcessName(packageName).build()
    // VOD cache maintenance must never delete the host's guide/logo caches.
    override fun getCacheDir(): java.io.File = if (com.streamflixreborn.streamflix.charm.CharmVodProcess.isVod)
        java.io.File(super.getCacheDir(), "vod").also { it.mkdirs() } else super.getCacheDir()

    override fun getExternalCacheDir(): java.io.File? = super.getExternalCacheDir()?.let {
        if (com.streamflixreborn.streamflix.charm.CharmVodProcess.isVod) java.io.File(it, "vod").also { dir -> dir.mkdirs() } else it
    }

    companion object {
        lateinit var instance: StreamFlixApp
            private set

        @Volatile
        var currentActivity: Activity? = null
            private set
    }

    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

            override fun onActivityStarted(activity: Activity) = Unit

            override fun onActivityResumed(activity: Activity) {
                currentActivity = activity
            }

            override fun onActivityPaused(activity: Activity) {
                if (currentActivity === activity) {
                    currentActivity = null
                }
            }

            override fun onActivityStopped(activity: Activity) = Unit

            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

            override fun onActivityDestroyed(activity: Activity) {
                if (currentActivity === activity) {
                    currentActivity = null
                }
            }
        })

        // 0. Initialize Conscrypt for modern SSL on old Android
        if (com.streamflixreborn.streamflix.charm.CharmVodProcess.isVod) {
            if (android.os.Build.VERSION.SDK_INT >= 28) android.webkit.WebView.setDataDirectorySuffix("vod")
            Security.insertProviderAt(Conscrypt.newProvider(), 1)
        }

        // 1. Install ISRG Root X1 globally for Let's Encrypt. On Android < 7 (API 24)
        // network_security_config.xml is not supported so the certificate must be injected manually.
        if (com.streamflixreborn.streamflix.charm.CharmVodProcess.isVod) IsrgRootTrustProvider.install()

        // 2. Inizializzazione preferenze (con applicationContext)
        UserPreferences.setup(this)
        com.streamflixreborn.streamflix.charm.CharmVodDefaults.apply()
        DnsResolver.setDnsUrl(UserPreferences.dohProviderUrl)

        val appContext = applicationContext
        val isTv = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        val threshold = if (isTv) 10L else 50L

        applicationScope.launch(Dispatchers.IO) {
            AppDatabase.setup(appContext)
            SupabaseProvider.initialize(appContext)
            runCatching { CloudSyncManager.initialize(appContext) }
            SerienStreamProvider.initialize(appContext)
            AniWorldProvider.initialize(appContext)
            ArtworkRepairScheduler.schedule(appContext, UserPreferences.currentProvider)
            if (com.streamflixreborn.streamflix.charm.CharmVodProcess.isVod) {
                CacheUtils.autoClearIfNeeded(appContext, thresholdMb = threshold)
            }
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (com.streamflixreborn.streamflix.charm.CharmVodProcess.isVod && level >= TRIM_MEMORY_RUNNING_LOW) {
            CacheUtils.clearAppCache(this)
        }
    }
}
