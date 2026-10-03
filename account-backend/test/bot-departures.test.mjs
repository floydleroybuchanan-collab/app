import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {handleUpdate} from '../bot-telegram.js';

function setup(){
 const f=fixture(),calls=[],s={group_id:'-100123456789'};
 f.env.TELEGRAM_BOT_TOKEN='test-only';
 f.env.TELEGRAM_FETCH=async(url,opt)=>{
  const method=url.split('/').pop(),body=JSON.parse(opt.body);calls.push({method,body});
  return Response.json({ok:true,result:method==='getChatMember'?{status:'left',user:{id:100,first_name:'Jane'}}:method==='sendMessage'?{message_id:1}:true});
 };
 const departure=(old={status:'member'},next={status:'left'},user={id:100,first_name:'Jane',username:'jane'},group=s.group_id)=>handleUpdate(f.env,{chat_member:{chat:{id:Number(group)},date:1791028800,old_chat_member:old,new_chat_member:{...next,user}}},s);
 return {...f,calls,departure};
}
for(const status of ['left','kicked'])test('announces '+status+' publicly once with username and event time',async()=>{
 const f=setup();await f.departure({status:'member'},{status});await f.departure({status:'member'},{status});
 const sends=f.calls.filter(c=>c.method==='sendMessage');assert.equal(sends.length,1);
 assert.equal(sends[0].body.chat_id,'-100123456789');assert.equal(sends[0].body.ephemeral_message_parameters,undefined);
 assert.equal(sends[0].body.text,'@jane — Bye bitch we didn’t want your ass here anyway you fucking loser! At October 3, 2026 at 8:00:00 AM EDT you lost access for being a cunt.');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,0);
});
test('name fallback works for a restricted member who leaves',async()=>{
 const f=setup();await f.departure({status:'restricted',is_member:true},{status:'left'},{id:100,first_name:'Jane',last_name:'Doe'});
 assert.match(f.calls.find(c=>c.method==='sendMessage').body.text,/^Jane Doe — Bye bitch/);
});
test('role changes, already absent members, bots and other rooms do not announce',async()=>{
 const f=setup();
 await f.departure({status:'member'},{status:'administrator'});
 await f.departure({status:'member'},{status:'restricted',is_member:true});
 await f.departure({status:'left'},{status:'kicked'});
 await f.departure({status:'restricted',is_member:false},{status:'left'});
 await f.departure({status:'member'},{status:'left'},{id:100,is_bot:true});
 await f.departure({status:'member'},{status:'left'},{id:100},'-100999');
 assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,0);
});
