import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {handleUpdate} from '../bot-telegram.js';
import {member} from '../bot-store.js';
import {banterReply,TRIGGER_REPLIES,UNKNOWN_REPLIES} from '../bot-banter.js';
import {richPlain,PREFIX} from '../rich-text.js';
const s={enabled:true,group_id:'-100123456789',bot_username:'TestBot'};
function setup(){
 const f=fixture(),calls=[],people=new Map([
 [11111,{status:'administrator',can_restrict_members:true,user:{id:11111,first_name:'Admin'}}],
 [22222,{status:'member',user:{id:22222,username:'viewer',first_name:'Viewer'}}],
 [33333,{status:'administrator',can_restrict_members:true,user:{id:33333,is_bot:true}}]
 ]);f.env.TELEGRAM_BOT_TOKEN='test';let seq=100;
 f.env.TELEGRAM_FETCH=async(url,opt)=>{const method=url.split('/').pop(),body=JSON.parse(opt.body);calls.push({method,body});return Response.json({ok:true,result:method==='getChatMember'?people.get(body.user_id):method==='getMe'?{id:33333,is_bot:true}:{message_id:calls.length}});};
 async function invoke(text,{id=11111,reply,callback,updateId=seq++,privateChat=false}={}){
  f.db.prepare('DELETE FROM bot_rate').run();
  const message={message_id:updateId,chat:{id:privateChat?id:Number(s.group_id),type:privateChat?'private':'supergroup'},from:{id,first_name:'Tester'},text,...(reply?{reply_to_message:{from:reply}}:{})};
  await handleUpdate(f.env,{update_id:updateId,...(callback?{callback_query:{id:String(updateId),from:message.from,data:callback,message}}:{message})},s);
  const body=calls.filter(c=>['sendMessage','sendRichMessage'].includes(c.method)).at(-1)?.body;
  return body?{...body,text:body.rich_message?richPlain(PREFIX+body.rich_message.html):body.text}:undefined;
 }
 return {...f,calls,people,invoke,mutations:()=>calls.filter(c=>['unbanChatMember','banChatMember','restrictChatMember'].includes(c.method))};
}
test('all exact joke triggers work, punctuation is normalized, unrelated speech is not matched',()=>{
 assert.equal(UNKNOWN_REPLIES.length,25);
 for(const [key,list] of Object.entries(TRIGGER_REPLIES))assert.ok(list.includes(banterReply('Mr Charm '+key+'!')));
 assert.ok(banterReply('MR. CHARM your gay'));
 assert.equal(banterReply('fuck you'),null);
 assert.equal(banterReply('Mr Charm save me from account problems'),null);
 assert.equal(banterReply('Mr Charm I want to kill myself'),null);
});
test('banter and unknown commands are private, while main menu and existing commands still work',async()=>{
 const f=setup();
 const joke=await f.invoke('Mr Charm fuck you',{id:22222});
 assert.ok(TRIGGER_REPLIES['fuck you'].includes(joke.text));assert.equal(joke.ephemeral_message_parameters.receiver_user_id,22222);
 const unknown=await f.invoke('Mr Charm abracadabra',{id:22222});assert.match(unknown.text,/Type Mr Charm/);
 assert.match((await f.invoke('Mr Charm',{id:22222})).text,/Here’s what I can help/);
 assert.match((await f.invoke('Mr Charm Account Linking',{id:22222})).text,/1\. Open Charming/);
});
test('normal users and admins lacking restriction rights cannot execute commands or forged buttons',async()=>{
 const f=setup();
 for(const text of ['Mr Charm Kick 22222','Mr Charm Mute 22222 100'])assert.match((await f.invoke(text,{id:22222})).text,/Only current Telegram group admins/);
 assert.match((await f.invoke('',{id:22222,callback:'admin_mute'})).text,/Only current Telegram group admins/);
 f.people.get(11111).can_restrict_members=false;
 assert.match((await f.invoke('Mr Charm Kick 22222')).text,/Restrict Members/);assert.equal(f.mutations().length,0);
});
test('kick resolves verified username, removes without permanent ban and deduplicates retries',async()=>{
 const f=setup();await member(f.env,f.people.get(22222).user);
 const response=await f.invoke('Mr Charm Kick @viewer',{updateId:500});
 assert.match(response.text,/Removed from the group/);assert.equal(response.ephemeral_message_parameters.receiver_user_id,11111);
 assert.deepEqual(f.mutations().map(c=>c.method),['unbanChatMember']);assert.equal(f.mutations()[0].body.only_if_banned,false);
 await f.invoke('Mr Charm Kick @viewer',{updateId:500});assert.equal(f.mutations().length,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bot_events WHERE action='moderation_kick'").get().n,1);
});
test('timed mute uses minutes and Telegram expiry, reply targeting and alternate syntax work',async()=>{
 for(const [text,reply] of [['Mr Charm Mute 100',{id:22222}],['Mr Charm 22222 mute 100',null]]){
  const f=setup(),start=Math.floor(Date.now()/1000);const response=await f.invoke(text,{reply});
  assert.match(response.text,/Muted for 100 minutes/);const request=f.mutations()[0].body;
  assert.equal(request.user_id,22222);assert.equal(request.permissions.can_send_messages,false);
  assert.ok(request.until_date>=start+6000&&request.until_date<=start+6005);
 }
});
test('invalid durations, protected targets, old restrictions and stale usernames cannot mutate membership',async()=>{
 for(const minutes of ['0','-1','1.5','525601','forever']){const f=setup();await f.invoke('Mr Charm Mute 22222 '+minutes);assert.equal(f.mutations().length,0);}
 for(const target of [11111,33333]){const f=setup();assert.match((await f.invoke('Mr Charm Kick '+target)).text,/protected/);assert.equal(f.mutations().length,0);}
 const f=setup();await member(f.env,{id:22222,username:'oldname'});
 assert.match((await f.invoke('Mr Charm Kick @oldname')).text,/username has changed/);
 f.people.get(22222).status='restricted';f.people.get(22222).is_member=true;
 assert.match((await f.invoke('Mr Charm Mute 22222 100')).text,/already has restrictions/);assert.equal(f.mutations().length,0);
 f.people.get(22222).status='kicked';assert.match((await f.invoke('Mr Charm Kick 22222')).text,/not currently a member/);assert.equal(f.mutations().length,0);
});
test('bot rights checked before changes and admin buttons show instructions privately',async()=>{
 const f=setup();assert.match((await f.invoke('',{callback:'admin_mute'})).text,/Mr Charm Mute @username 100/);
 f.people.get(33333).can_restrict_members=false;
 assert.match((await f.invoke('Mr Charm Kick 22222')).text,/Mr\.? Charm needs/);assert.equal(f.mutations().length,0);
});
