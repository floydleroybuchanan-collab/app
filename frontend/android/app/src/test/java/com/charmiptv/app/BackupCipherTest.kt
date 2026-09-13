package com.charmiptv.app
import org.junit.Assert.*
import org.junit.Test
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class BackupCipherTest {
  @Test fun authenticatedRoundTripAndRandomSalt() {
    val raw = "{\"provider\":\"private-credential\"}"
    val a = BackupCipher.encrypt(raw, "a long password")
    val b = BackupCipher.encrypt(raw, "a long password")
    assertNotEquals(a,b); assertFalse(a.contains("private-credential"))
    assertEquals(raw,BackupCipher.decrypt(a,"a long password"))
    assertTrue(runCatching { BackupCipher.decrypt(a,"wrong password") }.isFailure)
    val parts = a.split('.').toMutableList()
    parts[3] = (if(parts[3][0]=='A') "B" else "A") + parts[3].substring(1)
    assertTrue(runCatching { BackupCipher.decrypt(parts.joinToString("."),"a long password") }.isFailure)
  }
  @Test fun olderAndroidDerivationMatchesStandardIncludingUnicode() {
    val password = "test-password-é"
    val salt = ByteArray(16) { it.toByte() }
    val expected = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(password.toCharArray(),salt,210000,256)).encoded
    assertArrayEquals(expected, BackupCipher.portableKey(password,salt))
  }
}
