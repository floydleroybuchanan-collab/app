import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER} from './fixture.mjs';
import {runRecurring,restartRecurring,nextRecurring} from '../bot-recurring.js';
import {send,telegram} from '../bot-telegram.js';
import {botAdmin} from '../bot-admin.js';
const config={enabled:true,group_id:'-100123456789',reminder_enabled:true,reminder_hours:4};
function setup(){
 const f=fixture();let id=0;f.env.TELEGRAM_BOT_TOKEN='fake';
 f.db.prepare('UPDATE bot_settings SET json=?').run(JSON.stringify(config));
 f.env.TELEGRAM_FETCH=async()=>Response.json({ok:true,result:{message_id:++id}});
 return f;
}
test('enabling anchors timer; push sends immediately and restarts interval without cron duplicate',async()=>{
 const f=setup(),t=Math.floor(Date.now()/1000);
 await restartRecurring(f.env,config,t);
 assert.equal(await nextRecurring(f.env,config,t),t+14400);
 assert.equal(await runRecurring(f.env,config,send,telegram),false);
 assert.equal(await runRecurring(f.env,config,send,telegram,{force:true}),true);
 const next=await nextRecurring(f.env,config);
 assert.ok(next>=t+14400&&next<=Math.floor(Date.now()/1000)+14400);
 assert.equal(await runRecurring(f.env,config,send,telegram),false);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bot_events WHERE action='reminder_sent'").get().n,1);
});
test('push endpoint requires bot permission, saved revision and enabled schedule',async()=>{
 const f=setup(),helpers={json:Response.json,safeJson:r=>r.json()};
 const revision=f.db.prepare("SELECT revision FROM bot_content WHERE key='reminder'").get()?.revision||0;
 const req=(r=revision)=>new Request('https://test/admin/bot/recurring/send',{method:'POST',body:JSON.stringify({revision:r})});
 const owner={isOwner:true,user:{id:OWNER},profile:{}};
 await assert.rejects(botAdmin(req(),f.env,{...owner,isOwner:false},helpers),/grant Mr. Charm/);
 await assert.rejects(botAdmin(req(-1),f.env,owner,helpers),/changed/);
 const result=await (await botAdmin(req(),f.env,owner,helpers)).json();
 assert.equal(result.success,true);assert.equal(result.recurring.retention,'until_next_recurring');
 f.db.prepare('UPDATE bot_settings SET json=?').run(JSON.stringify({...config,reminder_enabled:false}));
 await assert.rejects(botAdmin(req(),f.env,owner,helpers),/Enable the bot/);
});
test('simultaneous scheduled and manual sends share a delivery lock',async()=>{
 const f=setup();let release;const gate=new Promise(r=>release=r);
 const slowSend=async(...args)=>{await gate;return send(...args);};
 const first=runRecurring(f.env,config,slowSend,telegram,{force:true});
 await new Promise(r=>setTimeout(r,10));
 await assert.rejects(runRecurring(f.env,config,send,telegram,{force:true}),/already being sent/);
 release();assert.equal(await first,true);
});
