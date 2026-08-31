package com.charmiptv.app

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaylistHeaderTest {
  @Test fun localPlaylistRetainsGuideHeaderWithoutChangingChannelParsing() {
    val header = "#EXTM3U x-tvg-url=\"https://epg.invalid/guide.xml\""
    val text = "\uFEFF$header\n#EXTINF:-1 tvg-id=\"station\" group-title=\"News\",Station\nhttps://stream.invalid/live.m3u8\n"
    val result = NativePlaylistParser.fetch("content://documents/list", ByteArrayInputStream(text.toByteArray()))
    assertEquals(header, result.epgHeader)
    assertEquals(1, result.channels.size)
    assertEquals("station", result.channels[0].id)
    assertEquals(0, result.rejected)
    assertEquals(false, result.truncated)
  }
}
