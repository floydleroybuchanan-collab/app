package com.streamflixreborn.streamflix.extractors

import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.utils.JsUnpacker
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.jsoup.Jsoup

/** Host-page parsing only: no catalog search, arbitrary script execution or unrelated fallback clip. */
internal object HostMediaParser {
    fun parse(page: String, html: String): Video? {
        val base = page.toHttpUrlOrNull() ?: return null
        val doc = Jsoup.parse(html, page)
        fun resolve(value: String?): String? {
            val decoded = value?.replace("\\/", "/")?.replace("\\u0026", "&")?.replace("&amp;", "&") ?: return null
            return base.resolve(decoded)?.takeIf { it.username.isEmpty() && it.password.isEmpty() }?.toString()
        }
        val explicit = doc.select("video source[src], source#video_source, video[src], meta[property=og:video:secure_url]")
            .mapNotNull { resolve(if (it.tagName() == "meta") it.attr("content") else it.attr("src")) }
        val scripts = doc.select("script").flatMap { element ->
            val text = element.data()
            listOfNotNull(text, if (text.contains("eval(function(p,a,c,k,e,d)")) JsUnpacker(text).unpack() else null)
        }
        val patterns = listOf(
            Regex("""(?i)["']?(?:hls[234]?|hlsManifestUrl)["']?\s*:\s*["']([^"']+)["']"""),
            Regex("""(?i)["']?url(?:2160|1080|720|480|360)["']?\s*:\s*["']([^"']+)["']"""),
            Regex("""(?i)["']?(?:file|src)["']?\s*[:=]\s*["']([^"']+)["']"""),
            Regex("""(?i)sources\s*:\s*\[\s*["']([^"']+)["']"""),
        )
        val values = explicit + patterns.flatMap { regex ->
            scripts.flatMap { text -> regex.findAll(text).mapNotNull { resolve(it.groupValues[1]) }.toList() }
        }
        val source = values.firstOrNull { it.substringBefore('?').endsWith(".m3u8", true) }
            ?: values.firstOrNull { it.substringBefore('?').endsWith(".mpd", true) }
            ?: values.firstOrNull { it.substringBefore('?').endsWith(".mp4", true) }
            ?: explicit.firstOrNull() ?: return null
        val subtitles = doc.select("track[src]").filter { it.attr("kind") in listOf("captions", "subtitles") }
            .mapNotNull { track -> resolve(track.attr("src"))?.let {
                Video.Subtitle(track.attr("label").ifBlank { track.attr("srclang") }, it)
            } }
        return Video(source = source, subtitles = subtitles, originalHostUrl = page,
            headers = mapOf("Referer" to page, "Origin" to (base.scheme + "://" + base.host +
                if (base.port == 80 || base.port == 443) "" else ":" + base.port),
                "User-Agent" to ReviewedHostExtractor.USER_AGENT))
    }
}
