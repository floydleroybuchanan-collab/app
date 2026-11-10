import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Drop-in for expo-secure-store (same four calls) that survives devices whose
 * Android keystore cannot decrypt. BlueStacks (Android 9) encrypts with any
 * keystore key but every decrypt fails ("Incompatible purpose"), so sessions,
 * remembered logins and personal playlist URLs vanished on each restart.
 *
 * A one-time write/read self-test picks the mode and is cached:
 * - "keystore": the normal, hardware-backed SecureStore path (all working devices).
 * - "app": app-private storage (sandboxed, android:allowBackup=false), used only
 *   on a device whose keystore failed the test or a later decrypt.
 */
type Mode = "keystore" | "app";

const MODE_KEY = "charm_device_vault_mode_v1";
const PROBE_KEY = "charm_device_vault_probe_v1";
const APP_PREFIX = "charm_device_vault:";

let modePromise: Promise<Mode> | null = null;

async function probe(): Promise<Mode> {
  try {
    const saved = await AsyncStorage.getItem(MODE_KEY);
    if (saved === "keystore" || saved === "app") return saved;
  } catch { /* first run or unreadable: run the test */ }
  let mode: Mode = "app";
  try {
    if (await SecureStore.isAvailableAsync()) {
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      await SecureStore.setItemAsync(PROBE_KEY, token);
      if (await SecureStore.getItemAsync(PROBE_KEY) === token) mode = "keystore";
    }
  } catch { mode = "app"; }
  try { await SecureStore.deleteItemAsync(PROBE_KEY); } catch { /* broken keystore */ }
  try { await AsyncStorage.setItem(MODE_KEY, mode); } catch { /* retried next launch */ }
  return mode;
}

function vaultMode(): Promise<Mode> {
  if (!modePromise) modePromise = probe();
  return modePromise;
}

/** A keystore that worked once can still fail a decrypt later; stop using it. */
async function switchToAppStorage(): Promise<void> {
  modePromise = Promise.resolve("app");
  try { await AsyncStorage.setItem(MODE_KEY, "app"); } catch { /* in-memory switch still applies */ }
}

function isKeystoreFailure(error: unknown): boolean {
  const text = `${(error as any)?.code || ""} ${(error as any)?.message || ""}`;
  return /ERR_DECRYPT|ERR_KEY_?STORE|decrypt|keystore/i.test(text);
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (await vaultMode() === "app") return AsyncStorage.getItem(APP_PREFIX + key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    if (!isKeystoreFailure(error)) throw error;
    // The encrypted copy is unrecoverable on this device; drop it once.
    await switchToAppStorage();
    try { await SecureStore.deleteItemAsync(key); } catch { /* already unusable */ }
    return AsyncStorage.getItem(APP_PREFIX + key);
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (await vaultMode() === "app") {
    await AsyncStorage.setItem(APP_PREFIX + key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    if (!isKeystoreFailure(error)) throw error;
    await switchToAppStorage();
    await AsyncStorage.setItem(APP_PREFIX + key, value);
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  // Clear both places so a mode switch never leaves an old secret behind.
  await AsyncStorage.removeItem(APP_PREFIX + key);
  if (await vaultMode() === "keystore") await SecureStore.deleteItemAsync(key);
  else { try { await SecureStore.deleteItemAsync(key); } catch { /* broken keystore */ } }
}
