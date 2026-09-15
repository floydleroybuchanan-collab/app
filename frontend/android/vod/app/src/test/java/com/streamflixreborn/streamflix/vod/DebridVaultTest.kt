package com.streamflixreborn.streamflix.vod

import android.app.Application
import java.io.File
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], application=Application::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
class DebridVaultTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val key = SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES")
    private fun vault() = DebridVault(context, { key }, { Cipher.getInstance("AES/GCM/NoPadding") })
    @Test fun oauthAndSearchPermissionsSurviveNewVaultInstance() {
        val first = vault()
        first.write(JSONObject().put("access_token", "TEST_ONLY").put("refresh_token", "REFRESH_TEST")
            .put("auth_mode", "oauth").put("expires_at", 123L).put("torrentio-consent", true))
        val restored = vault().read()!!
        assertEquals("TEST_ONLY", restored.getString("access_token"))
        assertEquals("REFRESH_TEST", restored.getString("refresh_token"))
        assertTrue(restored.getBoolean("torrentio-consent"))
        assertFalse(File(context.noBackupFilesDir, "charm-rd.v1").readText(Charsets.ISO_8859_1).contains("TEST_ONLY"))
    }
    @Test fun readFailureDoesNotCreateAnotherKeyOrDeleteSavedAccount() {
        vault().write(JSONObject().put("access_token", "TEST_ONLY"))
        var attemptedCreate = false
        val unavailable = DebridVault(context, { create -> attemptedCreate = create; throw java.io.IOException() },
            { Cipher.getInstance("AES/GCM/NoPadding") })
        assertNull(unavailable.read())
        assertFalse(attemptedCreate)
        assertNotNull(unavailable.readError)
        assertEquals("TEST_ONLY", vault().read()!!.getString("access_token"))
    }
    @Test fun tamperedCiphertextIsRejectedAndPreservedForRecovery() {
        vault().write(JSONObject().put("access_token", "TEST_ONLY"))
        val file = File(context.noBackupFilesDir, "charm-rd.v1")
        val bytes = file.readBytes(); bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte(); file.writeBytes(bytes)
        val next = vault()
        assertNull(next.read()); assertNotNull(next.readError)
        assertArrayEquals(bytes, file.readBytes())
    }
    @Test fun interruptedAtomicWriteRestoresBackupAfterRestart() {
        vault().write(JSONObject().put("access_token", "TEST_ONLY"))
        val file = File(context.noBackupFilesDir, "charm-rd.v1")
        assertTrue(file.renameTo(File(file.path + ".bak")))
        assertEquals("TEST_ONLY", vault().read()!!.getString("access_token"))
    }

}
