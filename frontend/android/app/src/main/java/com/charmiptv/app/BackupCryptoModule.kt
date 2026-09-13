package com.charmiptv.app

import com.facebook.react.bridge.*
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class BackupCryptoModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private val executor = Executors.newSingleThreadExecutor()
  private val busy = AtomicBoolean(false)
  override fun getName() = "CharmBackupCrypto"
  private fun run(promise: Promise, action: () -> String) {
    if (!busy.compareAndSet(false, true)) { promise.reject("E_BACKUP_BUSY", "Another backup operation is running."); return }
    executor.execute {
      try { promise.resolve(action()) }
      catch (_: Exception) { promise.reject("E_BACKUP", "Backup could not be processed. Check the password and file. Maximum size: 16 MiB; password: 10–256 characters.") }
      finally { busy.set(false) }
    }
  }
  @ReactMethod fun encrypt(raw: String, password: String, promise: Promise) = run(promise) { BackupCipher.encrypt(raw, password) }
  @ReactMethod fun decrypt(raw: String, password: String, promise: Promise) = run(promise) { BackupCipher.decrypt(raw, password) }
  override fun invalidate() { executor.shutdown(); super.invalidate() }
}
