import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {validateWebsite,nextWebsitePost,queueWebsitePost,websiteConfig} from '../website-announcements.js';
const defaults={url:'https://charming-medialab.wasmer.app/',message:'Visit our website.',enabled:true,timezone:'America/New_York',time:'18:00',repeat:'daily',weekday:5};
test('website settings reject unsafe destinations and invalid schedule values',()=>{
 for(const value of [{url:'javascript:alert(1)'},{url:'https://user:secret@example.com'},{timezone:'wrong/zone'},{time:'26:10'},{enabled:'true'},{message:''}])assert.throws(()=>validateWebsite({...defaults,...value}));
 assert.equal(nextWebsitePost({...defaults,enabled:false},0),null);
});
test('calendar schedule follows New York daylight saving changes',()=>{
 const before=Date.parse('2026-03-07T23:01:00Z')/1000;
 assert.equal(new Date(nextWebsitePost(defaults,before)*1000).toISOString(),'2026-03-08T22:00:00.000Z');
 assert.equal(new Date(nextWebsitePost({...defaults,repeat:'weekly',weekday:5},before)*1000).toISOString(),'2026-03-13T22:00:00.000Z');
});
test('cron starts disabled and creates one job for overlapping due checks',async()=>{
 const f=fixture(),s={enabled:true,group_id:'-1001'};
 await queueWebsitePost(f.env,s);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_jobs').get().n,0);
 f.db.prepare('UPDATE website_announcements SET json=?,next_at=?').run(JSON.stringify(defaults),Math.floor(Date.now()/1000)-60);
 await Promise.all([queueWebsitePost(f.env,s),queueWebsitePost(f.env,s)]);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_jobs').get().n,1);
 assert.ok((await websiteConfig(f.env)).next_at>Date.now()/1000);
});
test('only authorized panel administrators can edit and send, with revision checks',async()=>{
 const f=fixture();f.user('viewer');
 assert.equal((await f.request('/admin/bot/website',{token:f.token('viewer')})).status,403);
 const current=(await f.request('/admin/bot/website',{token:f.ownerToken})).body.website;
 const saved=await f.request('/admin/bot/website',{method:'PUT',token:f.ownerToken,body:{...defaults,enabled:false,revision:current.revision}});
 assert.equal(saved.status,200);
 const stale=await f.request('/admin/bot/website',{method:'PUT',token:f.ownerToken,body:{...defaults,enabled:false,revision:current.revision}});
 assert.equal(stale.status,409);
 assert.equal((await f.request('/admin/bot/website/send',{method:'POST',token:f.ownerToken,body:{confirm:false,revision:saved.body.website.revision}})).status,409);
});

test('fall clock change does not repeat a daily announcement',()=>{assert.equal(new Date(nextWebsitePost({...defaults,time:'01:30'},Date.parse('2026-11-01T05:31:00Z')/1000)*1000).toISOString(),'2026-11-02T06:30:00.000Z');});
