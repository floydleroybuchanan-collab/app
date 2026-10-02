import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW} from './fixture.mjs';
import {handleUpdate,botScheduled} from '../bot-telegram.js';
import {q} from '../bot-store.js';

async function setup(){
 const f=fixture(),calls=[],state={welcome:false,setup:false,admin:false,lookup:false,revoked:false};
 const s={enabled:true,group_id:'-100123456789',bot_username:'TestBot',auto_tokens:true,token_days:90,connections:2,invite_days:7,accounts_enabled:true,reminder_enabled:false};
 await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify(s)).run();
 f.env.TELEGRAM_BOT_TOKEN='test-only';let seq=0;
 f.env.TELEGRAM_FETCH=async(url,opt)=>{
  const method=url.split('/').pop(),body=JSON.parse(opt.body);calls.push({method,body});
  const id=body.ephemeral_message_parameters?.receiver_user_id;
  if((method==='getChatAdministrators'&&state.lookup)||(method==='sendMessage'&&((id===100&&state.welcome&&body.text.includes('Hello,'))||(id===100&&state.setup&&body.text.includes('Account setup'))||(id===777&&state.admin))))return Response.json({ok:false,error_code:500},{status:500});
  const user={id:body.user_id,first_name:body.user_id===100?'New Member':'Admin',username:'test_user'};
  const result=method==='getChatAdministrators'?[{user:{id:777,first_name:'Admin'}},{user:{id:778,first_name:'Other Admin'}}]:method==='getChatMember'?{status:body.user_id===100||state.revoked&&body.user_id===777?'member':'administrator',user}:method==='sendMessage'?{ephemeral_message_id:++seq}:true;
  return Response.json({ok:true,result});
 };
 const join=()=>handleUpdate(f.env,{chat_member:{chat:{id:Number(s.group_id)},date:NOW(),old_chat_member:{status:'left'},new_chat_member:{status:'member',user:{id:100,first_name:'New Member',username:'new_user'}}}},s);
 const reports=()=>calls.filter(c=>c.method==='sendMessage'&&c.body.text?.includes('New member delivery report'));
 return {...f,calls,state,s,join,reports};
}
for(const failed of ['welcome','setup'])test('failed '+failed+' still attempts other delivery and reports accurate results to both admins',async()=>{
 const f=await setup();f.state[failed]=true;await f.join();
 assert.equal(f.reports().length,2);
 for(const r of f.reports()){
  assert.equal(r.body.chat_id,f.s.group_id);assert.ok([777,778].includes(r.body.ephemeral_message_parameters.receiver_user_id));
  assert.match(r.body.text,/Token assigned: Yes/);
  assert.match(r.body.text,failed==='welcome'?/Welcome delivered: Failed · sendMessage · Telegram 500/:/Account setup and registration directions delivered: Failed · sendMessage · Telegram 500/);
  assert.match(r.body.text,failed==='welcome'?/Account setup and registration directions delivered: Yes/:/Welcome delivered: Yes/);
  assert.doesNotMatch(r.body.text,/CHM-[A-Z0-9-]+/);
 }
 assert.ok(f.calls.some(c=>c.method==='sendMessage'&&c.body.text?.includes('Account setup')));
});
test('one admin failure does not block others, is persisted and retried without repeating member setup',async()=>{
 const f=await setup();f.state.admin=true;await f.join();
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bot_jobs WHERE kind='join_report' AND status='pending'").get().n,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bot_jobs WHERE kind='join_report' AND status='sent'").get().n,1);
 const memberSends=f.calls.filter(c=>c.body.ephemeral_message_parameters?.receiver_user_id===100).length;
 f.state.admin=false;f.db.prepare("UPDATE bot_jobs SET due_at=0 WHERE status='pending'").run();await botScheduled(f.env);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bot_jobs WHERE kind='join_report' AND status='sent'").get().n,2);
 assert.equal(f.calls.filter(c=>c.body.ephemeral_message_parameters?.receiver_user_id===100).length,memberSends);
});
test('administrator lookup failure preserves report for scheduled retry',async()=>{
 const f=await setup();f.state.lookup=true;await f.join();
 assert.equal(f.reports().length,0);
 assert.equal(f.db.prepare("SELECT status FROM bot_jobs WHERE kind='join_report_discovery'").get().status,'pending');
 f.state.lookup=false;f.db.prepare("UPDATE bot_jobs SET due_at=0 WHERE status='pending'").run();await botScheduled(f.env);
 assert.equal(f.reports().length,2);
});
test('token assignment failure still delivers welcome and reports the failure',async()=>{
 const f=await setup();
 // Fail only invitation inserts at the underlying database, keeping audit/report storage usable.
 f.db.exec("CREATE TRIGGER fail_token BEFORE INSERT ON invites BEGIN SELECT RAISE(FAIL,'test failure'); END;");
 await f.join();assert.equal(f.reports().length,2);assert.match(f.reports()[0].body.text,/Token assigned: Failed/);assert.match(f.reports()[0].body.text,/Welcome delivered: Yes/);
});
test('repeated membership notification does not enqueue duplicate administrator reports',async()=>{
 const f=await setup();await f.join();await f.join();assert.equal(f.reports().length,2);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bot_jobs WHERE kind='join_report_discovery'").get().n,1);
});
test('retry rechecks administrator rights and stops after removal',async()=>{
 const f=await setup();f.state.admin=true;await f.join();const before=f.reports().length;
 f.state.revoked=true;f.state.admin=false;f.db.prepare("UPDATE bot_jobs SET due_at=0 WHERE status='pending'").run();await botScheduled(f.env);
 assert.equal(f.reports().length,before);
 assert.equal(f.db.prepare("SELECT status FROM bot_jobs WHERE kind='join_report' AND json_extract(body,'$.recipient')='777'").get().status,'canceled');
});
test('persistent admin failures stop at the retry limit and remain visible in audit',async()=>{
 const f=await setup();f.state.admin=true;await f.join();
 f.db.prepare("UPDATE bot_jobs SET due_at=0,body=json_set(body,'$.attempts',9) WHERE status='pending'").run();await botScheduled(f.env);
 assert.equal(f.db.prepare("SELECT status FROM bot_jobs WHERE kind='join_report' AND json_extract(body,'$.recipient')='777'").get().status,'failed');
 assert.ok(f.db.prepare("SELECT detail FROM bot_events WHERE action='new_member_admin_report_failed' AND detail LIKE '%retries exhausted%'").get());
});
