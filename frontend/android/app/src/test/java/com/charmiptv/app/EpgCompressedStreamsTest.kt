package com.charmiptv.app

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.tukaani.xz.XZOutputStream
import org.tukaani.xz.LZMA2Options

class EpgCompressedStreamsTest {
  private val xml = "<tv><channel id=\"bbc\"/><programme start=\"20261108000000 +0000\"/></tv>"
  private fun decode(bytes: ByteArray, max: Long = 1024L) =
    EpgCompressedStreams.decode(ByteArrayInputStream(bytes), maxBytes = max).use {
      it.bufferedReader().readText()
    }

  @Test fun plainXml() {
    assertEquals(xml, decode(xml.toByteArray()))
  }

  @Test fun gzipXml() {
    val output = ByteArrayOutputStream()
    GZIPOutputStream(output).use { it.write(xml.toByteArray()) }
    assertEquals(xml, decode(output.toByteArray()))
  }

  @Test fun zipXml() {
    val output = ByteArrayOutputStream()
    ZipOutputStream(output).use { zip ->
      zip.putNextEntry(ZipEntry("guide.xml"))
      zip.write(xml.toByteArray())
      zip.closeEntry()
    }
    assertEquals(xml, decode(output.toByteArray()))
  }

  @Test fun xzXml() {
    val output = ByteArrayOutputStream()
    XZOutputStream(output, LZMA2Options()).use { it.write(xml.toByteArray()) }
    assertEquals(xml, decode(output.toByteArray()))
  }

  @Test fun oversizedDecompressionIsRejected() {
    try {
      decode(xml.toByteArray(), 12L)
      fail("Expected decompressed size protection")
    } catch (expected: IOException) {
      assertTrue(expected.message.orEmpty().contains("safety limit"))
    }
  }

  @Test fun unsafeZipNameIsRejected() {
    val output = ByteArrayOutputStream()
    ZipOutputStream(output).use { zip ->
      zip.putNextEntry(ZipEntry("../guide.xml"))
      zip.write(xml.toByteArray())
      zip.closeEntry()
    }
    try {
      decode(output.toByteArray())
      fail("Expected unsafe archive rejection")
    } catch (expected: IOException) {
      assertTrue(expected.message.orEmpty().contains("unsafe entry"))
    }
  }

  @Test fun sameFutureWindowAcrossAllImporters() {
    assertEquals(24L * 3600_000L, EpgWindowPolicy.FUTURE_MS)
  }
}
