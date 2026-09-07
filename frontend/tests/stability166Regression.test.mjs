import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function load(p, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, { exports, require: n => { assert.ok(n in mocks, n); return mocks[n]; }, ...globals }, { filename: p });
  return exports;
}
async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve(); }

test('actual progress subscriber delivers rapid completion/error and trailing intermediate updates', () => {
  let now = 1000, callback, nextTimer = 0;
  const timers = new Map(), seen = [], cleanups = [];
  const api = load('src/components/EpgProgressBar.tsx', {
    react: { useState: v => [v, next => seen.push(next)], useRef: v => ({ current: v }), useEffect: fn => cleanups.push(fn()) },
    'react-native': { StyleSheet: { create: x => x }, Animated: { Value: class { setValue() {} } } },
    '@/src/theme': { colors: {}, fonts: {}, radius: {}, spacing: {} },
    '@/src/source': { subscribeProgress: cb => { callback = cb; return () => {}; } },
  }, { Date: { now: () => now }, setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) });
  api.EpgProgressBar();
  callback({ phase: 'finalizing', ratio: .99 });
  now += 10; callback({ phase: 'ready', ratio: 1 });
  assert.deepEqual(seen.map(row => row.phase), ['finalizing', 'ready']);
  callback({ phase: 'parsing', ratio: .5 });
  now += 10; callback({ phase: 'parsing', ratio: .6 });
  now += 10; callback({ phase: 'parsing', ratio: .7 });
  assert.equal(timers.size, 1);
  now += 250; const trailing = [...timers.values()][0]; timers.clear(); trailing();
  assert.equal(seen.at(-1).ratio, .7);
  callback({ phase: 'error', ratio: 0 });
  assert.equal(seen.at(-1).phase, 'error');
  callback({ phase: 'parsing', ratio: .8 });
  now += 10; callback({ phase: 'parsing', ratio: .9 });
  cleanups.filter(Boolean).forEach(fn => fn());
  assert.equal(timers.size, 0);
});

function matchApi(nativeWrite, ramWrite, globals = {}) {
  const reads = [];
  const api = load('src/nativeEpg.ts', {
    'react-native': { NativeModules: {
      CharmEpg: { upsertPlaylistEpgMatches: nativeWrite, queryGuideWindow: async () => { reads.push('sqlite'); return []; } },
      CharmEpgRam: { replaceMatches: ramWrite, queryGuideWindow: async () => { reads.push('ram'); return []; } },
    }, Platform: { OS: 'android' }, DeviceEventEmitter: {} },
    '@/src/core/playlistEpgHeader': {}, '@/src/core/multiEpgSources': {}, '@/src/core/sourceParsing': {},
  }, { setTimeout, clearTimeout, ...globals });
  return { api, reads };
}
const matches = [{ playlistId: 'synthetic-channel', xmltvId: 'synthetic-epg' }];
for (const outcome of ['reject', 'false', 'true']) test('guide match writes report ' + outcome + ' accurately and select the safe read path', async () => {
  const { api, reads } = matchApi(
    () => outcome === 'reject' ? Promise.reject(Error('synthetic failure')) : Promise.resolve(true),
    () => Promise.resolve(outcome !== 'false'),
  );
  if (outcome === 'true') assert.equal(await api.upsertNativePlaylistEpgMatches(matches, 7), true);
  else await assert.rejects(api.upsertNativePlaylistEpgMatches(matches, 7), /could not be synchronized/);
  await api.queryNativeGuideWindow(['synthetic-channel'], 1, 2);
  assert.deepEqual(reads, [outcome === 'true' ? 'ram' : 'sqlite']);
});

test('timed-out match writes cannot enable stale RAM even when the old write eventually resolves', async () => {
  let expire, finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const { api, reads } = matchApi(() => ++calls === 1 ? pending : Promise.resolve(true), async () => true,
    { setTimeout: fn => { expire = fn; return 1; }, clearTimeout() {} });
  const result = api.upsertNativePlaylistEpgMatches(matches, 7);
  expire(); assert.equal(await result, false);
  finish(true); await settle();
  await api.queryNativeGuideWindow(['synthetic-channel'], 1, 2);
  assert.deepEqual(reads, ['sqlite']);
  assert.equal(await api.upsertNativePlaylistEpgMatches(matches, 8), true);
  await api.queryNativeGuideWindow(['synthetic-channel'], 1, 2);
  assert.deepEqual(reads, ['sqlite', 'ram']);
});

test('native unchanged matches are a successful synchronization, not a failed write', () => {
  const bridge = read('android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt');
  const start = bridge.indexOf('fun upsertPlaylistEpgMatches(');
  const method = bridge.slice(start, bridge.indexOf('\n  @ReactMethod', start));
  assert.match(method, /database.replacePlaylistEpgMatches\(rows, guideEpoch.toLong\(\)\)[\s\S]*?promise.resolve\(true\)/);
  assert.match(method, /promise.reject\("EPG_MATCH_UPSERT_FAILED"/);
  const caller = read('src/source.native.ts');
  assert.match(caller, /if \(finished\) lastNativeMatchWriteFingerprint = writeFingerprint/);
  assert.doesNotMatch(caller, /await syncMatchesToNative\((?:matchedChannelsWithLogos|refreshedChannels), guideEpoch\).catch/);
});

for (const supported of [false, true]) test('actual track listener restores saved audio only if supported: ' + supported, async () => {
  const p = 'src/components/StreamPlayer.tsx';
  const source = ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'addNativePlaybackTracksListener') callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(callback);
  const code = ts.transpileModule('const callback = ' + callback.getText(source) + '; callback(event);', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const selections = [], saved = { id: 'old-track', mimeType: 'audio/aac', isSupported: supported };
  vm.runInNewContext(code, {
    event: { owner: 'fullscreen', generation: 1, channelKey: 'synthetic-channel', audio: [saved, { id: 'other', isSupported: true }], text: [] },
    generationRef: { current: 1 }, owner: 'fullscreen', currentChannelKey: 'synthetic-channel', role: 'fullscreen', engine: 'media3',
    isSessionCurrent: () => true, tracksRef: { current: {} }, onTracksRef: { current: () => {} }, audioTrack: undefined, textTrack: null,
    getRememberedChannelAudioTrack: () => 'old-track', getPreferredAudioLanguage: () => 'en',
    runNativePlaybackCommand: async (_role, _engine, valid, run) => { if (valid()) run(); },
    selectNativeAudio: (track, language) => selections.push([track, language]), selectNativeSubtitle: () => {},
    recordAudioDiagnostics: () => {}, fingerprintStreamUri: () => '', uri: 'https://example.invalid/synthetic', kind: 'hls',
  });
  await settle();
  assert.equal(selections[0][0], supported ? saved : null);
  if (!supported) assert.equal(selections[0][1], 'en');
});

test('navigation during a playlist job defers following guide jobs and resumes catalog publication on return', async () => {
  let now = 0, pathname = '/guide', release, refAt = 0, mounted = false;
  const refs = [], timers = [], calls = [];
  const held = new Promise(resolve => { release = resolve; });
  const rows = [{ id: 'one', revision: 'same', enabled: true, epgSourceIds: ['extra'] }];
  const custom = { id: 'extra', enabled: true, url: 'https://example.invalid/epg', refreshHours: 1, lastRefreshAt: 0, overrides: {} };
  const api = load('src/components/SourceRefreshScheduler.tsx', {
    react: { useRef: v => refs[refAt++] ||= { current: v }, useEffect: fn => { if (!mounted) { fn(); mounted = true; } } },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-router': { usePathname: () => pathname },
    '@/src/source': { refreshEpgOnly: async () => calls.push(['primary', pathname]), refreshSourcesIfDue: async () => calls.push(['due-guide', pathname]) },
    '@/src/nativeEpg': { consumeNativeScheduledEpgRefresh: async () => false, refreshNativeSourceGuide: async () => { calls.push(['custom-import', pathname]); return { count: 1, programmeSwapSucceeded: true }; } },
    '@/src/core/multiEpgSources': { getMultiEpgSources: async () => [custom], updateMultiEpgRefreshStatus: (_id, _url, status) => Object.assign(custom, status) },
    '@/src/utils/guideSurfGate': { isGuideSurfing: () => false },
    '@/src/core/sourceRefreshPreferences': { getSourceRefreshPreferences: async () => ({ epgHours: 6, epgPastDays: 7, updateEpgOnAppStart: false, updateEpgOnPlaylistChange: true }) },
    '@/src/core/customEpgPolicy': { syncNativeCustomEpgPolicy: async () => {} },
    '@/src/core/playlistRegistry': { listPlaylists: async () => rows, readCombinedPlaylists: async () => [],
      refreshPlaylists: async (_id, _due, safe) => { assert.equal(safe(), true); calls.push(['playlist-start', pathname]); await held; return []; } },
    '@/src/core/playlistEpg': { syncPlaylistEpg: async () => calls.push(['bindings', pathname]) },
    '@/src/source.native': { reloadPlaylistCatalog: async () => calls.push(['reload', pathname]) },
  }, { Date: { now: () => now }, setTimeout: fn => { timers.push(fn); return 1; }, setInterval: fn => { timers.push(fn); return 2; }, clearTimeout() {}, clearInterval() {} });
  const render = () => { refAt = 0; api.SourceRefreshScheduler(); };
  render(); now = 10_000_000; timers[0](); await settle();
  pathname = '/player'; render(); release(); await settle();
  assert.deepEqual(calls, [['playlist-start', '/guide']]);
  pathname = '/guide'; render(); timers[1](); await settle();
  assert.ok(calls.some(([what]) => what === 'reload'));
  assert.ok(calls.some(([what]) => what === 'custom-import'));
  assert.ok(calls.every(([, where]) => where !== '/player'));
  const imports = calls.filter(([what]) => what === 'custom-import').length;
  timers[1](); await settle();
  assert.equal(calls.filter(([what]) => what === 'custom-import').length, imports);
});

test('all native import owners take the same per-database lease, including staging and metadata', () => {
  const dir = 'android/app/src/main/java/com/charmiptv/app/';
  assert.match(read(dir + 'EpgDatabase.kt'), /EpgImportCoordinator.acquire\(databaseName\)/);
  assert.match(read(dir + 'EpgDatabase.kt'), /fun replaceBatches\([\s\S]*?acquireImport\(\).use/);
  assert.match(read(dir + 'EpgNativeModule.kt'), /database.acquireImport\(\).use/);
  assert.match(read(dir + 'EpgNativeModule.kt'), /userDatabase.acquireImport\(\).use/);
  assert.match(read(dir + 'CustomEpgNativeModule.kt'), /target.acquireImport\(\).use/);
  assert.match(read(dir + 'BackgroundEpgUpdater.kt'), /acquireImport\(source\).use/);
  const worker = read(dir + 'EpgUpdateScheduler.kt');
  assert.equal((worker.match(/!EpgImportCoordinator.canStartBackground\(\)/g) || []).length, 2);
  assert.match(worker, /finally \{ importLease.close\(\) \}/);
  assert.doesNotMatch(worker, /EPG refresh deferred for active TV interaction/);
});

test('restart and bounded diagnostics do not implement an automatic frozen-clock decoder reset', () => {
  const manager = read('android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt');
  const restart = manager.slice(manager.indexOf('fun restartChannel('), manager.indexOf('private fun captureHealth('));
  assert.match(restart, /owner != Owner.FULLSCREEN/);
  assert.match(restart, /source.channelKey != expectedChannelKey/);
  assert.match(restart, /pendingRecovery != null \|\| pendingSourceRefresh != null/);
  assert.ok(restart.indexOf('stopInternal(releasePlayer = true)') < restart.indexOf('prepare(Owner.FULLSCREEN'));
  const capture = manager.slice(manager.indexOf('private fun captureHealth('), manager.indexOf('private val startupTimeout'));
  assert.doesNotMatch(capture, /source\.uri|source\.headers|channelKey|scheduleRecovery\(|stopInternal\(|prepare\(/);
  assert.match(capture, /videoQuietMs/);
  assert.match(capture, /epgImports/);
  assert.match(manager, /removeCallbacks\(healthSampler\)/);
  assert.match(read('app/(tabs)/settings.tsx'), /playbackHistory/);
  assert.match(read('app/player.tsx'), /testID="restart-current-channel"/);
});
