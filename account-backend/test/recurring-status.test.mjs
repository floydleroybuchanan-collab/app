import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {recurringStatus} from '../recurring-status.js';
const s={enabled:true,group_id:'-100123',reminder_enabled:true,reminder_hours:4};
test('dashboard reports real successful delivery and the next claimed schedule boundary',async()=>{
 const f=fixture();f.env.TELEGRAM_BOT_TOKEN='test';
 f.db.prepare("INSERT INTO bot_runtime(key,value) VALUES(?,?)").run('reminder_slot:'+s.group_id,'2');
 f.db.prepare("INSERT INTO bot_events(action,detail,created_at) VALUES('reminder_sent','Accepted',29000)").run();
 const r=await recurringStatus(f.env,s,30000);
 assert.equal(r.last_sent.created_at,29000);assert.equal(r.next_at,43200);assert.equal(r.due_now,false);
 const disabled=await recurringStatus(f.env,{...s,reminder_enabled:false},30000);
 assert.equal(disabled.next_at,null);assert.equal(disabled.enabled,false);
});
test('unclaimed interval is due, and a send failure is not a successful post',async()=>{
 const f=fixture();f.env.TELEGRAM_BOT_TOKEN='test';
 f.db.prepare("INSERT INTO bot_events(action,detail,created_at) VALUES('reminder_send_failed','Rejected',29900)").run();
 const r=await recurringStatus(f.env,s,30000);
 assert.equal(r.last_sent,null);assert.equal(r.last_error.detail,'Rejected');assert.equal(r.due_now,true);
});
