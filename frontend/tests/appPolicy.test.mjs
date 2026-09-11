import test from 'node:test';
import assert from 'node:assert/strict';
import {configureAppPolicy,getAppPolicy} from '../src/core/appPolicy.ts';
import {supportReport} from '../src/core/supportReport.ts';
test('old servers remain compatible, admin limits clamp, and logout clears notices',()=>{
 configureAppPolicy();assert.equal(getAppPolicy().multiview_max,4);
 configureAppPolicy({multiview_max:2,provider_limits:{primary:1},update:{version_code:15,message:'Update',url:'https://example.test/releases'}});
 assert.equal(getAppPolicy().multiview_max,2);assert.equal(getAppPolicy().provider_limits['charm-primary'],1);
 configureAppPolicy({multiview_max:99});assert.equal(getAppPolicy().multiview_max,4);
 configureAppPolicy({multiview_max:'4'});assert.equal(getAppPolicy().multiview_max,0);
 configureAppPolicy();assert.equal(getAppPolicy().update.version_code,0);
});
test('update notices reject executable and credential-bearing links',()=>{
 for(const url of ['javascript:alert(1)','http://example.test/','https://user:secret@example.test/']) {
  configureAppPolicy({multiview_max:4,update:{version_code:15,message:'Update',url}});assert.equal(getAppPolicy().update.url,'');
 }
});
test('support report allows numeric measurements only and bounds malformed or oversized input',()=>{
 const raw=JSON.stringify([{errorCode:4001,width:1920,uri:'https://example.test/secret',token:'private',event:'secret',channel:'private',height:'password'}]);
 const report=supportReport('2.1.0-rc.7',14,raw);
 assert.equal(JSON.parse(report).playback[0].errorCode,4001);
 for(const secret of ['example.test','secret','private','password'])assert.ok(!report.includes(secret));
 assert.deepEqual(JSON.parse(supportReport('v',14,'{')).playback,[]);
 assert.deepEqual(JSON.parse(supportReport('v',14,'x'.repeat(200001))).playback,[]);
 assert.equal(JSON.parse(supportReport('v',14,JSON.stringify(Array(100).fill({width:1})))).playback.length,20);
});
