import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,PASSWORD} from './fixture.mjs';
import {member,assignToken} from '../bot-store.js';
import {handleUpdate} from '../bot-telegram.js';
const configuration={enabled:true,group_id:'-100123456789',bot_username:'TestBot',accounts_enabled:true,auto_tokens:true,downloads_enabled:true,reminder_enabled:false,token_days:90,connections:2,invite_days:7};
async function setup(){
 const f=fixture(),calls=[];f.user('viewer');await member(f.env,{id:12345,first_name:'Viewer'},'member');
 f.db.prepare('UPDATE bot_members SET account_id=? WHERE telegram_id=?').run('viewer','12345');
 f.env.TELEGRAM_BOT_TOKEN='local';
 f.env.TELEGRAM_FETCH=async(url,options)=>{const method=url.split('/').pop(),body=JSON.parse(options.body);calls.push({method,body});return Response.json({ok:true,result:method==='getChatMember'?{status:'member',user:{id:body.user_id}}:{message_id:calls.length}});};
 const message=(id,text)=>({message:{from:{id,first_name:'Viewer'},chat:{id,type:'private'},text}});
 async function approve(response,id=12345){
  await handleUpdate(f.env,message(id,'/start '+new URL(response.body.telegram_url).searchParams.get('start')),configuration);
  const prompt=calls.findLast(c=>c.method==='sendMessage').body;
  const data=prompt.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
  if(data?.startsWith('flow:'))await handleUpdate(f.env,{callback_query:{id:crypto.randomUUID(),from:{id,first_name:'Viewer'},message:{chat:{id,type:'private'}},data}},configuration);
 }
 return {...f,calls,approve};
}
test('password reset needs linked Telegram approval, changes password once, and revokes sessions',async()=>{
 const f=await setup(),oldSession=f.token('viewer');
 const c=await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'viewer'}});assert.equal(c.status,201);
 const row=f.db.prepare('SELECT * FROM account_challenges').get();
 assert.ok(!JSON.stringify(row).includes(c.body.token));assert.ok(!JSON.stringify(row).includes(c.body.code.replace('-','')));
 const finish=()=>f.request('/auth/reset-password',{method:'POST',body:{token:c.body.token,new_password:'New-Password-For-App!'}});
 assert.equal((await finish()).status,403);
 await f.approve(c,23456);assert.equal(f.db.prepare('SELECT status FROM account_challenges').get().status,'waiting');
 await f.approve(c);assert.equal((await finish()).status,200);assert.equal((await finish()).status,403);
 assert.equal((await f.request('/me',{token:oldSession})).status,401);
 assert.equal((await f.request('/auth/login',{method:'POST',body:{login:'viewer',password:PASSWORD}})).status,401);
 assert.equal((await f.request('/auth/login',{method:'POST',body:{login:'viewer',password:'New-Password-For-App!'}})).status,200);
 const again=await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'viewer'}});await f.approve(again);
 assert.equal(f.db.prepare('SELECT status FROM account_challenges WHERE token_hash IS NOT NULL ORDER BY rowid DESC').get().status,'waiting');
});
test('new reset cancels older request, expiry is enforced, fourth hourly request is limited',async()=>{
 const f=await setup();
 const first=await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'viewer'}});
 await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'viewer'}});
 assert.equal((await f.request('/auth/challenges/status',{method:'POST',body:{token:first.body.token}})).body.status,'canceled');
 await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'viewer'}});
 assert.equal((await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'viewer'}})).status,429);
 f.db.prepare('UPDATE account_challenges SET expires_at=0').run();
 assert.equal((await f.request('/auth/challenges/status',{method:'POST',body:{token:first.body.token}})).status,410);
});
test('legacy linking requires current app password and cannot replace another verified identity',async()=>{
 const f=await setup();f.user('legacy');const token=f.token('legacy');
 assert.equal((await f.request('/auth/challenges',{method:'POST',token,body:{kind:'link',current_password:'wrong'}})).status,403);
 const challenge=await f.request('/auth/challenges',{method:'POST',token,body:{kind:'link',current_password:PASSWORD}});assert.equal(challenge.status,201);
 await f.approve(challenge,23456);
 assert.equal(f.db.prepare('SELECT account_id FROM bot_members WHERE telegram_id=?').get('23456').account_id,'legacy');
 const retry=await f.request('/auth/challenges',{method:'POST',token,body:{kind:'link',current_password:PASSWORD}});await f.approve(retry,34567);
 assert.equal(f.db.prepare('SELECT account_id FROM bot_members WHERE telegram_id=?').get('34567').account_id,null);
});
test('signed-in password change validates old password and retains only current session',async()=>{
 const f=await setup(),token=f.token('viewer'),other=f.token('viewer');
 assert.equal((await f.request('/me/password',{method:'POST',token,body:{current_password:'wrong',new_password:'Next-Password!'}})).status,403);
 assert.equal((await f.request('/me/password',{method:'POST',token,body:{current_password:PASSWORD,new_password:'Next-Password!'}})).status,200);
 assert.equal((await f.request('/me',{token})).status,200);assert.equal((await f.request('/me',{token:other})).status,401);
});
test('managed invitation registration rejects forwarded code, wrong identity and changed approved details',async()=>{
 const f=await setup();await member(f.env,{id:45678,first_name:'New viewer'},'member');const invitation=await assignToken(f.env,'45678',configuration);
 const body={invite_code:invitation.invite_code,username:'newviewer',email:'newviewer@example.test',password:PASSWORD};
 assert.equal((await f.request('/auth/register',{method:'POST',body})).status,403);
 const challenge=await f.request('/auth/challenges',{method:'POST',body:{kind:'registration',...body}});
 await f.approve(challenge,12345);assert.equal((await f.request('/auth/register',{method:'POST',body:{...body,challenge_token:challenge.body.token}})).status,403);
 await f.approve(challenge,45678);
 assert.equal((await f.request('/auth/register',{method:'POST',body:{...body,username:'attacker',challenge_token:challenge.body.token}})).status,403);
 const registered=await f.request('/auth/register',{method:'POST',body:{...body,challenge_token:challenge.body.token}});assert.equal(registered.status,201);
 assert.equal(f.db.prepare('SELECT account_id FROM bot_members WHERE telegram_id=?').get('45678').account_id,registered.body.user.id);
 assert.equal((await f.request('/auth/register',{method:'POST',body:{...body,challenge_token:challenge.body.token}})).status,403);
});
test('lost Telegram recovery requires verified admin grant and atomically retires the previous link',async()=>{
 const f=await setup();
 assert.equal((await f.request('/admin/users/viewer/recovery',{method:'POST',token:f.ownerToken,body:{ownership_verified:true,admin_password:'wrong',reason:'Verified ownership using existing private records.'}})).status,403);
 const grant=await f.request('/admin/users/viewer/recovery',{method:'POST',token:f.ownerToken,body:{ownership_verified:true,admin_password:PASSWORD,reason:'Verified ownership using existing private records.'}});assert.equal(grant.status,201);
 const challenge=await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'viewer',recovery_code:grant.body.recovery.code}});assert.equal(challenge.status,201);
 assert.equal((await f.request('/auth/challenges',{method:'POST',body:{kind:'reset',login:'viewer',recovery_code:grant.body.recovery.code}})).status,403);
 await f.approve(challenge,56789);
 assert.equal((await f.request('/auth/reset-password',{method:'POST',body:{token:challenge.body.token,new_password:'Recovered-Password!'}})).status,200);
 assert.equal(f.db.prepare('SELECT account_id FROM bot_members WHERE telegram_id=?').get('56789').account_id,'viewer');
 assert.equal(f.db.prepare('SELECT blocked FROM bot_members WHERE telegram_id=?').get('12345').blocked,1);
 assert.ok(f.db.prepare('SELECT used_at FROM account_recovery_grants').get().used_at);
});
