import * as SecureStore from "expo-secure-store";

const KEY = "charm_remembered_login_v1";
export type RememberedLogin = { username: string; password: string };

// Never use general preferences or browser storage for saved passwords.
export async function readRememberedLogin(): Promise<RememberedLogin | null> {
  try {
    if (!await SecureStore.isAvailableAsync()) return null;
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return typeof value?.username === "string" && value.username.trim() &&
      typeof value?.password === "string" && value.password
      ? { username: value.username.trim(), password: value.password } : null;
  } catch { return null; }
}

export async function forgetRememberedLogin(): Promise<boolean> {
  try {
    if (!await SecureStore.isAvailableAsync()) return true;
    await SecureStore.deleteItemAsync(KEY);
    return true;
  } catch { return false; }
}

export async function saveRememberedLogin(username: string, password: string): Promise<boolean> {
  try {
    if (!await SecureStore.isAvailableAsync()) return false;
    await SecureStore.setItemAsync(KEY, JSON.stringify({ username: username.trim(), password }));
    return true;
  } catch {
    await forgetRememberedLogin();
    return false;
  }
}
