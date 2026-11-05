import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideDirectoryOwner, guideEpgSearchTerm } from '../src/core/guideEpgDirectory.ts';

test('channel suggestions remove format suffixes without replacing the channel identity', () => {
  assert.equal(guideEpgSearchTerm('  World News FHD  '), 'World News');
  assert.equal(guideEpgSearchTerm('HDNet Movies'), 'HDNet Movies');
});

test('switching channel or source suppresses both stale directory results and stale errors', async () => {
  const owner = createGuideDirectoryOwner();
  let finishFirst, rejectOld; const pages = [], failures = [];
  const first = owner.load(() => new Promise(resolve => { finishFirst = resolve; }), page => pages.push(page), () => failures.push('first'));
  owner.invalidate();
  const oldError = owner.load(() => new Promise((_, reject) => { rejectOld = reject; }), page => pages.push(page), () => failures.push('old'));
  await owner.load(async () => ({ total: 1, rows: [{ id: 'b', name: 'Current source/channel' }] }), page => pages.push(page), () => failures.push('current'));
  finishFirst({ total: 1, rows: [{ id: 'a', name: 'Wrong old source' }] }); rejectOld(new Error('Old failed query'));
  await Promise.all([first, oldError]);
  assert.deepEqual(pages, [{ total: 1, rows: [{ id: 'b', name: 'Current source/channel' }] }]);
  assert.deepEqual(failures, []);
});

test('closing the pane invalidates a running request before another query is started', async () => {
  const owner = createGuideDirectoryOwner(); let finish; let applied = false;
  const pending = owner.load(() => new Promise(resolve => { finish = resolve; }), () => { applied = true; }, () => assert.fail('unexpected error'));
  owner.invalidate(); finish({ total: 0, rows: [] }); await pending;
  assert.equal(applied, false);
});
