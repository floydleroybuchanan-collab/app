import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW} from './fixture.mjs';
import {handleUpdate} from '../bot-telegram.js';
const s={enabled:true,group_id:'-100123456789',bot_username:'TestBot',accounts_enabled:true};
test('support tickets notify current human admins and continue after one private delivery fails',async()=>{
 const f=fixture(),calls=[];f.env.TELEGRAM_BOT_TOKEN='test';
 f.db.prepare('UPDATE bot_settings SET json=?').run(JSON.stringify(s));
 f.db.prepare('INSERT INTO bot_conversations VALUES(?,?,?,?)').run('100','details',JSON.stringify({topic:'Black Screen',device:'TV'}),NOW());
 f.env.TELEGRAM_FETCH=async(url,opt)=>{
  const method=url.split('/').pop(),body=JSON.parse(opt.body);calls.push({method,body});
  if(method==='sendMessage'&&String(body.chat_id)==='777')return Response.json({ok:false,error_code:403},{status:403});
  const result=method==='getChatAdministrators'?[{user:{id:777}},{user:{id:778}},{user:{id:779,is_bot:true}}]:method==='sendMessage'?{message_id:calls.length}:true;
  return Response.json({ok:true,result});
 };
 await handleUpdate(f.env,{message:{chat:{id:100,type:'private'},from:{id:100,first_name:'Member'},text:'Mr Charm It is still black'}},s);
 assert.ok(calls.some(c=>String(c.body.chat_id)==='778'&&c.body.text?.includes('New support ticket')));
 assert.ok(!calls.some(c=>String(c.body.chat_id)==='779'));
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bot_events WHERE action='support_admin_notification_failed'").get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_support').get().n,1);
});
