import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER} from './fixture.mjs';
import {handleUpdate} from '../bot-telegram.js';
const settings={enabled:true,group_id:'-100123456789',bot_username:'TestBot',accounts_enabled:true,downloads_enabled:true,reminder_enabled:false};
test('private usage callbacks leave their latest report readable',async()=>{
 const f=fixture(),calls=[];let seq=0;
 f.env.TELEGRAM_BOT_TOKEN='local-fake';
 f.env.TELEGRAM_FETCH=async(url,options)=>{const method=url.split('/').pop(),body=JSON.parse(options.body);calls.push({method,body});let result=true;if(method==='getChatMember')result={status:'creator',user:{id:12345}};if(method==='sendMessage'||method==='editMessageText')result={message_id:body.message_id||++seq};return Response.json({ok:true,result});};
 const user={id:12345,first_name:'Owner'},chat={id:12345,type:'private'};
 await handleUpdate(f.env,{message:{from:user,chat,text:'Mr Charm Help'}},settings);
 f.db.prepare('UPDATE bot_members SET account_id=? WHERE telegram_id=?').run(OWNER,'12345');
 calls.length=0;
 await handleUpdate(f.env,{message:{from:user,chat,text:'Mr Charm Usage'}},settings);
 assert.match(calls.findLast(c=>c.method==='sendMessage').body.text,/App Usage/);
 assert.ok(!calls.some(c=>c.method==='deleteMessage'&&c.body.message_id===seq),'typed usage command must retain its report');
 for(const section of ['menu','most','least','online','links','visits','signins']){
  calls.length=0;
  await handleUpdate(f.env,{callback_query:{id:'cb-'+section,from:user,message:{chat,message_id:seq},data:'usage:'+section+':30'}},settings);
  const response=calls.findLast(c=>c.method==='sendMessage'||c.method==='editMessageText');
  assert.ok(response,section+' must render');
  assert.match(response.body.text,/App Usage/);
  assert.equal(response.method,'editMessageText','callbacks update the same report rather than deleting it');
  assert.ok(!calls.some(c=>c.method==='deleteMessage'&&c.body.message_id===seq),section+' must retain newest report');
  const row=f.db.prepare('SELECT * FROM bot_responses WHERE message_id=?').get(seq);
  assert.ok(row&&row.due_at-row.created_at===600,'report should remain for ten minutes');
 }
});
