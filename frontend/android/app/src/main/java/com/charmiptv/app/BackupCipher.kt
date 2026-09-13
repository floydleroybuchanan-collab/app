package com.charmiptv.app

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import javax.crypto.Mac
import java.util.Base64

/** Versioned authenticated envelope. The password is never saved. */
internal object BackupCipher {
  const val MAX_BYTES = 16 * 1024 * 1024
  private const val HEADER = "CMLBACKUP1"
  private const val ITERATIONS = 210000
  private fun key(password: String, salt: ByteArray): SecretKeySpec {
    require(password.length in 10..256) { "Use a backup password of 10 to 256 characters." }
    val chars = password.toCharArray()
    val spec = PBEKeySpec(chars, salt, ITERATIONS, 256)
    return try {
      val bytes = try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded }
      catch (_: java.security.NoSuchAlgorithmException) { portableKey(password, salt) }
      SecretKeySpec(bytes, "AES")
    }
    finally { spec.clearPassword(); chars.fill('\u0000') }
  }
  // Android 7 providers may not expose the named PBKDF2 factory. HMAC-SHA256 is available.
  internal fun portableKey(password: String, salt: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    val passwordBytes = password.toByteArray(Charsets.UTF_8)
    mac.init(SecretKeySpec(passwordBytes, "HmacSHA256")); passwordBytes.fill(0)
    var block = mac.doFinal(salt + byteArrayOf(0,0,0,1))
    val result = block.clone()
    repeat(ITERATIONS - 1) {
      block = mac.doFinal(block)
      for (i in result.indices) result[i] = (result[i].toInt() xor block[i].toInt()).toByte()
    }
    block.fill(0)
    return result
  }
  fun encrypt(raw: String, password: String): String {
    require(raw.length <= MAX_BYTES) { "Backup exceeds the 16 MiB safety limit." }
    val bytes = raw.toByteArray(Charsets.UTF_8)
    require(bytes.size <= MAX_BYTES) { "Backup exceeds the 16 MiB safety limit." }
    val random = SecureRandom()
    val salt = ByteArray(16).also(random::nextBytes)
    val nonce = ByteArray(12).also(random::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key(password, salt), GCMParameterSpec(128, nonce))
    cipher.updateAAD(HEADER.toByteArray(Charsets.UTF_8))
    val b64 = Base64.getEncoder()
    return listOf(HEADER, b64.encodeToString(salt), b64.encodeToString(nonce), b64.encodeToString(cipher.doFinal(bytes))).joinToString(".")
  }
  fun decrypt(envelope: String, password: String): String {
    require(envelope.length <= MAX_BYTES * 4 / 3 + 256) { "Backup exceeds the safety limit." }
    val parts = envelope.split('.', limit = 4)
    require(parts.size == 4 && parts[0] == HEADER) { "Unsupported encrypted backup." }
    val decoder = Base64.getDecoder()
    val salt = decoder.decode(parts[1]); val nonce = decoder.decode(parts[2]); val data = decoder.decode(parts[3])
    require(salt.size == 16 && nonce.size == 12 && data.size in 16..MAX_BYTES+16)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(password, salt), GCMParameterSpec(128, nonce))
    cipher.updateAAD(HEADER.toByteArray(Charsets.UTF_8))
    return cipher.doFinal(data).toString(Charsets.UTF_8)
  }
}
