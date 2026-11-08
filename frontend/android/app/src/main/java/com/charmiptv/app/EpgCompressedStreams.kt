package com.charmiptv.app

import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream
import org.tukaani.xz.XZInputStream

/**
 * Streaming XMLTV decoder shared by every EPG importer. The entire archive is
 * never loaded into RAM or extracted onto disk.
 *
 * The outer HTTP importer must *also* limit compressed download bytes. These
 * limits protect the decoded stream independently against decompression bombs.
 */
internal object EpgCompressedStreams {
  private const val BUFFER = 64 * 1024
  private const val MAX_ZIP_HEADERS = 16
  private const val XZ_MEMORY_LIMIT_KIB = 32 * 1024

  fun decode(
    raw: InputStream,
    maxBytes: Long = EpgWindowPolicy.MAX_DECOMPRESSED_BYTES,
    maxElapsedMs: Long = EpgWindowPolicy.MAX_IMPORT_DURATION_MS,
  ): InputStream {
    val buffered = if (raw is BufferedInputStream) raw else BufferedInputStream(raw, BUFFER)
    buffered.mark(8)
    val magic = ByteArray(6)
    var count = 0
    while (count < magic.size) {
      val next = buffered.read(magic, count, magic.size - count)
      if (next <= 0) break
      count += next
    }
    buffered.reset()

    val isGzip = count >= 2 && (magic[0].toInt() and 255) == 0x1f && (magic[1].toInt() and 255) == 0x8b
    val isZip = count >= 4 && magic[0].toInt() == 0x50 && magic[1].toInt() == 0x4b &&
      magic[2].toInt() == 0x03 && magic[3].toInt() == 0x04
    val isXz = count >= 6 &&
      (magic[0].toInt() and 255) == 0xfd && magic[1].toInt() == 0x37 &&
      magic[2].toInt() == 0x7a && magic[3].toInt() == 0x58 &&
      magic[4].toInt() == 0x5a && magic[5].toInt() == 0

    val decoded = when {
      isGzip -> GZIPInputStream(buffered, BUFFER)
      isZip -> openXmlZip(buffered, maxBytes)
      isXz -> XZInputStream(buffered, XZ_MEMORY_LIMIT_KIB)
      else -> buffered
    }
    return object : FilterInputStream(decoded) {
      private var consumed = 0L
      private val start = System.nanoTime()
      private fun guard(bytes: Int): Int {
        if ((System.nanoTime() - start) / 1_000_000L > maxElapsedMs)
          throw IOException("EPG import exceeded the total decoding deadline")
        if (bytes > 0) {
          if (bytes.toLong() > maxBytes - consumed)
            throw IOException("EPG decompressed size exceeds safety limit")
          consumed += bytes.toLong()
        }
        return bytes
      }
      override fun read(): Int {
        val value = super.read()
        guard(if (value < 0) 0 else 1)
        return value
      }
      override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        guard(super.read(buffer, offset, length))
    }
  }

  private fun openXmlZip(input: InputStream, maxBytes: Long): InputStream {
    val zip = ZipInputStream(input)
    try {
      for (index in 0 until MAX_ZIP_HEADERS) {
        val entry = zip.nextEntry ?: break
        val name = entry.name.replace('\\', '/')
        // Even though we never extract to disk, refuse unsafe filenames.
        if (name.startsWith('/') || name.split('/').any { it == ".." } || '\u0000' in name)
          throw IOException("EPG ZIP contains an unsafe entry name")
        if (entry.isDirectory) continue
        // Do not silently inflate arbitrary non-XML entries to reach a later
        // file. That creates a ZIP-bomb bypass before the decoded-byte guard.
        if (!name.endsWith(".xml", true) && !name.endsWith(".xmltv", true))
          throw IOException("EPG ZIP first file is not XMLTV")
        if (entry.size > maxBytes)
          throw IOException("EPG ZIP XML entry exceeds the decompressed size limit")
        return zip
      }
      throw IOException("EPG ZIP has no valid XMLTV file in the first 16 entries")
    } catch (failure: Throwable) {
      zip.close()
      throw failure
    }
  }
}
