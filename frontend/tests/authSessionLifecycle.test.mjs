import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const ok = token => ({ response: { ok: true, status: 200 }, data: { success: true, token, user: { id: token } } });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function setup(overrides = {}) {
  let stored = overrides.stored || null, hook = 0, context, effects = [];
  const slots = [], configured = [], nativeSessions = [], revoked = [], intervals = [];
  const React = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (_type, props) => { context = props.value; return null; },
    useRef: value => { const index = hook++; return slots[index] ||= { current: value }; },
    useState: value => {
      const index = hook++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useCallback: fn => fn, useMemo: fn => fn(), useContext: () => context,
    useEffect: fn => { effects.push(fn); },
  };
  const api = {
    loginToAccount: async username => ok(username),
    registerAccountWithInvite: async (_invite, username) => ok(username),
    getCurrentAccount: async token => ok(token),
    getManagedContentAccess: async token => ({ response: { ok: true }, data: { success: true, content: { token } } }),
    logoutAccount: async token => { revoked.push(token); return ok(token); },
    getReferralSummary: async () => ({ response: { ok: true }, data: { success: true, referral: {} } }),
    ...overrides.api,
  };
  const storage = {
    secureGet: async () => stored,
    secureSet: async (_key, value) => { if (overrides.writeGate) await overrides.writeGate(value); stored = value; return true; },
    secureRemove: async () => { stored = null; return true; },
  };
  const appState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
  const imports = {
    react: React,
    'react-native': { AppState: appState, NativeModules: { CharmVod: { setUsageSession: token => nativeSessions.push(token) } } },
    '@/src/auth/accountApi': api,
    '@/src/auth/managedContentAccess': { configureManagedContentAccess: data => { configured.push(data.token); return true; }, clearManagedContentAccess() {} },
    '@/src/utils/storage': { storage },
    './rememberedLogin': { forgetRememberedLogin: async () => true, saveRememberedLogin: async () => true },
    '@/src/core/providerMediaSession': { clearProviderMedia() {} },
    '@/src/core/providerLibrary': { setProviderLibraryAccount() {} },
    '@/src/core/vodUnifiedSearch': { clearVodSearchCache() {} },
    '@/src/core/vodProviderCatalogCache': { clearVodProviderCatalogCache() {} },
  };
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL('../src/auth/AuthContext.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(js, { exports, require: name => { assert.ok(imports[name], name); return imports[name]; },
    setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {}, Date, Promise });
  const render = () => { hook = 0; effects = []; exports.AuthProvider({ children: null }); return context; };
  render();
  return { render, api, configured, nativeSessions, revoked, appState, intervals,
    stored: () => stored, effects: () => effects };
}

test('logout during account restoration rejects the late validation and content handoff', async () => {
  const response = deferred();
  const h = setup({ stored: 'old', api: { getCurrentAccount: () => response.promise } });
  const restoring = h.render().retryRestore();
  await flush();
  await h.render().signOut();
  response.resolve(ok('old'));
  await restoring;
  assert.equal(h.render().status, 'signed_out');
  assert.equal(h.stored(), null);
  assert.deepEqual(h.configured, []);
  assert.ok(!h.nativeSessions.includes('old'));
});

test('an older login response cannot replace a newer account or configure its sources', async () => {
  const response = deferred();
  const h = setup({ api: { loginToAccount: username => username === 'old' ? response.promise : Promise.resolve(ok(username)) } });
  const old = h.render().signIn('old', 'test-only');
  await h.render().signIn('new', 'test-only');
  response.resolve(ok('old'));
  assert.match(await old, /no longer active/);
  assert.equal(h.render().user.id, 'new');
  assert.equal(h.stored(), 'new');
  assert.deepEqual(h.configured, ['new']);
  assert.deepEqual(h.revoked, ['old']);
});

test('late secure writes are removed before a newer login is committed', async () => {
  const writing = deferred();
  const h = setup({ writeGate: token => token === 'old' ? writing.promise : Promise.resolve() });
  const old = h.render().signIn('old', 'test-only', true);
  await flush();
  const logout = h.render().signOut();
  const newer = h.render().signIn('new', 'test-only');
  await flush();
  writing.resolve();
  await Promise.all([old, logout, newer]);
  assert.equal(h.stored(), 'new');
  assert.equal(h.render().user.id, 'new');
  assert.deepEqual(h.configured, ['new']);
});

test('a stale referral rejection cannot log out the current account', async () => {
  const response = deferred();
  const h = setup({ api: { getReferralSummary: () => response.promise } });
  await h.render().signIn('old', 'test-only');
  const referral = h.render().loadReferrals();
  await h.render().signOut();
  await h.render().signIn('new', 'test-only');
  response.resolve({ response: { ok: false, status: 401 }, data: {} });
  assert.match((await referral).error, /session changed/);
  assert.equal(h.render().user.id, 'new');
  assert.equal(h.stored(), 'new');
});

test('periodic account validation skips background state and still checks foreground', async () => {
  let checks = 0;
  const h = setup({ api: { getCurrentAccount: async token => { checks++; return ok(token); } } });
  await h.render().signIn('viewer', 'test-only');
  h.render();
  const cleanup = h.effects()[1]();
  h.appState.currentState = 'background';
  h.intervals[0]();
  await flush();
  assert.equal(checks, 0);
  h.appState.currentState = 'active';
  h.intervals[0]();
  await flush();
  assert.equal(checks, 1);
  cleanup();
});
