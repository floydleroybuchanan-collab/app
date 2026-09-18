package com.streamflixreborn.streamflix.fragments.search

import com.streamflixreborn.streamflix.providers.IptvProvider
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.providers.TmdbProvider

/** Presentation names must never replace the provider identity stored on a result. */
object SearchCatalog {
    fun displayName(name: String): String = when {
        name.startsWith("TMDb (") -> "Charming MediaLab"
        else -> name.replace(Regex("streamflix", RegexOption.IGNORE_CASE), "Charming MediaLab")
    }

    fun resolve(name: String, providers: Collection<Provider>): Provider? {
        val language = Regex("^TMDb \\(([a-zA-Z-]+)\\)$").matchEntire(name)?.groupValues?.get(1)
        return if (language != null) TmdbProvider(language) else providers.find { it.name == name }
    }

    fun targets(current: Provider?, language: String, providers: Collection<Provider>): List<Provider> {
        val iptv = current is IptvProvider
        return buildList {
            current?.let { add(it) }
            if (!iptv) add(TmdbProvider(language))
            addAll(providers.filter { it.language == language && (it is IptvProvider) == iptv })
        }.distinctBy { it.name }
    }
}
