import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER} from './fixture.mjs';
import {member,assignToken,q} from '../bot-store.js';
import {handleUpdate} from '../bot-telegram.js';
const configuration={enabled:true,group_id:'-100123456789',bot_username:'TestBot',auto_tokens:true,token_days:90,connections:2,invite_days:7,accounts_enabled:true,downloads_enabled:true};
async function setup(){
 const f=fixture(),sent=[],admins=new Set([11111]);f.env.TELEGRAM_BOT_TOKEN='fake';
 f.env.TELEGRAM_FETCH=async(url,options)=>{const method=url.split('/').pop(),body=JSON.parse(options.body);sent.push({method,body});return Response.json({ok:true,result:method==='getChatMember'?{status:admins.has(Number(body.user_id))?'administrator':'member',user:{id:Number(body.user_id),first_name:'Member',username:'tg'+body.user_id}}:{message_id:sent.length}});};
 await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify(configuration)).run();
 const link=async(id,userId)=>{await member(f.env,{id,first_name:'Member',username:'tg'+id},'member');f.db.prepare('UPDATE bot_members SET account_id=? WHERE telegram_id=?').run(userId,String(id));};
 await link(11111,OWNER);
 const message=(id,text,group=false,reply)=>handleUpdate(f.env,{message:{message_id:sent.length+1,chat:{id:group?Number(configuration.group_id):id,type:group?'supergroup':'private'},from:{id,first_name:'Member',username:'tg'+id},text,...(reply?{reply_to_message:{from:{id:reply,first_name:'Target'}}}:{})}},configuration);
 const callback=(id,data)=>handleUpdate(f.env,{callback_query:{id:crypto.randomUUID(),data,from:{id,first_name:'Member'},message:{chat:{id,type:'private'}}}},configuration);
 const last=()=>sent.filter(s=>s.method==='sendMessage').at(-1)?.body.text;
 return {...f,sent,admins,link,message,callback,last};
}
test('own account commands isolate sessions and require confirmation before revoking',async()=>{
 const f=await setup();f.user('alice');f.user('bob');await f.link(22222,'alice');await f.link(33333,'bob');f.token('alice');f.token('bob');
 await f.message(22222,'Mr Charm sessions');assert.match(f.last(),/alice\nActive sessions: 1/);assert.doesNotMatch(f.last(),/bob/);
 await f.message(22222,'Mr Charm sign out all');assert.equal(f.db.prepare("SELECT revoked FROM sessions WHERE user_id='alice'").get().revoked,0);
 await f.callback(22222,'self:confirm');assert.equal(f.db.prepare("SELECT revoked FROM sessions WHERE user_id='alice'").get().revoked,1);assert.equal(f.db.prepare("SELECT revoked FROM sessions WHERE user_id='bob'").get().revoked,0);
});
test('pending applicant can inspect only their own invitation without an app account',async()=>{
 const f=await setup();await member(f.env,{id:22222,first_name:'Pending'},'member');await assignToken(f.env,'22222',configuration);
 await f.message(22222,'Mr Charm invite status');assert.match(f.last(),/Invitation: unused/);
 await f.message(33333,'Mr Charm invite status');assert.match(f.last(),/No available bot invitation/);
});
test('admin slash arguments work, ordinary users are denied, and confirmation rechecks demotion',async()=>{
 const f=await setup();f.user('alice');await f.link(22222,'alice');
 await f.message(22222,'/disable_account alice');assert.match(f.last(),/Only current group admins/);
 await f.message(11111,'/disable_account@TestBot alice');assert.match(f.last(),/Confirm Disable Account/);assert.equal(f.db.prepare("SELECT status FROM users WHERE id='alice'").get().status,'active');
 f.admins.delete(11111);await f.callback(11111,'manage:confirm');assert.match(f.last(),/Only current group admins/);assert.equal(f.db.prepare("SELECT status FROM users WHERE id='alice'").get().status,'active');
 f.admins.add(11111);await f.callback(11111,'manage:confirm');assert.equal(f.db.prepare("SELECT status FROM users WHERE id='alice'").get().status,'disabled');
 const audit=f.db.prepare("SELECT details FROM audit_log WHERE action='telegram_admin_disable_account'").get();assert.equal(JSON.parse(audit.details).result,'completed');
});
test('account scope applies to both lookups and mutations even for a Telegram admin',async()=>{
 const f=await setup(),staff=await f.staff();f.admins.add(44444);await f.link(44444,staff.id);f.user('outside');
 await f.message(44444,'Mr Charm userinfo outside');assert.match(f.last(),/permitted scope/);
 await f.message(44444,'Mr Charm disable account outside');assert.match(f.last(),/permitted scope/);assert.equal(f.db.prepare("SELECT status FROM users WHERE id='outside'").get().status,'active');
});
test('reply lookup remains requester-only and reply linking carries identity into private confirmation',async()=>{
 const f=await setup();f.user('alice');await f.link(22222,'alice');f.user('legacy');await member(f.env,{id:33333,first_name:'New owner'},'member');
 await f.message(11111,'Mr Charm userinfo',true,22222);const lookup=f.sent.filter(s=>s.method==='sendMessage').at(-1).body;assert.match(lookup.text,/alice/);assert.equal(lookup.ephemeral_message_parameters.receiver_user_id,11111);
 await f.message(11111,'Mr Charm link account legacy',true,33333);assert.match(f.last(),/Continue privately/);
 await f.message(11111,'/start manage_link_account');assert.match(f.last(),/Confirm Link Account · legacy 33333/);assert.match(f.last(),/@tg33333/);
 await f.callback(11111,'manage:confirm');assert.equal(f.db.prepare("SELECT account_id FROM bot_members WHERE telegram_id='33333'").get().account_id,'legacy');
});
test('competing destination link cannot detach the source account',async()=>{
 const f=await setup();f.user('alice');f.user('bob');await f.link(22222,'alice');await member(f.env,{id:33333,first_name:'Target'},'member');
 await f.message(11111,'Mr Charm relink account alice 33333');await f.link(33333,'bob');await f.callback(11111,'manage:confirm');
 assert.match(f.last(),/already linked/);assert.equal(f.db.prepare("SELECT account_id FROM bot_members WHERE telegram_id='22222'").get().account_id,'alice');
});
test('app invite creation requires confirmation and returns only a registration code',async()=>{
 const f=await setup();await f.message(11111,'Mr Charm create invite 30 2');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invites').get().n,0);
 await f.callback(11111,'manage:confirm');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invites').get().n,1);assert.ok(f.sent.some(s=>s.body.text?.startsWith('New app invitation:')));assert.ok(!f.sent.some(s=>s.body.text?.includes('password_hash')));
});
test('password reset sends private approval and completion notices without passwords',async()=>{
 const f=await setup();f.user('alice');await f.link(22222,'alice');
 const request=await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'alice'}});assert.equal(request.status,201);
 const approval=f.sent.find(s=>s.body.text?.startsWith('A password reset was requested')).body;assert.equal(approval.chat_id,'22222');assert.ok(!approval.ephemeral_message_parameters);
 const confirm=approval.reply_markup.inline_keyboard[0][0].callback_data;await f.callback(22222,confirm);
 const password='New-password-for-local-test-only';const result=await f.request('/auth/reset-password',{method:'POST',body:{token:request.body.token,new_password:password}});assert.equal(result.status,200);
 assert.match(f.last(),/password was reset/);assert.ok(!JSON.stringify(f.sent).includes(password));assert.ok(f.db.prepare("SELECT COUNT(*) n FROM bot_responses WHERE recipient_id='22222'").get().n>0);
});
