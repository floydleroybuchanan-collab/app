package com.streamflixreborn.streamflix.charm

import com.streamflixreborn.streamflix.providers.TmdbProvider
import com.streamflixreborn.streamflix.utils.UserPreferences

/** Factory defaults only: explicit provider choices continue to be remembered. */
object CharmVodDefaults {
    fun apply() {
        if (UserPreferences.currentProvider == null) {
            UserPreferences.currentProvider = TmdbProvider("en")
            UserPreferences.providerLanguage = "en"
        }
    }
}
