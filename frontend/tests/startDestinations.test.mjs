import test from 'node:test';
import assert from 'node:assert/strict';
import { START_DESTINATIONS, resolveStartScreen, startupTarget } from '../src/core/startDestinations.ts';
const available = { nativeVod: true, multiviewAllowed: true, channelIds: ['a', 'b'], lastChannelId: 'b' };
test('every Settings boot choice resolves to its registered route', () => {
  for (const item of START_DESTINATIONS.filter(item => item.value !== 'last_channel')) {
    assert.equal(resolveStartScreen(item.value), item.value);
    assert.deepEqual(startupTarget(item.value, available), { route: item.route });
  }
  assert.equal(new Set(START_DESTINATIONS.map(item => item.value)).size, START_DESTINATIONS.length);
});
test('unavailable and obsolete boot targets fall back to Home', () => {
  for (const value of [null, undefined, '', 'deleted-screen', {}, 8]) assert.deepEqual(startupTarget(value, available), { route: '/' });
  assert.deepEqual(startupTarget('vod', { ...available, nativeVod: false }), { route: '/' });
  assert.deepEqual(startupTarget('multiview', { ...available, multiviewAllowed: false }), { route: '/' });
});
test('last-channel startup never launches a stale channel ID', () => {
  assert.deepEqual(startupTarget('last_channel', available), { route: '/player', channelId: 'b' });
  assert.deepEqual(startupTarget('last_channel', { ...available, channelIds: [] }), { route: '/' });
  assert.deepEqual(startupTarget('last_channel', { ...available, lastChannelId: null }), { route: '/' });
});
