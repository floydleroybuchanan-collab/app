import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {telegram,send,botScheduled} from '../bot-telegram.js';
import {cleanExpiredResponses} from '../bot-delivery.js';
import {replaceRecurring} from '../bot-recurring.js';
import {recurringStatus} from '../recurring-status.js';
const group='-100123456789';
function setup(){
 const f=fixture(),calls=[];let sequence=0;
 f.env.TELEGRAM_BOT_TOKEN='local-test';
 f.env.TELEGRAM_FETCH=async(url,options)=>{
  const method=url.split('/').pop(),body=JSON.parse(options.body);calls.push({method,body});
  return Response.json({ok:true,result:method.startsWith('send')?body.ephemeral_message_parameters?{ephemeral_message_id:++sequence}:{message_id:++sequence}:true});
 };
 return {...f,calls};
}
const deletions=f=>f.calls.filter(c=>c.method.startsWith('delete'));
test('private reply survives expired timer and old bookkeeping pruning',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:123,text:'Keep me'});
 f.db.prepare('UPDATE bot_responses SET due_at=0,created_at=0').run();
 await cleanExpiredResponses(f.env);
 assert.equal(deletions(f).length,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,1);
});
test('next private reply deletes only that chat previous reply after delivery',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:123,text:'First'});
 await telegram(f.env,'sendMessage',{chat_id:456,text:'Other person'});
 await telegram(f.env,'sendMessage',{chat_id:123,text:'Second'});
 assert.deepEqual(deletions(f).map(c=>[c.body.chat_id,c.body.message_id]),[['123',1]]);
 assert.equal(f.calls.at(-2).body.text,'Second');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,2);
});
test('private reply does not remove same user group-only reply',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:group,text:'Group reply',ephemeral_message_parameters:{receiver_user_id:123}});
 await telegram(f.env,'sendMessage',{chat_id:123,text:'Private reply'});
 assert.equal(deletions(f).length,0);
});
test('failed successor preserves previous private reply',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:123,text:'First'});
 f.env.TELEGRAM_FETCH=async()=>Response.json({ok:false,error_code:500},{status:500});
 await assert.rejects(telegram(f.env,'sendMessage',{chat_id:123,text:'Second'}));
 assert.equal(deletions(f).length,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,1);
});
test('multipart private replies stay together and replace previous action',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:123,text:'Old'});
 await send({...f.env,BOT_INTERACTION:{recipient:'123',generation:'multipart'}},123,'A'.repeat(6000));
 assert.deepEqual(deletions(f).map(c=>c.body.message_id),[1]);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,2);
 await cleanExpiredResponses(f.env);assert.equal(deletions(f).length,1);
});
test('private deletion failure retries only on later private reply, not timer',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:123,text:'First'});
 const transport=f.env.TELEGRAM_FETCH;
 f.env.TELEGRAM_FETCH=async(url,options)=>url.endsWith('deleteMessage')?Response.json({ok:false,error_code:429},{status:429}):transport(url,options);
 await telegram(f.env,'sendMessage',{chat_id:123,text:'Second'});
 assert.equal(f.db.prepare('SELECT MAX(attempts) n FROM bot_responses').get().n,1);
 f.db.prepare('UPDATE bot_responses SET due_at=0,lease_until=0').run();
 f.env.TELEGRAM_FETCH=transport;await cleanExpiredResponses(f.env);assert.equal(deletions(f).length,0);
 await telegram(f.env,'sendMessage',{chat_id:123,text:'Third'});
 assert.deepEqual(deletions(f).map(c=>c.body.message_id).sort((a,b)=>a-b),[1,2]);
});
test('group ordinary and ephemeral replies still expire',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:group,text:'Normal'});
 await telegram(f.env,'sendMessage',{chat_id:group,text:'Personal',ephemeral_message_parameters:{receiver_user_id:123}});
 f.db.prepare('UPDATE bot_responses SET due_at=0').run();await cleanExpiredResponses(f.env);
 assert.deepEqual(deletions(f).map(c=>c.method),['deleteMessage','deleteEphemeralMessage']);
});
test('persistent broadcast has no cleanup record',async()=>{
 const f=setup();await send({...f.env,BOT_PERSISTENT_ANNOUNCEMENT:true},group,'Admin announcement');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,0);
 await telegram(f.env,'sendMessage',{chat_id:123,text:'Unrelated private reply'});
 await cleanExpiredResponses(f.env);assert.equal(deletions(f).length,0);
});
test('legacy broadcast timer and queued deletion cannot delete announcement',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:group,text:'Legacy admin announcement'});
 f.db.prepare("INSERT INTO bot_jobs(kind,chat_id,body,due_at,status,message_id) VALUES('broadcast',?,'Legacy',0,'sent',1)").run(group);
 f.db.prepare('UPDATE bot_responses SET due_at=0').run();await cleanExpiredResponses(f.env);
 await telegram(f.env,'deleteMessage',{chat_id:group,message_id:1});
 assert.equal(deletions(f).length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,0);
});
test('new recurring announcements retain all earlier announcement parts',async()=>{
 const f=setup();await replaceRecurring(f.env,group,'A'.repeat(6000),send,telegram);
 await replaceRecurring(f.env,group,'Next announcement',send,telegram);
 assert.equal(deletions(f).length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,0);
 const status=await recurringStatus(f.env,{enabled:true,reminder_enabled:true,group_id:group});
 assert.equal(status.retention,'until_manual_deletion');
});
test('recurring replacement retires legacy timer and pending delete without deleting post',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:group,text:'Old recurring'});
 f.db.prepare('INSERT INTO bot_runtime VALUES(?,?)').run('reminder_message:'+group,'[1]');
 f.db.prepare("INSERT INTO bot_jobs(kind,chat_id,message_id,due_at,status) VALUES('delete',?,1,0,'pending')").run(group);
 await replaceRecurring(f.env,group,'New recurring',send,telegram);
 f.db.prepare('UPDATE bot_responses SET due_at=0').run();await cleanExpiredResponses(f.env);
 assert.equal(deletions(f).length,0);
 assert.equal(f.db.prepare("SELECT status FROM bot_jobs WHERE kind='delete'").get().status,'canceled');
});
test('scheduled broadcast is persistent while website post keeps its timer',async()=>{
 const f=setup();
 f.db.prepare('UPDATE bot_settings SET json=? WHERE id=1').run(JSON.stringify({enabled:true,group_id:group,bot_username:'TestBot',reminder_enabled:false}));
 f.db.prepare("INSERT INTO bot_runtime VALUES('command_menu_migration','2')").run();
 f.db.prepare("INSERT INTO bot_jobs(kind,chat_id,body,due_at) VALUES('broadcast',?,'Admin',0),('website_manual',?,'Website',0)").run(group,group);
 await botScheduled(f.env);
 const broadcast=f.db.prepare("SELECT message_id FROM bot_jobs WHERE kind='broadcast'").get().message_id;
 const id=f.db.prepare("SELECT message_id FROM bot_jobs WHERE kind='website_manual'").get().message_id;
 assert.ok(broadcast>0&&id>0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses WHERE message_id=? AND chat_id=?').get(broadcast,group).n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses WHERE message_id=? AND chat_id=?').get(id,group).n,1);
 f.db.prepare('UPDATE bot_responses SET due_at=0').run();await cleanExpiredResponses(f.env);
 assert.ok(deletions(f).some(c=>c.body.message_id===id));
 assert.ok(!deletions(f).some(c=>c.body.message_id===broadcast));
});
