package com.streamflixreborn.streamflix.vod

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** Credentials never enter preferences, cloud sync, backup exports or playback intents. */
class DebridVault internal constructor(context: Context,
    private val testKey: ((Boolean) -> SecretKey)? = null,
    private val testCipher: (() -> Cipher)? = null) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "charm-rd.v1"))
    private val alias = context.packageName + ".vod.real-debrid.v1"
    @Volatile var readError: String? = null
        private set
    private fun cipher(): Cipher {
        testCipher?.let { return it() }
        // VOD installs Conscrypt first for HTTPS. Non-exportable Android Keystore
        // keys must use Android's own cipher implementation, independent of that order.
        val provider = java.security.Security.getProvider("AndroidKeyStoreBCWorkaround")
        return if (provider != null) Cipher.getInstance("AES/GCM/NoPadding", provider)
            else Cipher.getInstance("AES/GCM/NoPadding")
    }
    private fun key(create: Boolean): SecretKey {
        testKey?.let { return it(create) }
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        if (!create) throw java.io.IOException("The saved Real-Debrid encryption key is unavailable.")
        return KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
    }
    @Synchronized fun read(): JSONObject? {
        readError = null
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return null
        return try {
            val data = file.readFully()
            require(data.size > 28)
            val cipher = cipher()
            cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, data.copyOfRange(0, 12)))
            JSONObject(String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8))
        } catch (_: Exception) {
            readError = "The saved Real-Debrid connection could not be unlocked on this device. Restart and try again; the saved connection has not been deleted."
            null
        }
    }
    @Synchronized fun write(value: JSONObject) {
        val cipher = cipher()
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        val encrypted = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
        val stream = file.startWrite()
        try { stream.write(encrypted); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
        val restored = read() ?: throw java.io.IOException("Real-Debrid could not be saved securely on this device. Please try again.")
        if (restored.toString() != value.toString()) throw java.io.IOException("The saved Real-Debrid connection could not be verified.")
    }
    @Synchronized fun clear() { file.delete() }
}
