import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER} from './fixture.mjs';
import {accountUpdateReport,formatAccountUpdateReport,releaseName} from '../account-update-report.js';
import {handleUpdate} from '../bot-telegram.js';
import {exactCommand} from '../bot-commands.js';
const auth={isOwner:true,user:{id:OWNER},profile:{}};
test('report distinguishes current, old, mixed and unknown with verified links',async()=>{
 const f=fixture();for(const name of ['updated','older','unknown'])f.user(name);
 for(const [name,build] of [['updated',28],['updated',26],['older',26]])await f.request('/me/activity',{method:'POST',token:f.token(name),body:{sequence:1,mode:'idle',playing:false,build}});
 f.db.prepare("INSERT INTO bot_members(telegram_id,account_id,username,name,updated_at) VALUES('123','updated','linkedperson','Test',unixepoch())").run();
 const r=await accountUpdateReport(f.env,auth),u=r.users.find(x=>x.username==='updated');
 assert.equal(u.classification,'MIXED');assert.equal(u.linked,true);assert.equal(u.updated,true);
 assert.equal(r.users.find(x=>x.username==='older').classification,'OLDER ONLY');
 assert.equal(r.users.find(x=>x.username==='unknown').classification,'UNKNOWN');
 assert.match(formatAccountUpdateReport(r),/Release observed AND linked: 1/);
 assert.match(formatAccountUpdateReport(r),/RC9 users are up to date/);
 assert.match(formatAccountUpdateReport(r),/197 \[TEST BUILD\]/);
 assert.match(formatAccountUpdateReport(r),/-{65}\r\n\r\n\r\n/);
 await assert.rejects(accountUpdateReport(f.env,{isOwner:false,profile:{}}),/permission/);
 const scoped=await accountUpdateReport(f.env,{isOwner:false,user:{id:'none'},profile:{can_manage_bot:1}});assert.equal(scoped.users.length,0);
});
test('report command is private admin-only multipart text download with expiry',async()=>{
 const f=fixture(),calls=[];let admin=true;
 const s={enabled:true,group_id:'-100123456789',bot_username:'TestBot',accounts_enabled:true};
 f.env.TELEGRAM_BOT_TOKEN='fake';f.env.TELEGRAM_FETCH=async(url,o)=>{const method=url.split('/').pop();calls.push({method,body:o.body});return Response.json({ok:true,result:method==='getChatMember'?{status:admin?'creator':'member',user:{id:12345}}:{message_id:321}});};
 f.db.prepare("INSERT INTO bot_members(telegram_id,account_id,name,updated_at) VALUES('12345',?,'Owner',unixepoch())").run(OWNER);
 const message={from:{id:12345,first_name:'Owner'},chat:{id:12345,type:'private'},text:'Mr Charm Update Report'};
 await handleUpdate(f.env,{message},s);
 const file=calls.find(c=>c.method==='sendDocument');assert.ok(file.body instanceof FormData);assert.equal(file.body.get('chat_id'),'12345');assert.match(await file.body.get('document').text(),/PRIVATE ADMIN/);
 assert.ok(f.db.prepare('SELECT * FROM bot_responses WHERE message_id=321').get());
 calls.length=0;admin=false;await handleUpdate(f.env,{message},s);assert.ok(!calls.some(c=>c.method==='sendDocument'));
 calls.length=0;admin=true;await handleUpdate(f.env,{message:{...message,chat:{id:-100123456789,type:'supergroup'}}},s);assert.ok(!calls.some(c=>c.method==='sendDocument'));
 assert.equal(exactCommand('Mr Charm Account Linking'),'linking:user');assert.equal(exactCommand('Mr Charm Admin Account Linking'),'linking:admin');
});

test('older release mapping shows verified APK names',()=>{assert.match(releaseName(26),/RC8-Sideload-195/);assert.match(releaseName(24),/RC6-Sideload-190/);assert.match(releaseName(27),/CURRENT PUBLIC RELEASE/);assert.match(releaseName(28),/TEST BUILD/);assert.match(releaseName(29),/RC11-Sideload-198/);assert.match(releaseName(99),/not mapped/);});
