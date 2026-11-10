package com.streamflixreborn.streamflix.charm

import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.Show
import com.streamflixreborn.streamflix.models.TvShow
import java.util.Calendar
import java.util.Locale

/** Original/exclusive attribution, NEVER mere streaming availability.
 * This bounded, offline-curated index only matches titles in the user's own
 * existing VOD library; unmatched/ambiguous items receive no platform label.
 */
object VodPlatformCatalog {
    data class Platform(val id: String, val label: String, val mark: String, val tint: Int)
    val platforms = listOf(
        Platform("netflix","Netflix Originals","N",0xFFEB2832.toInt()),
        Platform("prime","Prime Video Originals","prime",0xFF38B9ED.toInt()),
        Platform("disney","Disney+ Originals","Disney+",0xFF26B8EF.toInt()),
        Platform("max","HBO / Max Originals","max",0xFFB68AF5.toInt()),
        Platform("hulu","Hulu Originals","hulu",0xFF26DF85.toInt()),
        Platform("apple","Apple TV+ Originals","tv+",0xFFE2D8FF.toInt()),
        Platform("paramount","Paramount+ Originals","P+",0xFF468FF1.toInt()),
        Platform("peacock","Peacock Originals","peacock",0xFFFFA5CD.toInt()),
        // These are platform *navigation choices*, not proof of an Original
        // title. The catalog matcher only displays verified local titles.
        Platform("starz","STARZ","STARZ",0xFF36D6FB.toInt()),
        Platform("amc","AMC+ Originals","AMC+",0xFF00DFD2.toInt()),
        Platform("youtube","YouTube Originals","YouTube",0xFFFF2B3B.toInt()),
        Platform("crunchyroll","Crunchyroll Originals","crunchyroll",0xFFFF7A1A.toInt()),
    )
    /** The twelve services on the Platforms page, in the order of the approved artwork. */
    val pagePlatforms: List<Platform> = listOf(
        "netflix", "disney", "apple", "hulu", "max", "prime", "paramount", "peacock",
        "youtube", "starz", "amc", "crunchyroll",
    ).map { id -> platforms.first { it.id == id } }

    /** TMDb production credits: who actually made a title, not who merely carries it. */
    data class Origin(val networks: String? = null, val companies: String? = null)

    private val origins = mapOf(
        "netflix" to Origin(networks = "213", companies = "178464"),
        "disney" to Origin(networks = "2739"),
        "apple" to Origin(networks = "2552", companies = "194232"),
        "hulu" to Origin(networks = "453"),
        "max" to Origin(networks = "49", companies = "3268"),
        "prime" to Origin(networks = "1024", companies = "20580"),
        "paramount" to Origin(networks = "4330"),
        "peacock" to Origin(networks = "3353"),
        "youtube" to Origin(networks = "1436"),
        "starz" to Origin(networks = "318"),
        "amc" to Origin(networks = "174|4661"),
        "crunchyroll" to Origin(networks = "1112"),
    )

    fun origin(platformId: String): Origin? = origins[platformId]

    private val originals = listOf(
        Triple("Stranger Things",2016,"netflix"),Triple("The Crown",2016,"netflix"),
        Triple("Squid Game",2021,"netflix"),Triple("Wednesday",2022,"netflix"),
        Triple("The Irishman",2019,"netflix"),Triple("Extraction",2020,"netflix"),
        Triple("The Mandalorian",2019,"disney"),Triple("Loki",2021,"disney"),
        Triple("WandaVision",2021,"disney"),Triple("Andor",2022,"disney"),
        Triple("Ahsoka",2023,"disney"),
        Triple("Severance",2022,"apple"),Triple("Ted Lasso",2020,"apple"),
        Triple("Silo",2023,"apple"),Triple("The Morning Show",2019,"apple"),
        Triple("CODA",2021,"apple"),Triple("Tetris",2023,"apple"),
        Triple("The Handmaid's Tale",2017,"hulu"),
        Triple("Only Murders in the Building",2021,"hulu"),
        Triple("The Bear",2022,"hulu"),Triple("Prey",2022,"hulu"),
        Triple("Palm Springs",2020,"hulu"),
        Triple("Succession",2018,"max"),Triple("The Last of Us",2023,"max"),
        Triple("House of the Dragon",2022,"max"),Triple("The White Lotus",2021,"max"),
        Triple("The Penguin",2024,"max"),
        Triple("The Boys",2019,"prime"),Triple("Reacher",2022,"prime"),
        Triple("Fallout",2024,"prime"),Triple("Invincible",2021,"prime"),
        Triple("Road House",2024,"prime"),
        Triple("1923",2022,"paramount"),Triple("Tulsa King",2022,"paramount"),
        Triple("Halo",2022,"paramount"),Triple("Star Trek: Strange New Worlds",2022,"paramount"),
        Triple("Poker Face",2023,"peacock"),Triple("Twisted Metal",2023,"peacock"),
        Triple("Bel-Air",2022,"peacock"),Triple("The Traitors",2023,"peacock")
    )
    private val index = originals.groupBy { normalize(it.first) }.mapValues { (_, entries) ->
        entries.associate { (_, year, id) -> year to platforms.first { p -> p.id == id } }
    }
    fun find(title: String?, year: Int?): Platform? {
        if (title.isNullOrBlank() || year == null) return null
        return index[normalize(title)]?.get(year)
    }
    fun find(show: Show): Platform? = when (show) {
        is Movie -> find(show.title, show.released?.get(Calendar.YEAR))
        is TvShow -> find(show.title, show.released?.get(Calendar.YEAR))
    }
    fun byId(id: String?): Platform? = platforms.firstOrNull { it.id == id }
    private fun normalize(s: String): String =
        s.lowercase(Locale.ROOT).replace(Regex("[^\\p{L}\\p{N}]"), "")
    fun match(items: Sequence<Show>, maxPerPlatform: Int = 18): Map<String, List<Show>> {
        val rows = linkedMapOf<String, MutableList<Show>>()
        val seen = hashSetOf<String>()
        for (show in items) {
            val p = find(show) ?: continue
            val key = p.id + "/" + show.javaClass.simpleName + "/" + when(show) {
                is Movie -> show.id
                is TvShow -> show.id
            }
            if (!seen.add(key)) continue
            val row = rows.getOrPut(p.id) { mutableListOf() }
            if (row.size < maxPerPlatform) row += show
        }
        return rows
    }
}
