import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER,PASSWORD} from './fixture.mjs';
import {member,q} from '../bot-store.js';
import {handleUpdate} from '../bot-telegram.js';
import {supportContacts} from '../telegram-contacts.js';
const config={enabled:true,group_id:'-100123456789',accounts_enabled:true,auto_tokens:false};
const admins=Array.from({length:5},(_,i)=>({status:'administrator',user:{id:10001+i,is_bot:false,first_name:'Admin '+(i+1),...(i<2?{username:'Public'+i}:{})}}));
async function setup(){
 const f=fixture(),sent=[];f.env.TELEGRAM_BOT_TOKEN='fake';
 for(const a of admins)await q(f.env,'INSERT INTO bot_support_admins(telegram_id,name,username,enabled) VALUES(?1,?2,?3,1)',String(a.user.id),a.user.first_name,a.user.username||'').run();
 f.env.TELEGRAM_FETCH=async(url,opt)=>{const method=url.split('/').pop(),body=JSON.parse(opt.body);sent.push({method,body});return Response.json({ok:true,result:method==='getChatAdministrators'?admins:{message_id:123}});};
 return {...f,sent};
}
const callback=data=>({callback_query:{id:'test-cb',from:{id:90001,first_name:'Viewer'},data,message:{chat:{id:90001,type:'private'}}}});
test('all five enabled admins get buttons when only two have public usernames; hidden callback rechecks selection',async()=>{
 const f=await setup();await handleUpdate(f.env,callback('contact'),config);
 const body=f.sent.at(-1).body;assert.match(body.text,/Support Admins \(5\)/);
 const buttons=body.reply_markup.inline_keyboard.flat();assert.equal(buttons.length,6);assert.equal(buttons.filter(b=>b.url).length,2);assert.equal(buttons.filter(b=>b.callback_data?.startsWith('contact-admin:')).length,3);
 await handleUpdate(f.env,callback('contact-admin:10003'),config);assert.match(f.sent.at(-1).body.text,/Admin 3/);assert.match(f.sent.at(-1).body.text,/No public Telegram username/);
 await q(f.env,'UPDATE bot_support_admins SET enabled=0 WHERE telegram_id=?1','10003').run();
 await handleUpdate(f.env,callback('contact-admin:10003'),config);assert.match(f.sent.at(-1).body.text,/no longer available/);
 assert.equal((await supportContacts(f.env,[...admins,{user:{id:22222,is_bot:true,first_name:'Bot'}}])).length,4);
});
test('support alias survives sync and current Telegram username takes priority',async()=>{
 const f=await setup();await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify(config)).run();
 assert.equal((await f.request('/admin/bot/support-admins/10003',{method:'PATCH',token:f.ownerToken,body:{enabled:true,contact_username:' @ChosenContact '}})).status,200);
 assert.equal((await f.request('/admin/bot/support-admins/sync',{method:'POST',token:f.ownerToken,body:{}})).status,200);
 assert.equal((await supportContacts(f.env,admins))[2].username,'ChosenContact');
 assert.equal((await supportContacts(f.env,[{...admins[2],user:{...admins[2].user,username:'NewOfficial'}}]))[0].username,'NewOfficial');
 assert.equal((await f.request('/admin/bot/support-admins/10003',{method:'PATCH',token:f.ownerToken,body:{enabled:true,contact_username:'person@example.com'}})).status,400);
});
test('contact usernames and IDs identify directory records without granting token/account access',async()=>{
 const f=await setup();f.user('different_app_login');await member(f.env,{id:10003,first_name:'Telegram Person',username:'DifferentTelegramName'},'member');
 const path='/admin/users/different_app_login/telegram';
 let r=await f.request(path,{method:'PUT',token:f.ownerToken,body:{username:'@DifferentTelegramName',telegram_id:'10003'}});assert.equal(r.status,200);
 assert.equal(r.body.contact.username,'DifferentTelegramName');assert.equal(r.body.matches[0].telegram_id,'10003');
 const recorded=f.db.prepare('SELECT * FROM bot_members WHERE telegram_id=?').get('10003');assert.equal(recorded.account_id,null);assert.equal(recorded.invite_id,null);
 r=await f.request('/admin/users?search=DifferentTelegramName',{token:f.ownerToken});assert.equal(r.body.users[0].username,'different_app_login');
 r=await f.request('/admin/bot/members?search=DifferentTelegramName',{token:f.ownerToken});assert.equal(r.body.members[0].directory_accounts,'different_app_login');
 await member(f.env,{id:10003,first_name:'Telegram Person',username:'Renamed'},'member');r=await f.request(path,{token:f.ownerToken});assert.equal(r.body.matches[0].username,'Renamed');
 f.user('duplicate');assert.equal((await f.request('/admin/users/duplicate/telegram',{method:'PUT',token:f.ownerToken,body:{username:'differenttelegramname',telegram_id:null}})).status,409);
 assert.equal((await f.request(path,{method:'PUT',token:f.ownerToken,body:{username:'not an @name'}})).status,400);
 assert.equal((await f.request(path,{method:'PUT',token:f.ownerToken,body:{username:'Valid',telegram_id:'99999'}})).status,400);
});
test('contact writes enforce owner password for admins and delegated viewer scope; deletion removes contacts',async()=>{
 const f=await setup();const staff=await f.staff('contactstaff',{can_manage_bot:1});f.user('outside');
 assert.equal((await f.request('/admin/users/outside/telegram',{method:'PUT',token:staff.token,body:{username:'Someone'}})).status,404);
 const path='/admin/admins/'+staff.id+'/telegram';
 assert.equal((await f.request(path,{method:'PUT',token:staff.token,body:{username:'Someone'}})).status,403);
 assert.equal((await f.request(path,{method:'PUT',token:f.ownerToken,body:{username:'Someone'}})).status,403);
 assert.equal((await f.request(path,{method:'PUT',token:f.ownerToken,body:{username:'Someone',telegram_id:'10003',owner_password:PASSWORD}})).status,200);
 assert.equal((await supportContacts(f.env,admins))[2].username,'Someone');
 assert.equal((await f.request('/admin/admins?search=Someone',{token:f.ownerToken})).body.admins[0].id,staff.id);
 await f.request('/admin/users/outside/telegram',{method:'PUT',token:f.ownerToken,body:{username:'OutsideName'}});
 assert.equal((await f.request('/admin/users/outside',{method:'DELETE',token:f.ownerToken,body:{confirmation:'outside'}})).status,200);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM account_telegram_contacts WHERE user_id=?').get('outside').n,0);
});
test('directory cannot point at another verified account identity',async()=>{
 const f=await setup();f.user('one');f.user('two');await member(f.env,{id:10003,first_name:'Verified'},'member');
 await q(f.env,'UPDATE bot_members SET account_id=?1 WHERE telegram_id=?2','one','10003').run();
 assert.equal((await f.request('/admin/users/two/telegram',{method:'PUT',token:f.ownerToken,body:{username:'Other',telegram_id:'10003'}})).status,409);
});
