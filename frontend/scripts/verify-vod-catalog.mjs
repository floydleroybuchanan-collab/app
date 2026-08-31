import { pathToFileURL } from 'node:url';

// A compilable APK is not evidence of a usable catalog. Check the same v3
// credentials used by the preserved TMDb client before producing a release.
export async function verifyVodCatalog({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('TMDB_API_KEY is missing. Refusing to build a VOD APK with an empty catalog.');
  }
  async function catalog(path, params, label) {
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    url.searchParams.set('api_key', apiKey.trim());
    url.searchParams.set('language', 'en');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    } catch {
      // Fetch exceptions can include the credential-bearing request URL.
      throw new Error(`${label}: request failed or timed out. Credential details withheld.`);
    }
    if (!response.ok) throw new Error(`${label}: TMDb returned HTTP ${response.status}.`);
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`${label}: TMDb returned invalid JSON.`); }
    if (!Array.isArray(body.results) || !body.results.length) {
      throw new Error(`${label}: no catalog results returned.`);
    }
    return body.results;
  }
  const movies = await catalog('movie/popular', { page: '1' }, 'Movies');
  const shows = await catalog('tv/popular', { page: '1' }, 'Series');
  const candidate = movies.find(movie => typeof movie.title === 'string' &&
    typeof movie.poster_path === 'string' && /^\/[a-zA-Z0-9._-]+$/.test(movie.poster_path));
  if (!candidate) throw new Error('Movies: no usable title and poster returned.');
  await catalog('search/multi', { query: candidate.title, page: '1' }, 'Search');
  await catalog('discover/tv', { with_networks: '213', page: '1' }, 'Netflix catalog row');
  let poster;
  try {
    poster = await fetchImpl(`https://image.tmdb.org/t/p/w342${candidate.poster_path}`, {
      method: 'HEAD', signal: AbortSignal.timeout(20000), redirect: 'error',
    });
  } catch { throw new Error('Poster image host could not be reached.'); }
  if (!poster.ok || !poster.headers.get('content-type')?.startsWith('image/')) {
    throw new Error('Poster image request failed or did not return an image.');
  }
  return { movies: movies.length, series: shows.length, search: true, netflixRow: true, poster: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyVodCatalog({ apiKey: process.env.TMDB_API_KEY });
    console.log(`VOD catalog preflight passed: ${JSON.stringify(result)}. Playback still requires device testing.`);
  } catch (error) {
    console.error(`VOD catalog preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
