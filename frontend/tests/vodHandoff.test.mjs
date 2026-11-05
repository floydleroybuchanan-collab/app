import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness({ release = async () => {}, native = async () => null } = {}) {
  const calls = [], effects = [], states = [];
  const React = {
    createElement: (...args) => args,
    useCallback: fn => fn,
    useRef: current => ({ current }),
    useState: initial => { const index = states.length; states.push(initial); return [initial, value => { states[index] = value; }]; },
  };
  const modules = {
    react: { ...React, default: React },
    'react-native': { NativeModules: { CharmVod: { openAdaptive: async (...args) => { calls.push(['native', ...args]); return native(...args); } } },
      Platform: { OS: 'android' }, StyleSheet: { create: styles => styles },
      ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View' },
    'expo-router': { useFocusEffect: fn => effects.push(fn), useRouter: () => ({ replace: route => calls.push(['route', route]) }), useLocalSearchParams: () => ({ section: 'movies' }) },
    '@/src/store': { useStore: () => ({ deviceLayoutMode: 'tv' }) },
    '@/src/core/mediaLibrary': { mediaLibraryPreferences: async () => ({ audio: 'en' }) },
    '@/src/components/PurpleTvShell': { PurpleTvShell: 'Shell', usePurpleTvDrawer: () => ({ closeDrawer: () => calls.push(['close-drawer']), openDrawer: () => calls.push(['open-drawer']) }) },
    '@/src/core/playbackSession': { stopAllPlaybackSessions: async reason => { calls.push(['release', reason]); await release(); } },
    '@/src/theme': { tvColors: {} },
    '@/src/components/DonationDialog': { useDonation: () => () => calls.push(['donation']) },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../app/(tabs)/vod.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const tree = exports.default();
  return { calls, states, tree, focus: () => effects[0]() };
}

test('native VOD automatically enters only after decoder-release acknowledgement, without a portal', async () => {
  let released;
  const h = harness({ release: () => new Promise(resolve => { released = resolve; }) });
  h.focus(); h.focus();
  await tick();
  assert.equal(h.calls.filter(call => call[0] === 'release').length, 1);
  assert.equal(h.calls.some(call => call[0] === 'native'), false);
  released(); await tick();
  assert.equal(h.calls.filter(call => call[0] === 'native').length, 1);
  assert.deepEqual(h.calls.find(call => call[0] === 'native').slice(1), ['tv', 'movies', '{"audio":"en"}']);
  assert.deepEqual(h.calls.at(-1), ['route', '/']);
  assert.doesNotMatch(JSON.stringify(h.tree), /Open Video OnDemand|Charming MediaLab TV|MediaLabArt/);
});

test('a release failure prevents opening a second playback owner and produces a retry error', async () => {
  const h = harness({ release: async () => { throw new Error('Could not release decoder'); } });
  h.focus(); await tick();
  assert.equal(h.calls.some(call => call[0] === 'native'), false);
  assert.equal(h.states[0], false);
  assert.match(h.states[1], /Unable to open Video OnDemand/);
});

test('native menu handoff returns to MediaLab home and opens its existing drawer', async () => {
  const h = harness({ native: async () => 'medialab:drawer' });
  h.focus(); await tick();
  assert.deepEqual(h.calls.slice(-2), [['route', '/'], ['open-drawer']]);
});
