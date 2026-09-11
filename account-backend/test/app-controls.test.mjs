import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {recordServiceError} from '../app-controls.js';
import {intent} from '../bot-telegram.js';
const value={multiview_max:4,provider_limits:{primary:2,secondary:1,tertiary:0,quaternary:0},update:{version_code:15,message:'A tested update is available.',url:'https://example.test/releases'}};
test('owner-only settings preserve account session allowance and old content fields',async()=>{
 const f=fixture(),staff=await f.staff();
 assert.equal((await f.request('/admin/app-settings',{token:staff.token})).status,403);
 assert.equal((await f.request('/admin/app-settings',{method:'PUT',token:staff.token,body:{...value,revision:0}})).status,403);
 assert.equal((await f.request('/admin/app-settings',{method:'PUT',token:f.ownerToken,body:{...value,revision:0}})).status,200);
 f.user('viewer');const token=f.token('viewer');
 const content=await f.request('/content/access',{token});
 assert.equal(content.status,200);assert.equal(content.body.content.app_policy.multiview_max,4);
 assert.equal(content.body.content.primary.playlist_url,f.env.M3U_URL);
 assert.equal(content.body.content.sources.length,2);
 assert.equal((await f.request('/me',{token})).body.user.max_sessions,2);
 f.db.close();
});
test('invalid limits, unsafe links and stale saves cannot overwrite controls',async()=>{
 const f=fixture(),put=body=>f.request('/admin/app-settings',{method:'PUT',token:f.ownerToken,body});
 assert.equal((await put({...value,revision:0,multiview_max:5})).status,400);
 assert.equal((await put({...value,revision:0,provider_limits:{...value.provider_limits,primary:-1}})).status,400);
 assert.equal((await put({...value,revision:0,update:{...value.update,url:'javascript:alert(1)'}})).status,400);
 assert.equal((await put({...value,revision:0,update:{...value.update,url:'https://name:secret@example.test/'}})).status,400);
 assert.equal((await put({...value,revision:0})).status,200);
 assert.equal((await put({...value,revision:0,multiview_max:0})).status,409);
 assert.equal((await put({...value,revision:1,multiview_max:0})).status,200);
 f.db.close();
});
test('service monitoring counts failures without storing requests or identities',async()=>{
 const f=fixture();await recordServiceError(f.env);await recordServiceError(f.env);
 const result=await f.request('/admin/app-settings',{token:f.ownerToken});
 assert.equal(result.body.errors[0].count,2);
 assert.deepEqual(Object.keys(result.body.errors[0]).sort(),['count','day','last_at']);f.db.close();
});
test('new playback help recognizes each feature without confusing account login',()=>{
 for(const text of ['Mr. Charm Sources','Mr. Charm Real-Debrid','Mr. Charm Xtream login','Mr. Charm multiview'])assert.equal(intent(text),'app_help');
 assert.equal(intent('Mr. Charm login'),'account');
});
