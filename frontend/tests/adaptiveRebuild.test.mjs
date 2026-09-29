import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { START_DESTINATIONS, startupTarget } from '../src/core/startDestinations.ts';

function adaptive(mode, width) {
  const exports = {};
  const mocks = {
    react: { useMemo: run => run() },
    'react-native': { useWindowDimensions: () => ({ width }) },
    '@/src/store': { useStore: () => ({ deviceLayoutMode: mode }) },
    './tvLayout': { shouldUseTvLayout: mode => mode === 'tv' },
  };
  const source = readFileSync(new URL('../src/utils/useAdaptiveStyles.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => mocks[name] });
  return exports.useAdaptiveStyles;
}

test('TV retains exact base style identity while phone and tablet controls fit', () => {
  const base = { text: { fontSize: 9, lineHeight: 12 }, actionButton: { height: 28, width: 600, minWidth: 500 }, row: { flexDirection: 'row' } };
  assert.equal(adaptive('tv', 960)(base), base);
  for (const width of [320, 412, 800]) {
    const styles = adaptive('mobile', width)(base);
    assert.equal(styles.text.fontSize, 14);
    assert.ok(styles.text.lineHeight >= 18);
    assert.ok(styles.actionButton.minHeight >= 48);
    assert.ok(styles.actionButton.width <= width - 32);
    assert.ok(styles.actionButton.minWidth <= width - 32);
    assert.equal(styles.row.flexWrap, 'wrap');
  }
  assert.equal(base.actionButton.height, 28);
});

test('every native VOD boot destination falls back safely when unavailable', () => {
  for (const item of START_DESTINATIONS.filter(item => item.route.startsWith('/vod'))) {
    assert.deepEqual(startupTarget(item.value, { nativeVod: false, multiviewAllowed: false, channelIds: [] }), { route: '/' });
  }
  assert.equal(startupTarget('movies', { nativeVod: true, multiviewAllowed: false, channelIds: [] }).route, '/vod?section=movies');
  assert.equal(startupTarget('movie_channels', { nativeVod: true, multiviewAllowed: false, channelIds: [] }).route, '/movies');
});
