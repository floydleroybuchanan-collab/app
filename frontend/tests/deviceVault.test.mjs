import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/utils/deviceVault.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

/** One "process": fresh module state over persistent app storage and keystore. */
function launch(disk, keystore) {
  const exports = {};
  const asyncStorage = {
    getItem: async (key) => disk.has(key) ? disk.get(key) : null,
    setItem: async (key, value) => { disk.set(key, value); },
    removeItem: async (key) => { disk.delete(key); },
  };
  vm.runInNewContext(code, {
    exports,
    require: (name) => name === "expo-secure-store" ? keystore : name === "@react-native-async-storage/async-storage" ? { default: asyncStorage } : assert.fail(name),
  });
  return exports;
}

function keystore({ decryptWorks = true } = {}) {
  const items = new Map();
  return {
    items,
    isAvailableAsync: async () => true,
    setItemAsync: async (key, value) => { items.set(key, `enc:${value}`); },
    getItemAsync: async (key) => {
      if (!items.has(key)) return null;
      if (!decryptWorks) throw Object.assign(Error("Could not decrypt the value for key. Caused by: Keystore operation failed"), { code: "ERR_DECRYPT" });
      return items.get(key).slice(4);
    },
    deleteItemAsync: async (key) => { items.delete(key); },
  };
}

test("a working keystore keeps every secret hardware-encrypted and nothing in app storage", async () => {
  const disk = new Map(), ks = keystore();
  await launch(disk, ks).setItemAsync("charm_account_session_token_v1", "token-1");
  assert.equal(await launch(disk, ks).getItemAsync("charm_account_session_token_v1"), "token-1");
  assert.equal(ks.items.get("charm_account_session_token_v1"), "enc:token-1");
  assert.deepEqual([...disk.keys()].filter((key) => key.startsWith("charm_device_vault:")), []);
});

test("a keystore that cannot decrypt (BlueStacks) keeps the session across restarts", async () => {
  const disk = new Map(), ks = keystore({ decryptWorks: false });
  await launch(disk, ks).setItemAsync("charm_account_session_token_v1", "token-2");
  assert.equal(disk.get("charm_device_vault_mode_v1"), "app");
  assert.equal(await launch(disk, ks).getItemAsync("charm_account_session_token_v1"), "token-2");
  assert.equal(ks.items.has("charm_account_session_token_v1"), false);
});

test("a later decrypt failure switches modes once instead of signing out forever", async () => {
  const disk = new Map(), ks = keystore();
  await launch(disk, ks).setItemAsync("playlist-user-1", "http://example.invalid/list");
  ks.getItemAsync = async () => { throw Object.assign(Error("Keystore operation failed"), { code: "ERR_DECRYPT" }); };
  const next = launch(disk, ks);
  assert.equal(await next.getItemAsync("playlist-user-1"), null);
  assert.equal(disk.get("charm_device_vault_mode_v1"), "app");
  await next.setItemAsync("playlist-user-1", "http://example.invalid/list");
  assert.equal(await launch(disk, ks).getItemAsync("playlist-user-1"), "http://example.invalid/list");
});

test("deleting clears both places", async () => {
  const disk = new Map([["charm_device_vault_mode_v1", "app"], ["charm_device_vault:k", "v"]]), ks = keystore();
  ks.items.set("k", "enc:old");
  await launch(disk, ks).deleteItemAsync("k");
  assert.equal(disk.has("charm_device_vault:k"), false);
  assert.equal(ks.items.has("k"), false);
});
