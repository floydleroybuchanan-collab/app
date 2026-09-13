import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGroupChannels } from '../src/core/groupVisibility.ts';
import { scopePlaylistChannels } from '../src/core/playlistCatalog.ts';
test('disabled groups exclude channels across views, remain playlist scoped, and restore without deletion',()=>{
 const source=id=>({id,name:id,enabled:true});
 const channel=id=>({id,name:id,group:'Sports',url:'https://example.invalid/live'});
 const a=scopePlaylistChannels(source('charm-primary'),[channel('same')]);
 const b=scopePlaylistChannels(source('user-second'),[channel('same')]);
 const catalog=[...a,...b];
 const savedFavorites=new Set(catalog.map(c=>c.id));
 const hidden=new Set(['@playlist-group:'+encodeURIComponent(b[0].group)]);
 assert.deepEqual(activeGroupChannels(catalog,hidden).map(c=>c.id),[a[0].id]);
 assert.equal(activeGroupChannels(catalog,hidden).filter(c=>savedFavorites.has(c.id)).length,1);
 assert.equal(catalog.length,2);assert.equal(savedFavorites.size,2);
 assert.deepEqual(activeGroupChannels(catalog,new Set()),catalog);
 const refreshed=scopePlaylistChannels(source('user-second'),[channel('same'),{...channel('new'),group:'News'}]);
 assert.deepEqual(activeGroupChannels([...a,...refreshed],hidden).map(c=>c.name),['same','new']);
});
test('legacy hidden raw groups and a provider group named All are supported',()=>{
 const rows=[{id:'a',group:'All'},{id:'b',group:'News'}];
 assert.deepEqual(activeGroupChannels(rows,new Set(['@playlist-group:All'])).map(c=>c.id),['b']);
 assert.deepEqual(activeGroupChannels(rows,new Set(['News'])).map(c=>c.id),['a']);
});
