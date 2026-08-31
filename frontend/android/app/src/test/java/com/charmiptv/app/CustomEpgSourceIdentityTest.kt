package com.charmiptv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class CustomEpgSourceIdentityTest {
  @Test fun sourceNormalizationIsIdempotent() {
    for (id in listOf("user", "owner-secondary", "abc123", "user:abc123")) {
      val normalized = CustomEpgStoreRegistry.normalizeSourceId(id)
      assertEquals(normalized, CustomEpgStoreRegistry.normalizeSourceId(normalized))
      assertEquals(CustomEpgStoreRegistry.databaseFileName(id) { false }, CustomEpgStoreRegistry.databaseFileName(normalized) { false })
    }
  }

  @Test fun existingProgrammeDatabaseIsReusedInsteadOfSilentlyOpeningAnEmptyOne() {
    val canonical = CustomEpgStoreRegistry.databaseFileName("feed") { false }
    val legacy = CustomEpgStoreRegistry.databaseFileName("feed") { true }
    assertNotEquals(canonical, legacy)
    assertEquals(legacy, CustomEpgStoreRegistry.databaseFileName("user:feed") { it == legacy })
  }

  @Test fun originalCustomGuideKeepsItsExistingDatabaseName() {
    assertEquals("charm_epg_user_v1.db", CustomEpgStoreRegistry.databaseFileName("user") { false })
  }
}
