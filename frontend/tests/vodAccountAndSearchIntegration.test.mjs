import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(resolve(root, file), "utf8");
const android = name => read("android/app/src/main/java/com/charmiptv/app/" + name + ".kt");
const vod = name => read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/" + name + ".kt");

test("Xtream/Stalker saved history uses account-specific storage and no longer returns global data", () => {
  const library = read("src/core/providerLibrary.ts");
  const auth = read("src/auth/AuthContext.tsx");
  assert.match(library, /gs_provider_library_v2/);
  assert.match(library, /setProviderLibraryAccount/);
  assert.match(library, /LEGACY_OWNER_KEY/);
  assert.match(library, /if \(!owner\) return Promise\.reject/);
  assert.match(auth, /setProviderLibraryAccount\(result\.data\.user\.id\)/);
  assert.match(auth, /setProviderLibraryAccount\(null\)/);
});

test("Streamflix native Room filenames and provider lookups are isolated by account", () => {
  const database = vod("database/AppDatabase");
  const scope = vod("charm/CharmVodAccountScope");
  const provider = vod("charm/CharmLibraryProvider");
  assert.match(database, /databaseNameFor\(providerName\)/);
  assert.match(database, /CharmVodAccountScope\.databaseFileName/);
  assert.match(scope, /legacy_owner_hash/);
  assert.match(scope, /acct_/);
  assert.match(provider, /@Synchronized override fun call/);
  assert.match(provider, /activateVerifiedPrefix/);
});

test("VOD history is updated on actual playback start after Room writes", () => {
  const player = vod("fragments/player/PlayerTvFragment");
  const host = vod("charm/CharmHostSession");
  assert.match(player, /onIsPlayingChanged\(isPlaying: Boolean\)/);
  assert.match(player, /recordRecentlyWatchedStart\(\)/);
  assert.match(player, /CharmHostSession\.libraryUpdated\(requireActivity\(\)\)/);
  assert.match(host, /medialab:library-updated/);
});

test("all-source search is explicit and limited by provider batches and cache size", () => {
  const search = read("src/core/vodUnifiedSearch.ts");
  const home = read("src/components/UnifiedVodOverview.tsx");
  assert.match(search, /VOD_SEARCH_SOURCES_PER_BATCH = 2/);
  assert.match(search, /VOD_SEARCH_RESULTS_TOTAL = 160/);
  assert.match(search, /CACHE_TTL_MS/);
  assert.match(home, /searchStreamflixTitles/);
  assert.match(home, /searchOneVodSource/);
  assert.match(home, /Search more providers/);
  assert.doesNotMatch(home, /loadXtreamCatalog\(/);
});

test("native playlist scheduler never stores secure playlist URLs or passwords", () => {
  const worker = android("PlaylistDueWorker");
  const module = android("PlaylistScheduleModule");
  const schedule = read("src/components/SourceRefreshScheduler.tsx");
  assert.match(worker, /dueAt/);
  assert.match(worker, /account/);
  assert.doesNotMatch(worker + module, /getPlaylistUrl\(|password\s*=/);
  assert.match(module, /cancelUniqueWork/);
  assert.match(schedule, /consumeDue/);
  assert.match(schedule, /refreshPlaylists/);
});
