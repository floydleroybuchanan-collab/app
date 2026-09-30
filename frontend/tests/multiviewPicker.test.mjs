import test from 'node:test';
import assert from 'node:assert/strict';
import {multiviewPickerGeometry, pickerFocusOffset, multiviewPickerOptions, filterMultiviewChannels, PICKER_PAGE_SIZE} from '../src/core/multiviewPicker.ts';

test('TV picker reserves list and footer without overlap across small TVs and enlarged text',()=>{
 for(const [width,height] of [[640,360],[960,540],[1280,720],[1920,1080]]) for(const scale of [1,1.15,1.3,2]) {
  const safe={left:12,right:12,top:8,bottom:8};
  const g=multiviewPickerGeometry(width,height,scale,safe);
  assert.ok(g.panelWidth+safe.left+safe.right+2*g.margin<=width);
  assert.ok(g.panelHeight+safe.top+safe.bottom+2*g.margin<=height);
  assert.ok(g.listHeight>=g.rowHeight,`A full channel row must fit at ${width}x${height}/${scale}`);
  assert.ok(g.headerHeight+g.listHeight+g.footerHeight+12+2*g.padding+2<=g.panelHeight);
  for(let i=0;i<PICKER_PAGE_SIZE;i++){
   const y=pickerFocusOffset(i,g.columns,g.rowHeight,g.listHeight,PICKER_PAGE_SIZE);
   const rowTop=Math.floor(i/g.columns)*g.rowHeight-y;
   assert.ok(rowTop>=-0.01 && rowTop+g.rowHeight<=g.listHeight+0.01,`Focused row ${i} must stay visible`);
  }
 }
});
const channels=[
 {id:'a',name:'APTN',url:'https://example.invalid/a',playlist_id:'one',playlist_name:'Playlist One',source_group:'Canada'},
 {id:'b',name:'Sports',url:'https://example.invalid/b',playlist_id:'two',playlist_name:'Playlist Two',source_group:'Canada'},
 {id:'c',name:'News',url:'https://example.invalid/c',playlist_id:'one',playlist_name:'Playlist One',source_group:'News'},
 {id:'d',name:'Unavailable',url:'',playlist_id:'one',source_group:'Missing'},
];
test('Design 1 scopes groups by playlist, excludes unplayable entries and deduplicates IDs',()=>{
 const model=multiviewPickerOptions([...channels,channels[0]],'one');
 assert.equal(model.playable.length,3);
 assert.deepEqual(model.sources.map(p=>[p.id,p.count]),[[null,3],['one',2],['two',1]]);
 assert.deepEqual(model.groups.map(g=>[g.id,g.count]),[[null,2],['Canada',1],['News',1]]);
 assert.deepEqual(multiviewPickerOptions(channels,'two').groups.map(g=>g.id),[null,'Canada']);
});
test('channel search, playlist, group, favorites and recent filters compose correctly',()=>{
 const defaults={source:null,group:null,query:'',filter:'All',favorites:['a','c'],recent:[{id:'c'},{id:'a'}]};
 const run=extra=>filterMultiviewChannels(channels,{...defaults,...extra}).map(c=>c.id);
 assert.deepEqual(run({}),['a','b','c']);
 assert.deepEqual(run({source:'one',group:'Canada'}),['a']);
 assert.deepEqual(run({source:'two',filter:'Favorites'}),[]);
 assert.deepEqual(run({filter:'Favorites',query:'NEWS'}),['c']);
 assert.deepEqual(run({filter:'Recent'}),['c','a']);
 assert.deepEqual(run({query:'playlist two'}),['b']);
 assert.deepEqual(run({query:'does-not-exist'}),[]);
});
test('6478 channels remain bounded into complete pages including the final partial page',()=>{
 const all=Array.from({length:6478},(_,i)=>({...channels[0],id:String(i)}));
 const model=multiviewPickerOptions(all,null);
 assert.equal(model.playable.length,6478);
 assert.equal(Math.ceil(model.playable.length/PICKER_PAGE_SIZE),162);
 assert.equal(model.playable.slice(161*PICKER_PAGE_SIZE).length,38);
});
