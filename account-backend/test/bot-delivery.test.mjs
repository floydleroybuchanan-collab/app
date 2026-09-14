import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {handleUpdate,telegram,botScheduled} from '../bot-telegram.js';
import {cleanExpiredResponses} from '../bot-delivery.js';
const configuration={enabled:true,group_id:'-100123456789',bot_username:'TestBot',accounts_enabled:true,downloads_enabled:true,reminder_enabled:false};
function setup(){
 const f=fixture(),calls=[];let sequence=0;
 f.env.TELEGRAM_BOT_TOKEN='local-fake';
 f.env.TELEGRAM_FETCH=async(url,options)=>{
  const method=url.split('/').pop(),body=JSON.parse(options.body);calls.push({method,body});
  let result=true;
  if(method==='getChatMember')result={status:'member',user:{id:body.user_id}};
  if(method==='sendMessage')result=body.ephemeral_message_parameters?{ephemeral_message_id:++sequence}:{message_id:++sequence};
  return Response.json({ok:true,result});
 };
 return {...f,calls};
}
test('private and recipient-only replies replace previous action and expire without crossing users',async()=>{
 const f=setup();
 const message=(id,text,group=false)=>({message:{from:{id,first_name:'Test'},chat:{id:group?Number(configuration.group_id):id,type:group?'supergroup':'private'},text}});
 await handleUpdate(f.env,message(12345,'Mr Charm About',true),configuration);
 await handleUpdate(f.env,message(23456,'Mr Charm About',true),configuration);
 await handleUpdate(f.env,message(12345,'Mr Charm Help',true),configuration);
 let deletes=f.calls.filter(c=>c.method==='deleteEphemeralMessage');
 assert.equal(deletes.length,1);assert.equal(deletes[0].body.receiver_user_id,12345);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,2);
 await handleUpdate(f.env,message(34567,'Mr Charm Help'),configuration);
 f.db.prepare('UPDATE bot_responses SET due_at=0').run();
 await cleanExpiredResponses(f.env);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,0);
 assert.ok(f.calls.some(c=>c.method==='deleteMessage'&&c.body.chat_id==='34567'));
 assert.ok(f.calls.filter(c=>c.method==='sendMessage'&&String(c.body.chat_id).startsWith('-')).every(c=>c.body.ephemeral_message_parameters));
});
test('failed deletion is retained and retried even when bot is disabled',async()=>{
 const f=setup();await telegram(f.env,'sendMessage',{chat_id:12345,text:'Private reply'});
 f.db.prepare('UPDATE bot_responses SET due_at=0').run();
 const original=f.env.TELEGRAM_FETCH;
 f.env.TELEGRAM_FETCH=async(url,options)=>url.endsWith('deleteMessage')?Response.json({ok:false,error_code:429,parameters:{retry_after:60}},{status:429}):original(url,options);
 await cleanExpiredResponses(f.env);
 assert.equal(f.db.prepare('SELECT attempts FROM bot_responses').get().attempts,1);
 f.env.TELEGRAM_FETCH=original;f.db.prepare('UPDATE bot_responses SET due_at=0').run();
 await botScheduled(f.env);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,0);
});
test('forged admin buttons are denied and do not appear in normal help',async()=>{
 const f=setup(),user={id:12345,first_name:'Viewer'},message={chat:{id:12345,type:'private'}};
 await handleUpdate(f.env,{callback_query:{id:'admin-request',from:user,message,data:'admin'}},configuration);
 assert.match(f.calls.findLast(c=>c.method==='sendMessage').body.text,/Only current group admins/);
 await handleUpdate(f.env,{message:{...message,from:user,text:'/help'}},configuration);
 const help=f.calls.findLast(c=>c.method==='sendMessage').body;
 assert.ok(!JSON.stringify(help.reply_markup).includes('Admin tools'));
 assert.ok(f.calls.filter(c=>c.method==='setMyCommands').every(c=>c.body.commands.every(command=>command.command!=='admin')));
});
test('delivery failure never emits a public fallback or a private token to somebody else',async()=>{
 const f=setup(),original=f.env.TELEGRAM_FETCH;
 f.env.TELEGRAM_FETCH=async(url,options)=>JSON.parse(options.body).ephemeral_message_parameters?Response.json({ok:false,error_code:400},{status:400}):original(url,options);
 await handleUpdate(f.env,{message:{from:{id:12345,first_name:'Test'},chat:{id:Number(configuration.group_id),type:'supergroup'},text:'Mr Charm About'}},configuration);
 assert.ok(!f.calls.some(c=>c.method==='sendMessage'&&String(c.body.chat_id)===configuration.group_id));
});
