import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup() {
  const values = new Map([['gs_parental_pin', '1234'], ['gs_parental_locked_groups', ['Restricted']]]);
  let fail = false;
  const storage = {
    getItem: async (key, fallback) => key === 'gs_parental_pin' ? '' : values.get(key) ?? fallback,
    secureGet: async (key, fallback) => values.get(key) ?? fallback,
    secureSet: async (key, value) => { if (fail) return false; values.set(key, value); return true; },
    secureRemove: async key => { if (fail) return false; values.delete(key); return true; },
    removeItem: async () => true,
    setItem: async (key, value) => { if (fail) return false; values.set(key, value); return true; },
  };
  function load(file, imports) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/core/' + file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, require: name => imports[name] });
    return exports;
  }
  const core = load('parentalPinCore.ts', {});
  const api = load('parentalPin.ts', { './parentalPinCore': core, '@/src/utils/storage': { storage },
    react: { useEffect() {}, useState: value => [value, () => {}], useCallback: fn => fn } });
  return { api, values, fail: value => { fail = value; } };
}

test('failed parental persistence keeps the existing PIN and group rules', async () => {
  const h = setup();
  assert.equal(await h.api.isPlaybackGroupLocked(['Restricted']), true);
  h.fail(true);
  await assert.rejects(h.api.setParentalPin('5678'), /could not be saved/);
  assert.equal(h.api.verifyParentalPin('1234'), true);
  assert.equal(h.api.verifyParentalPin('5678'), false);
  await assert.rejects(h.api.setLockedGroups([]), /could not be saved/);
  assert.equal(await h.api.isPlaybackGroupLocked(['Restricted']), true);
});

test('changing the PIN relocks previously unlocked groups and saves before publishing', async () => {
  const h = setup();
  await h.api.isPlaybackGroupLocked(['Restricted']);
  h.api.useParentalPin().unlockGroup('Restricted');
  assert.equal(await h.api.isPlaybackGroupLocked(['Restricted']), false);
  await h.api.setParentalPin('5678');
  assert.equal(h.values.get('gs_parental_pin'), '5678');
  assert.equal(await h.api.isPlaybackGroupLocked(['Restricted']), true);
});

test('group edits before hydration retain the stored PIN', async () => {
  const h = setup();
  await h.api.setLockedGroups(['New group']);
  assert.equal(h.api.verifyParentalPin('1234'), true);
  assert.equal(await h.api.isPlaybackGroupLocked(['New group']), true);
});
