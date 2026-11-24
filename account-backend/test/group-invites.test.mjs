import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW} from './fixture.mjs';
import {q,member} from '../bot-store.js';
import {handleUpdate,botScheduled,webhook} from '../bot-telegram.js';
import {createGroupInvite,maintainGroupInvites,revokeGroupInvite,approveGroupInvite} from '../bot-group-invites.js';

const config={enabled:true,group_id:'-100123456789',bot_username:'TestBot',auto_tokens:true,token_days:90,connections:2,invite_days:7,accounts_enabled:true,downloads_enabled:true,reminder_enabled:false,reminder_hours:6,group_invite_approval:'automatic'};
async function setup(mode='automatic'){
 const f=fixture(),calls=[],members=new Map(),s={...config,group_invite_approval:mode};let next=0;
 f.env.TELEGRAM_BOT_TOKEN='test-only';f.env.TELEGRAM_WEBHOOK_SECRET='test-secret';
 await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify(s)).run();
 f.env.TELEGRAM_FETCH=async(url,opt)=>{
  const method=url.split('/').pop(),body=JSON.parse(opt.body);calls.push({method,body});
  let result=true;
  if(method==='createChatInviteLink')result={invite_link:'https://t.me/+test-'+(++next),creates_join_request:true};
  if(method==='getChatMember')result={status:members.get(String(body.user_id))||'left',user:{id:body.user_id,first_name:'Tester'}};
  if(method==='approveChatJoinRequest')members.set(String(body.user_id),'member');
  if(method==='getChatAdministrators')result=[];
  if(method==='sendMessage')result={message_id:++next};
  return Response.json({ok:true,result});
 };
 const create=(id,extra={})=>createGroupInvite(f.env,s,{telegram_id:String(id),username:'recipient',approved:true,expires_at:NOW()+3600,...extra},'owner');
 const join=(i,id=Number(i.telegram_id),update=1)=>({update_id:update,chat_join_request:{chat:{id:Number(s.group_id)},from:{id,first_name:'Tester',username:'current_name'},date:NOW(),user_chat_id:id+999,invite_link:{invite_link:i.invite_link}}});
 return {...f,s,calls,members,create,join,record:id=>f.db.prepare('SELECT * FROM bot_group_invites WHERE id=?').get(id)};
}
test('seven independent links; only matching ID can be approved; consumed link revoked; app tokens unchanged until membership update',async()=>{
 const f=await setup(),invites=await Promise.all(Array.from({length:7},(_,n)=>f.create(100+n)));
 assert.equal(new Set(invites.map(i=>i.invite_link)).size,7);
 for(const c of f.calls.filter(c=>c.method==='createChatInviteLink')){assert.equal(c.body.creates_join_request,true);assert.equal(c.body.member_limit,undefined);assert.ok(c.body.expire_date>NOW());}
 await handleUpdate(f.env,f.join(invites[0],999,1),f.s);
 assert.equal(f.record(invites[0].id).status,'active');assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,0);
 await handleUpdate(f.env,f.join(invites[0],100,2),f.s);
 assert.equal(f.record(invites[0].id).status,'pending');await approveGroupInvite(f.env,f.s,invites[0].id,'owner');
 const used=f.record(invites[0].id);assert.equal(used.status,'used');assert.equal(used.used_by,'100');assert.equal(used.used_username,'current_name');assert.ok(used.revoked_at);
 assert.ok(invites.slice(1).every(i=>f.record(i.id).status==='active'));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invites').get().n,0);
 await handleUpdate(f.env,{chat_member:{chat:{id:Number(f.s.group_id)},date:NOW(),old_chat_member:{status:'left'},new_chat_member:{status:'member',user:{id:100,first_name:'Tester'}},invite_link:{invite_link:invites[0].invite_link}}},f.s);
 assert.ok(f.record(invites[0].id).joined_at);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invites').get().n,1);
 await handleUpdate(f.env,f.join(invites[0],100,2),f.s);
 assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,1);
});
test('concurrent same-recipient creations reserve once and optional no-expiration omits Telegram expire_date',async()=>{
 const f=await setup();const r=await Promise.allSettled(Array.from({length:5},()=>f.create(123,{expires_at:null})));
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls.filter(c=>c.method==='createChatInviteLink').length,1);
 assert.equal(f.calls[0].body.expire_date,undefined);
});
test('expiration, revoked status, wrong group, unknown managed link and blocked account never grant admission',async()=>{
 const f=await setup(),i=await f.create(123);
 f.db.prepare('UPDATE bot_group_invites SET expires_at=? WHERE id=?').run(NOW()-1,i.id);
 await handleUpdate(f.env,f.join(i),f.s);assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,0);
 await maintainGroupInvites(f.env);assert.equal(f.record(i.id).status,'expired');assert.ok(f.record(i.id).revoked_at);
 const second=await f.create(123);await revokeGroupInvite(f.env,second.id,'owner');await handleUpdate(f.env,f.join(second,123,2),f.s);
 const wrong=f.join(second,123,3);wrong.chat_join_request.chat.id=-10099999;const before=f.calls.length;await handleUpdate(f.env,wrong,f.s);assert.equal(f.calls.length,before);
 const unknown=f.join({...second,invite_link:'https://t.me/+lost'},123,4);unknown.chat_join_request.invite_link.name='charm:orphan';await handleUpdate(f.env,unknown,f.s);assert.equal(f.calls.at(-1).method,'declineChatJoinRequest');
 await member(f.env,{id:124,first_name:'Blocked'});f.db.prepare('UPDATE bot_members SET blocked=1 WHERE telegram_id=?').run('124');await assert.rejects(f.create(124),/blocked/);
});
test('manual approval sends waiting message, records identity, and waits for authorized panel decision',async()=>{
 const f=await setup('manual'),i=await f.create(123);await handleUpdate(f.env,f.join(i),f.s);
 assert.equal(f.record(i.id).status,'pending');assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,0);
 assert.ok(f.calls.some(c=>c.method==='sendMessage'&&c.body.reply_markup?.inline_keyboard[0][0].url.includes('?start=')));
 const r=await f.request('/admin/bot/group-invites/'+i.id+'/approve',{method:'POST',token:f.ownerToken,body:{}});assert.equal(r.status,200);assert.equal(f.record(i.id).status,'used');
 assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,1);
});
test('a pending request alerts activated selected admins and panel count exposes forwarded-link warning',async()=>{
 const f=await setup('manual'),i=await f.create(123);await member(f.env,{id:700,first_name:'Support'},'member');f.db.prepare('UPDATE bot_members SET dm_started=1 WHERE telegram_id=?').run('700');f.db.prepare('INSERT INTO bot_support_admins(telegram_id,name,username,enabled) VALUES(?,?,?,?)').run('700','Support','',1);
 const original=f.env.TELEGRAM_FETCH;f.env.TELEGRAM_FETCH=async(url,opt)=>url.endsWith('getChatAdministrators')?Response.json({ok:true,result:[{user:{id:700,first_name:'Support'}}]}):original(url,opt);
 await handleUpdate(f.env,f.join(i,123,1),f.s);assert.ok(f.calls.some(c=>c.method==='sendMessage'&&c.body.chat_id===700&&/invite request waiting/.test(c.body.text)));
 await handleUpdate(f.env,f.join(i,124,2),f.s);const r=await f.request('/admin/bot/group-invites',{token:f.ownerToken});assert.equal(r.body.invites[0].requester_count,2);
});
test('lost human-authorized Telegram approval response is recovered without a second approval and revocation failures retry while paused',async()=>{
 const f=await setup(),i=await f.create(123),original=f.env.TELEGRAM_FETCH;let drop=true,revokeFails=true;
 f.env.TELEGRAM_FETCH=async(url,opt)=>{if(url.endsWith('revokeChatInviteLink')&&revokeFails)return Response.json({ok:false,error_code:403},{status:403});const result=await original(url,opt);if(url.endsWith('approveChatJoinRequest')&&drop){drop=false;throw Error('lost response');}return result;};
 await handleUpdate(f.env,f.join(i),f.s);await assert.rejects(approveGroupInvite(f.env,f.s,i.id,'owner'),/lost response/);assert.equal(f.record(i.id).status,'approving');
 await maintainGroupInvites(f.env);assert.equal(f.record(i.id).status,'used');assert.equal(f.record(i.id).revoked_at,null);assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,1);
 await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify({...f.s,enabled:false})).run();revokeFails=false;
 await botScheduled(f.env);assert.ok(f.record(i.id).revoked_at);
});
test('revoke fails closed and does not affect another recipient',async()=>{
 const f=await setup(),a=await f.create(123),b=await f.create(124),original=f.env.TELEGRAM_FETCH;
 f.env.TELEGRAM_FETCH=async(url,opt)=>url.endsWith('revokeChatInviteLink')?Response.json({ok:false,error_code:403},{status:403}):original(url,opt);
 const result=await revokeGroupInvite(f.env,a.id,'owner');assert.equal(result.status,'revoked');assert.ok(result.last_error);assert.equal(f.record(b.id).status,'active');
 await handleUpdate(f.env,f.join(a),f.s);assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,0);
});
test('admin endpoints require permission and validate identities, approval, expiration and history access',async()=>{
 const f=await setup(),staff=await f.staff();
 for(const path of ['/admin/bot/group-invites','/admin/bot/group-invites/abcd/attempts'])assert.equal((await f.request(path,{token:staff.token})).status,403);
 for(const body of [{telegram_id:'@user',approved:true},{telegram_id:'123',approved:false},{telegram_id:'9007199254740992',approved:true},{telegram_id:'123',approved:true,expires_at:NOW()-1}])assert.equal((await f.request('/admin/bot/group-invites',{method:'POST',token:f.ownerToken,body})).status,400);
 const r=await f.request('/admin/bot/group-invites',{method:'POST',token:f.ownerToken,body:{telegram_id:'123',approved:true,expires_at:NOW()+600}});assert.equal(r.status,201);
 assert.equal((await f.request('/admin/bot/group-invites?search=123',{token:f.ownerToken})).body.invites.length,1);
 assert.equal((await f.request('/admin/bot/group-invites/'+r.body.invite.id,{method:'DELETE',token:staff.token})).status,403);
});
test('Mr. Charm Invite checks live admin status and returns link only to requesting admin',async()=>{
 const f=await setup('manual'),message=text=>({message:{from:{id:777,first_name:'Admin'},chat:{id:Number(f.s.group_id),type:'supergroup'},text}});
 await handleUpdate(f.env,message('Mr. Charm Invite 123 60'),f.s);assert.equal(f.calls.filter(c=>c.method==='createChatInviteLink').length,0);
 f.members.set('777','administrator');await handleUpdate(f.env,message('Mr. Charm Invite 123 30'),f.s);
 const invite=f.db.prepare('SELECT * FROM bot_group_invites').get();assert.equal(invite.telegram_id,'123');assert.ok(invite.expires_at<=NOW()+1800);
 const reply=f.calls.find(c=>c.body.text?.includes(invite.invite_link));assert.equal(reply.body.ephemeral_message_parameters.receiver_user_id,777);
 f.members.set('777','member');await handleUpdate(f.env,message('Mr. Charm Invite 124 60'),f.s);assert.equal(f.calls.filter(c=>c.method==='createChatInviteLink').length,1);
});
test('support contacts use live admin names, preserve selection and avoid privacy-dependent numeric buttons',async()=>{
 const f=await setup(),original=f.env.TELEGRAM_FETCH;
 f.env.TELEGRAM_FETCH=async(url,opt)=>url.endsWith('getChatAdministrators')?Response.json({ok:true,result:[{user:{id:1,first_name:'Admin One',username:'first'}},{user:{id:2,first_name:'Private Admin'}},{user:{id:3,first_name:'Bot',is_bot:true}}]}):original(url,opt);
 const u={callback_query:{id:'cb',data:'contact',from:{id:123,first_name:'Tester'},message:{chat:{id:Number(f.s.group_id),type:'supergroup'}}}};
 await handleUpdate(f.env,u,f.s);let reply=f.calls.at(-1).body;assert.match(reply.text,/Admin One/);assert.match(reply.text,/Private Admin/);assert.ok(!JSON.stringify(reply).includes('tg://user'));
 f.db.prepare('INSERT INTO bot_support_admins(telegram_id,name,username,enabled) VALUES(?,?,?,?)').run('1','Old name','stale',0);
 await handleUpdate(f.env,u,f.s);reply=f.calls.at(-1).body;assert.match(reply.text,/being configured/);
});
