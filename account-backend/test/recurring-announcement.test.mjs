import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {botScheduled} from '../bot-telegram.js';

test('failed old-message deletion does not block recurring announcement or duplicate the slot',async()=>{
 const f=fixture(),sent=[];
 f.env.TELEGRAM_BOT_TOKEN='test';
 f.db.prepare('UPDATE bot_settings SET json=?').run(JSON.stringify({enabled:true,group_id:'-100123456789',reminder_enabled:true,reminder_hours:4}));
 f.db.prepare('INSERT INTO bot_runtime(key,value) VALUES(?,?)').run('reminder_message:-100123456789','1293');
 f.env.TELEGRAM_FETCH=async(url,opt)=>{
  const method=url.split('/').pop(),body=JSON.parse(opt.body);
  if(method==='deleteMessage')return Response.json({ok:false,error_code:400,description:'Bad Request: message to delete not found'},{status:400});
  if(method==='sendMessage')sent.push(body);
  return Response.json({ok:true,result:method==='getChatAdministrators'?[]:{message_id:999}});
 };
 await botScheduled(f.env);await botScheduled(f.env);
 assert.equal(sent.length,1);
 assert.equal(sent[0].chat_id,'-100123456789');
 assert.equal(f.db.prepare('SELECT value FROM bot_runtime WHERE key=?').get('reminder_message:-100123456789').value,'[999]');
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bot_events WHERE action='reminder_sent'").get().n,1);
});
