import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function harness() {
  const refs = [], effects = [], pending = [], requests = [];
  let cursor = 0, effectCursor = 0, appListener;
  const react = {
    useRef(value) { return refs[cursor++] ?? (refs[cursor - 1] = { current: value }); },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) {
      const index = effectCursor++, old = effects[index];
      // The hook's callbacks are stable in React; compare value dependencies here.
      const values = deps.filter(value => typeof value !== 'function');
      if (!old || values.some((value, i) => value !== old.values[i])) {
        pending.push(() => { old?.cleanup?.(); effects[index] = { values, cleanup: fn() }; });
      }
    },
  };
  const focus = { requestNativeFocusWithRetry(target, delays, confirmed) {
    const request = { target, delays, confirmed, canceled: false };
    requests.push(request);
    return () => { request.canceled = true; };
  } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source('src/components/useTVFocusEntry.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: module.exports, require: name => name === 'react' ? react : name === 'react-native' ? {
    Platform: { OS: 'android', isTV: false },
    AppState: { addEventListener(_, listener) { appListener = listener; return { remove() { appListener = undefined; } }; } },
  } : focus });
  return {
    requests,
    render(enabled = true, revision = 'login') {
      cursor = 0; effectCursor = 0;
      const hook = module.exports.useTVFocusEntry(enabled, revision);
      hook.entryRef.current = 'sign-in'; hook.fallbackRef.current = 'back';
      pending.splice(0).forEach(fn => fn());
      return hook;
    },
    appState(state) { appListener?.(state); },
    unmount() { effects.forEach(effect => effect.cleanup?.()); },
  };
}

test('Android entry retries until a real control reports focus, including non-TV Android classification', () => {
  const h = harness(), hook = h.render(), request = h.requests.at(-1);
  assert.equal(request.target(), 'sign-in');
  assert.equal(request.confirmed(), false);
  assert.equal(request.target(), 'sign-in');
  hook.onFocusCapture({ nativeEvent: { target: 42 } });
  assert.equal(request.confirmed(), true);
  assert.equal(request.canceled, true);
  hook.onLayout();
  assert.equal(h.requests.length, 1, 'layout must not steal focus after the user moved');
});

test('closing recovery restores its opener, with fallback if the old native target vanished', () => {
  const h = harness(), hook = h.render();
  hook.onFocusCapture({ nativeEvent: { target: 42 } });
  h.render(false);
  assert.equal(h.requests.length, 1, 'hidden parent must not compete with the dialog');
  h.render(true);
  const request = h.requests.at(-1);
  assert.equal(request.target(), 42);
  assert.equal(request.target(), 42);
  assert.equal(request.target(), 'sign-in');
});

test('mode changes discard old targets and missing primary actions use the Back/Exit control', () => {
  const h = harness(), hook = h.render();
  hook.onFocusCapture({ nativeEvent: { target: 42 } });
  const changed = h.render(true, 'register');
  assert.equal(h.requests.at(-1).target(), 'sign-in');
  changed.entryRef.current = null;
  assert.equal(h.requests.at(-1).target(), 'back');
});

test('backgrounding and unmount cancel pending entry requests; resume reclaims the last control', () => {
  const h = harness(), hook = h.render();
  hook.onFocusCapture({ nativeEvent: { target: 91 } });
  h.appState('background');
  assert.equal(h.requests.at(-1).canceled, true);
  h.appState('active');
  assert.equal(h.requests.at(-1).target(), 91);
  h.unmount();
  assert.equal(h.requests.at(-1).canceled, true);
});

test('account and notice entry is attached to visible controls, and Exit dismisses only the notice', () => {
  for (const file of ['AccountGate', 'AccountSecurityDialog', 'AnnouncementCenter']) {
    const text = source(`src/components/${file}.tsx`);
    assert.match(text, /<ScrollView focusable=\{false\} removeClippedSubviews=\{false\}/);
    assert.match(text, /onFocusCapture=\{entryFocus.onFocusCapture\}/);
    assert.match(text, /entryFocus.entryRef/);
  }
  const notice = source('src/components/AnnouncementCenter.tsx');
  assert.match(notice, /button\('Exit',dismiss\)/);
  assert.doesNotMatch(notice, /exitApp/);
  assert.match(notice, /a.version_code>version/);
  const recovery = source('src/components/AccountSecurityDialog.tsx');
  assert.match(recovery, /focusedInput===label&&styles.focused/);
});

test('native entry resolves TextInput and View tags on the UI thread and rejects hidden controls', () => {
  for (const path of ['android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt', 'plugins/withTvRemote.js']) {
    const text = source(path);
    assert.match(text, /fun requestControlFocus\(reactTag: Double, promise: Promise\)/);
    assert.match(text, /getUIManagerForReactTag\(ctx, tag\)\?\.resolveView\(tag\)/);
    assert.match(text, /!view.isAttachedToWindow \|\| !view.isShown \|\| !view.isEnabled \|\| !view.isFocusable/);
    assert.match(text, /promise.resolve\(view.requestFocus\(\)\)/);
  }
});

test('search recovery clears the hidden retry target before hiding the error controls', () => {
  const search = source('android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/search/SearchTvFragment.kt');
  const reset = search.indexOf('binding.etSearch.nextFocusDownId = filterFocusId.takeIf { it != View.NO_ID } ?: binding.vgvSearch.id');
  const hide = search.indexOf('binding.isLoading.root.visibility = View.GONE');
  assert.ok(reset >= 0 && reset < hide);
  assert.match(search, /if \(binding.isLoading.root.hasFocus\(\)\) binding.etSearch.requestFocus\(\)/);
});
