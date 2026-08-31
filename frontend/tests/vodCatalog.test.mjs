import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyVodCatalog } from '../scripts/verify-vod-catalog.mjs';

test('an unconfigured VOD release fails before any request', async () => {
  for (const apiKey of [undefined, '', '   ']) {
    await assert.rejects(verifyVodCatalog({ apiKey, fetchImpl: () => assert.fail('unexpected request') }), /TMDB_API_KEY is missing/);
  }
});

test('credential-bearing network errors and authentication failures are safe to log', async () => {
  await assert.rejects(verifyVodCatalog({ apiKey: 'test-only-secret', fetchImpl: async url => { throw Error(String(url)); } }),
    error => !error.message.includes('test-only-secret') && error.message.includes('request failed'));
  await assert.rejects(verifyVodCatalog({ apiKey: 'test-only-secret', fetchImpl: async () => new Response('', { status: 401 }) }), /HTTP 401/);
});

test('release preflight exercises search and catalog rows and rejects broken posters', async () => {
  const paths = [];
  let badPoster = false;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    paths.push(url.pathname);
    if (url.hostname === 'image.tmdb.org') {
      assert.equal(url.searchParams.has('api_key'), false);
      assert.equal(options.method, 'HEAD');
      return new Response(null, { headers: { 'content-type': badPoster ? 'text/html' : 'image/jpeg' } });
    }
    assert.equal(url.searchParams.get('api_key'), 'test-only-secret');
    return Response.json({ results: [{ id: 1, title: 'Test movie', poster_path: '/test.jpg' }] });
  };
  assert.equal((await verifyVodCatalog({ apiKey: 'test-only-secret', fetchImpl })).poster, true);
  assert.ok(paths.includes('/3/search/multi'));
  assert.ok(paths.includes('/3/discover/tv'));
  badPoster = true;
  await assert.rejects(verifyVodCatalog({ apiKey: 'test-only-secret', fetchImpl }), /Poster image request failed/);
});
