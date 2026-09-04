package com.charmiptv.app

import android.content.Context

/**
 * Authoritative multi-source Guide reader shared by the React query bridge and
 * the native Canvas. Playlist channel ids remain the public keys; custom XMLTV
 * ids are resolved only inside this boundary.
 */
internal class CombinedGuideRepository(context: Context) {
  private val appContext = context.applicationContext
  private val primary = EpgDatabase.shared(appContext)
  private val controlDao = EpgControlDatabase.get(appContext).dao()

  fun queryGuideWindow(startMs: Long, endMs: Long, playlistChannelIds: Collection<String>): List<NativeEpgProgram> {
    val ids = playlistChannelIds.asSequence().map(String::trim).filter(String::isNotEmpty).distinct().toList()
    if (ids.isEmpty()) return emptyList()

    val enabledCustomSources = ArrayList<EpgSourceEntity>().apply {
      controlDao.source(USER_SOURCE_ID)?.takeIf { it.enabled && it.url.isNotBlank() }?.let(::add)
      addAll(controlDao.userSources().filter { it.enabled && it.url.isNotBlank() })
    }
    val bindingsBySource = LinkedHashMap<String, List<EpgChannelBindingEntity>>()
    val customOwned = LinkedHashSet<String>()
    for (source in enabledCustomSources) {
      val rows = ArrayList<EpgChannelBindingEntity>()
      for (chunk in ids.chunked(BINDING_QUERY_CHUNK)) {
        rows.addAll(controlDao.effectiveBindingsForChannels(source.playlistId, chunk))
      }
      bindingsBySource[source.playlistId] = rows
      rows.forEach { customOwned.add(it.channelId) }
    }

    val result = ArrayList<NativeEpgProgram>()
    val primaryEnabled = controlDao.source(PRIMARY_SOURCE_ID)?.enabled ?: true
    if (primaryEnabled) {
      val primaryIds = ids.filterNot { it in customOwned }
      if (primaryIds.isNotEmpty()) result.addAll(primary.queryGuideWindow(startMs, endMs, primaryIds))
    }

    for ((sourceId, bindings) in bindingsBySource) {
      if (bindings.isEmpty()) continue
      val xmltvByPlaylist = bindings.associate { it.channelId to it.xmltvId }
      val playlistByXmltv = HashMap<String, MutableList<String>>()
      for ((playlistId, xmltvId) in xmltvByPlaylist) {
        playlistByXmltv.getOrPut(xmltvId) { ArrayList() }.add(playlistId)
      }
      val sourceRows = CustomEpgStoreRegistry.database(appContext, sourceId)
        .queryWindow(startMs, endMs, xmltvByPlaylist.values.toSet())
      for (program in sourceRows) {
        for (playlistId in playlistByXmltv[program.channelId].orEmpty()) {
          result.add(program.copy(channelId = playlistId))
        }
      }
    }
    return result
  }

  companion object {
    private const val PRIMARY_SOURCE_ID = "default"
    private const val USER_SOURCE_ID = "user"
    private const val BINDING_QUERY_CHUNK = 400
  }
}
