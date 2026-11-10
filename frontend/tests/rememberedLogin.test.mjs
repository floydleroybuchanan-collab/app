import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function setup({ available = true, raw = null, writeFails = false, deleteFails = false } = {}) {
  let saved = raw;
  const calls = [];
  const secure = {
    isAvailableAsync: async () => available,
    getItemAsync: async () => saved,
    setItemAsync: async (key, value) => { calls.push('write'); if (writeFails) throw Error('locked'); saved = value; },
    deleteItemAsync: async () => { calls.push('delete'); if (deleteFails) throw Error('locked'); saved = null; },
  };
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL('../src/auth/rememberedLogin.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { exports, require: name => { assert.equal(name, '@/src/utils/deviceVault'); return secure; } });
  return { api: exports, calls, saved: () => saved };
}

test('remembered login saves and retrieves credentials through secure storage and forget removes them', async () => {
  const s = setup();
  assert.equal(await s.api.saveRememberedLogin(' viewer ', 'not-a-real-password'), true);
  assert.equal((await s.api.readRememberedLogin()).username, 'viewer');
  assert.equal((await s.api.readRememberedLogin()).password, 'not-a-real-password');
  assert.equal(await s.api.forgetRememberedLogin(), true);
  assert.equal(await s.api.readRememberedLogin(), null);
});
test('an unavailable device vault saves and reads nothing', async () => {
  const s = setup({ available: false });
  assert.equal(await s.api.saveRememberedLogin('viewer', 'secret'), false);
  assert.equal(await s.api.readRememberedLogin(), null);
  assert.deepEqual(s.calls, []);
});
test('corrupt or incomplete saved login is ignored without blocking entry', async () => {
  for (const raw of ['bad-json', '{}', '{"username":"viewer"}', '{"username":42,"password":"secret"}']) {
    assert.equal(await setup({ raw }).api.readRememberedLogin(), null);
  }
});
test('failed write removes a stale remembered account and failed removal reports failure', async () => {
  const s = setup({ raw: '{"username":"old","password":"old"}', writeFails: true });
  assert.equal(await s.api.saveRememberedLogin('new', 'new'), false);
  assert.equal(s.saved(), null);
  assert.equal(await setup({ deleteFails: true }).api.forgetRememberedLogin(), false);
});
