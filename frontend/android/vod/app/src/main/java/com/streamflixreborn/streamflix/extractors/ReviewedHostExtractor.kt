package com.streamflixreborn.streamflix.extractors

import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.vod.VodHttp
import kotlinx.coroutines.CancellationException
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import java.io.IOException

/** Native adapters adapted to Charm's cancellable networking and Video contract. */
internal class ReviewedHostExtractor(
    override val name: String,
    override val mainUrl: String,
    override val aliasUrls: List<String> = emptyList(),
) : Extractor() {
    override suspend fun extract(link: String): Video = fetch(link)
    companion object {
        const val USER_AGENT = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
        val additions = listOf(
            ReviewedHostExtractor("SendVid", "https://sendvid.com"),
            ReviewedHostExtractor("EarnVids", "https://earnvids.com", listOf(
                "https://earnvid.com", "https://earnvids.xyz", "https://smoothpre.com", "https://movearnpre.com",
                "https://vidhide.com", "https://vidhidehub.com")),
            ReviewedHostExtractor("VK", "https://vk.com", listOf("https://vkvideo.ru")),
        )
        private val fallbackHosts = setOf("mp4upload.com", "video.sibnet.ru", "uqload.com", "uqload.to",
            "uqload.io", "uqload.net", "uqload.co", "uqload.cx", "uqload.bz", "vidmoly.to", "vidmoly.me",
            "vidmoly.net", "vidmoly.biz", "vidoza.net", "vidoza.org", "vidoza.co", "sendvid.com",
            "dhtpre.com", "peytonepre.com", "vidhideplus.com", "minochinos.com")
        fun matches(url: String, domains: Set<String>): Boolean = url.toHttpUrlOrNull()?.let { parsed ->
            parsed.username.isEmpty() && parsed.password.isEmpty() &&
                domains.any { parsed.host == it || parsed.host.endsWith("." + it) }
        } ?: false
        fun added(url: String): Extractor? = additions.firstOrNull { extractor ->
            matches(url, (listOf(extractor.mainUrl) + extractor.aliasUrls).mapNotNull { it.toHttpUrlOrNull()?.host }.toSet())
        }
        suspend fun fallback(url: String, failure: Exception): Video {
            if (failure is CancellationException) throw failure
            if (!matches(url, fallbackHosts)) throw failure
            return fetch(url)
        }
        private suspend fun fetch(link: String): Video {
            var page = link.toHttpUrlOrNull() ?: throw IOException("Invalid host link.")
            if (page.username.isNotEmpty() || page.password.isNotEmpty()) throw IOException("Invalid host link.")
            var referer = page.toString()
            repeat(5) {
                val response = VodHttp.request(Request.Builder().url(page)
                    .header("User-Agent", USER_AGENT).header("Referer", referer).build())
                response.use {
                    if (it.code in 300..399) {
                        val next = it.header("Location")?.let(page::resolve) ?: throw IOException("Invalid host redirect.")
                        if (next.username.isNotEmpty() || next.password.isNotEmpty()) throw IOException("Invalid host redirect.")
                        referer = page.toString(); page = next
                    } else {
                        if (!it.isSuccessful) throw IOException("The video host is unavailable (HTTP " + it.code + ").")
                        return HostMediaParser.parse(page.toString(), VodHttp.text(it))
                            ?: throw IOException("This host did not return a playable video. Try another source.")
                    }
                }
            }
            throw IOException("The video host redirected too many times.")
        }
    }
}
