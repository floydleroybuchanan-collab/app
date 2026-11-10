package com.streamflixreborn.streamflix.charm

import androidx.annotation.DrawableRes
import com.streamflixreborn.streamflix.R

/** The approved glass buttons for the Platforms page: logo tile and View All pill. */
object VodPlatformArt {
    data class Art(@DrawableRes val button: Int, @DrawableRes val viewAll: Int)

    private val art = mapOf(
        "mgm" to Art(R.drawable.vod_home_mgm, R.drawable.vod_home_mgm_all),
        "netflix" to Art(R.drawable.vod_platform_netflix, R.drawable.vod_platform_netflix_all),
        "disney" to Art(R.drawable.vod_platform_disney, R.drawable.vod_platform_disney_all),
        "apple" to Art(R.drawable.vod_platform_apple, R.drawable.vod_platform_apple_all),
        "hulu" to Art(R.drawable.vod_platform_hulu, R.drawable.vod_platform_hulu_all),
        "max" to Art(R.drawable.vod_platform_max, R.drawable.vod_platform_max_all),
        "prime" to Art(R.drawable.vod_platform_prime, R.drawable.vod_platform_prime_all),
        "paramount" to Art(R.drawable.vod_platform_paramount, R.drawable.vod_platform_paramount_all),
        "peacock" to Art(R.drawable.vod_platform_peacock, R.drawable.vod_platform_peacock_all),
        "starz" to Art(R.drawable.vod_platform_starz, R.drawable.vod_platform_starz_all),
        "amc" to Art(R.drawable.vod_platform_amc, R.drawable.vod_platform_amc_all),
    )

    private val homeArt = mapOf(
        "netflix" to Art(R.drawable.vod_home_netflix, R.drawable.vod_home_netflix_all),
        "prime" to Art(R.drawable.vod_home_prime, R.drawable.vod_home_prime_all),
        "disney" to Art(R.drawable.vod_home_disney, R.drawable.vod_home_disney_all),
        "max" to Art(R.drawable.vod_home_max, R.drawable.vod_home_max_all),
        "hulu" to Art(R.drawable.vod_home_hulu, R.drawable.vod_home_hulu_all),
        "apple" to Art(R.drawable.vod_home_apple, R.drawable.vod_home_apple_all),
        "paramount" to Art(R.drawable.vod_home_paramount, R.drawable.vod_home_paramount_all),
        "peacock" to Art(R.drawable.vod_home_peacock, R.drawable.vod_home_peacock_all),
        "starz" to Art(R.drawable.vod_home_starz, R.drawable.vod_home_starz_all),
        "mgm" to Art(R.drawable.vod_home_mgm, R.drawable.vod_home_mgm_all),
    )

    fun of(platformId: String): Art? = art[platformId]

    /** The original logo tiles of the VOD home row. */
    fun homeOf(platformId: String): Art? = homeArt[platformId] ?: art[platformId]
}
