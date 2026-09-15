package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.utils.UserPreferences
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.dnsoverhttps.DnsOverHttps
import java.net.InetAddress

/** Honor the user's DNS selection without importing provider cookies or relaxed TLS. */
internal object VodDns : Dns {
    private val transport = OkHttpClient.Builder().build()
    private var setting: String? = null
    private var resolver: Dns = Dns.SYSTEM
    @Synchronized private fun selected(): Dns {
        val value = UserPreferences.dohProviderUrl
        if (value != setting) {
            resolver = if (value.isBlank()) Dns.SYSTEM else DnsOverHttps.Builder()
                .client(transport).url(value.toHttpUrl()).build()
            setting = value
        }
        return resolver
    }
    override fun lookup(hostname: String): List<InetAddress> = selected().lookup(hostname)
}
