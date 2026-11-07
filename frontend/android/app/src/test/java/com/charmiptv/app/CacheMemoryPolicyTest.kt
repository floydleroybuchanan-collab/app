package com.charmiptv.app

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class CacheMemoryPolicyTest {
  @get:Rule val temporary = TemporaryFolder()

  @Test fun distinguishesHiddenUiFromRunningPressure() {
    assertNull(charmTrimLevelForAndroid(0))
    assertEquals(CharmTrimLevel.MODERATE, charmTrimLevelForAndroid(10))
    assertEquals(CharmTrimLevel.CRITICAL, charmTrimLevelForAndroid(15))
    for (level in listOf(20, 25, 39)) assertEquals(CharmTrimLevel.BACKGROUND, charmTrimLevelForAndroid(level))
    for (level in listOf(40, 60, 79)) assertEquals(CharmTrimLevel.MODERATE, charmTrimLevelForAndroid(level))
    assertEquals(CharmTrimLevel.CRITICAL, charmTrimLevelForAndroid(80))
  }

  @Test fun pruningLeavesCacheOwnersAndActiveFilesIntact() {
    val root = temporary.newFolder("app-cache")
    fun old(parent: File, name: String): File = File(parent, name).apply { writeText("1234"); setLastModified(1000L) }
    val source = old(root, "source_download.bin")
    val remote = old(root, "remote_old_query.json")
    val journal = old(root, "journal")
    val subtitle = old(root, "subtitle.zip")
    val active = old(root, "remote_active.json").apply { setLastModified(9000L) }
    val owner = File(root, "vod").apply { mkdir() }
    val nested = old(owner, "remote_owned.json")
    val result = pruneLegacyScratchFiles(root, 5000L)
    assertEquals(2L, result.first)
    assertEquals(8L, result.second)
    assertFalse(source.exists())
    assertFalse(remote.exists())
    for (preserved in listOf(journal, subtitle, active, nested)) assertTrue(preserved.exists())
  }
}
