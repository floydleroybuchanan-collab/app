package com.charmiptv.app

import java.io.File

/** Only legacy, app-owned loose downloads; cache journals belong to their owners. */
internal fun pruneLegacyScratchFiles(root: File, cutoff: Long): Pair<Long, Long> {
  var count = 0L
  var bytes = 0L
  val canonicalRoot = root.canonicalFile
  for (file in root.listFiles().orEmpty()) {
    if (!file.isFile || file.canonicalFile.parentFile != canonicalRoot || file.lastModified() >= cutoff) continue
    val eligible = file.name == "source_download.bin" || Regex("remote_[a-zA-Z0-9_]+\\.json").matches(file.name)
    if (!eligible) continue
    val size = file.length()
    if (file.delete()) { count++; bytes += size }
  }
  return count to bytes
}
