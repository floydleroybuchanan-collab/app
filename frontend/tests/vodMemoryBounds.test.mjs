import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const source=path=>readFileSync(new URL('../android/vod/app/src/main/java/com/streamflixreborn/streamflix/'+path,import.meta.url),'utf8');
const query=(file,method)=>new RegExp('@Query\\("([^"\\n]+)"\\)\\s+suspend fun '+method).exec(source('database/dao/'+file))[1];
test('bounded shelves return exactly the existing preview without modifying the full saved library',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  for(const table of ['movies','tv_shows','episodes']) {
   db.exec(`CREATE TABLE ${table}(id TEXT,lastEngagementTimeUtcMillis INTEGER,favoritedAtMillis INTEGER,isFavorite INTEGER)`);
   const insert=db.prepare(`INSERT INTO ${table} VALUES(?,?,?,1)`);
   for(let i=0;i<120;i++)insert.run(table+i,i*3+(table==='episodes'?1:0),i);
  }
  const before=db.prepare('SELECT * FROM movies ORDER BY lastEngagementTimeUtcMillis DESC').all().concat(db.prepare('SELECT * FROM episodes ORDER BY lastEngagementTimeUtcMillis DESC').all()).sort((a,b)=>b.lastEngagementTimeUtcMillis-a.lastEngagementTimeUtcMillis).slice(0,30).map(x=>x.id);
  const bounded=db.prepare(query('MovieDao.kt','getWatchingShelf')).all({limit:30}).concat(db.prepare(query('EpisodeDao.kt','getWatchingShelf')).all({limit:30})).sort((a,b)=>b.lastEngagementTimeUtcMillis-a.lastEngagementTimeUtcMillis).slice(0,30).map(x=>x.id);
  assert.deepEqual(bounded,before);
  for(const [file,table] of [['MovieDao.kt','movies'],['TvShowDao.kt','tv_shows']]) {
   const rows=db.prepare(query(file,'getFavoriteShelf')).all({limit:30});
   assert.equal(rows.length,30);
   assert.deepEqual(rows.map(x=>x.id),db.prepare(`SELECT * FROM ${table} WHERE isFavorite=1 ORDER BY favoritedAtMillis DESC`).all().slice(0,30).map(x=>x.id));
   assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,120);
  }
 }finally{db.close();}
});
test('global provider search shares four permits across query replacements without truncating providers',()=>{
 const s=source('fragments/search/SearchViewModel.kt');
 assert.match(s,/private val globalSearchSlots = Semaphore\(4\)/);
 assert.match(s,/globalSearchSlots.withPermit \{ withContext\(Dispatchers.IO\)/);
 assert.match(s,/targets.forEachIndexed/);
 assert.doesNotMatch(s,/targets.take\(/);
 assert.match(s,/catch \(e: CancellationException\) \{\s*throw e/);
});
test('home snapshots and cache clearing remain bounded and separate from user data and open journals',()=>{
 const cache=source('utils/HomeCacheStore.kt'),clear=source('utils/CacheUtils.kt');
 assert.match(cache,/MAX_MEMORY_PROVIDERS = 2/);
 assert.match(cache,/size > MAX_MEMORY_PROVIDERS/);
 assert.match(cache,/file.length\(\) > MAX_SNAPSHOT_BYTES/);
 assert.match(cache,/categories.sumOf \{ it.list.size \} > MAX_CACHE_ITEMS/);
 assert.match(cache,/atomic.finishWrite\(stream\)/);
 assert.match(cache,/index >= MAX_DISK_FILES \|\| total > MAX_DISK_BYTES/);
 assert.doesNotMatch(clear,/deleteRecursively/);
 assert.match(clear,/if \(isolated\) Glide.get\(app\).clearDiskCache\(\)/);
 assert.match(clear,/clearing.compareAndSet\(false, true\)/);
});

test('embedded provider choice returns through shared routing and trim hooks clear RAM only',()=>{
 const chooser=source('adapters/viewholders/ProviderViewHolder.kt');
 assert.equal((chooser.match(/CharmHostSession.hasSurface\(this\)/g)||[]).length,2);
 assert.equal((chooser.match(/medialab:provider-changed/g)||[]).length,2);
 const user=source('utils/UserDataCache.kt');
 assert.match(user,/removeEldestEntry[^\n]+size > 2/);
 assert.match(user,/fun clearMemory\(\) \{ memoryCache.clear\(\) \}/);
 const app=readFileSync(new URL('../android/app/src/main/java/com/charmiptv/app/MainApplication.kt',import.meta.url),'utf8');
 assert.match(app,/HomeCacheStore.clearMemory\(\)/);
 assert.match(app,/UserDataCache.clearMemory\(\)/);
});


test('provider changes preserve retained source-owned databases and backstack actions',()=>{
 const db=source('database/AppDatabase.kt'), prefs=source('utils/UserPreferences.kt');
 assert.match(db,/instances.get\(providerName\) \{ buildDatabase\(providerName, context\) \}/);
 assert.match(db,/setAutoCloseTimeout\(15, TimeUnit.SECONDS\)/);
 assert.doesNotMatch(prefs,/AppDatabase.resetInstance\(/);
 const identity=source('utils/CatalogSource.kt');
 assert.match(identity,/currentBackStackEntry\?\.savedStateHandle/);
 assert.match(identity,/provider\(saved\)\?\.let \{ UserPreferences.currentProvider = it \}/);
 for(const file of ['home/HomeViewModel.kt','search/SearchViewModel.kt','movies/MoviesViewModel.kt','tv_shows/TvShowsViewModel.kt','genre/GenreViewModel.kt','movie/MovieViewModel.kt','tv_show/TvShowViewModel.kt','people/PeopleViewModel.kt','season/SeasonViewModel.kt']) {
  assert.match(source('fragments/'+file),/CatalogSource.provider\(database.providerName\)/);
  assert.doesNotMatch(source('fragments/'+file),/UserPreferences.currentProvider!!\.get/);
 }
 assert.match(source('fragments/home/HomeViewModel.kt'),/getSharedInstanceForProvider\(provider.name, appContext\)/);
 assert.match(source('charm/CharmHostSession.kt'),/CatalogSource.install\(nav\)/);
 assert.match(readFileSync(new URL('../android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt',import.meta.url),'utf8'),/CatalogSource.install\(fragment.navController\)/);
});

test('broadcast refresh has one Home job owner instead of competing fragment collectors',()=>{
 const notifier=source('utils/ProviderChangeNotifier.kt');
 assert.match(notifier,/MutableSharedFlow<Unit>/);
 assert.doesNotMatch(notifier,/receiveAsFlow|Channel.CONFLATED/);
 for(const file of ['HomeTvFragment.kt','HomeMobileFragment.kt'])
  assert.doesNotMatch(source('fragments/home/'+file),/providerChangeFlow/);
});
