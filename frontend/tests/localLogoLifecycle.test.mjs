import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function setup(readDirectory) {
  const maps = [];
  class ObservedMap extends Map { constructor(...args) { super(...args); maps.push(this); } }
  let folder = 'content://test/logos';
  const imports = {
    react: { useEffect() {}, useState() {} },
    'react-native': { Platform: { OS: 'android' } },
    'expo-file-system/legacy': { StorageAccessFramework: { readDirectoryAsync: readDirectory } },
    '@/src/utils/storage': { storage: { getItem: async () => folder, removeItem: async () => { folder = ''; } } },
  };
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL('../src/core/localLogoFolder.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(js, { exports, Map: ObservedMap, require: name => imports[name] });
  return { api: exports, cache: maps[1] };
}

test('local logo cache bounds exact matches and prefix matches as well as misses', async () => {
  const h = setup(async () => Array.from({ length: 1000 }, (_, i) => `content://test/ch${String(i).padStart(4, '0')}.png`));
  await h.api.loadLocalLogoFolder();
  for (let i = 0; i < 1000; i++) {
    assert.ok(h.api.resolveLocalLogo(`ch${String(i).padStart(4, '0')}`));
    assert.ok(h.cache.size <= 512);
  }
  for (let i = 0; i < 1000; i++) {
    assert.ok(h.api.resolveLocalLogo(`ch${String(i).padStart(4, '0')}HD`));
    assert.ok(h.cache.size <= 512);
  }
});

test('clearing a logo folder rejects an in-flight directory result', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = setup(() => pending);
  const loading = h.api.loadLocalLogoFolder();
  await Promise.resolve(); await Promise.resolve();
  await h.api.clearLocalLogoFolder();
  finish(['content://test/News.png']);
  await loading;
  assert.equal(h.api.resolveLocalLogo('News'), undefined);
});

test('a miss cached while scanning is invalidated when the directory completes', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = setup(() => pending);
  const loading = h.api.loadLocalLogoFolder();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.api.resolveLocalLogo('News'), undefined);
  finish(['content://test/News.png']);
  await loading;
  assert.equal(h.api.resolveLocalLogo('News'), 'content://test/News.png');
});
