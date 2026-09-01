package com.charmiptv.app

internal object EpgDiagnosticSafety {
  private val address = Regex("(?i)https?://[^\\s]+")
  private val credential = Regex("(?i)(password|passwd|pass|username|user|token|api[_-]?key|key)=([^&\\s]+)")

  fun message(error: Throwable): String = message(error.message)

  fun message(raw: String?): String {
    val clean = raw.orEmpty()
      .replace(address, "[provider address hidden]")
      .replace(credential) { "${it.groupValues[1]}=[hidden]" }
      .trim()
    return clean.ifBlank { "Guide update failed" }.take(500)
  }
}
