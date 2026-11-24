import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER,NOW,PASSWORD} from './fixture.mjs';
import {member,assignToken,settings,q} from '../bot-store.js';
import {handleUpdate,webhook,botScheduled,intent,splitText} from '../bot-telegram.js';
function setup(){const f=fixture(),sent=[];f.env.TELEGRAM_BOT_TOKEN='fake';f.env.TELEGRAM_WEBHOOK_SECRET='local-test-secret';f.env.TELEGRAM_FETCH=async(url,opt)=>{const method=url.split('/').pop(),body=JSON.parse(opt.body);sent.push({method,body});let result={message_id:sent.length};if(method==='getChatMember')result={status:'member',user:{id:body.user_id,first_name:'Tester'}};if(method==='getChatAdministrators')result=[];return Response.json({ok:true,result});};return {...f,sent};}
const configuration={enabled:true,group_id:'-100123456789',bot_username:'TestBot',auto_tokens:true,token_days:90,connections:2,invite_days:7,accounts_enabled:true,downloads_enabled:true,reminder_enabled:false,reminder_hours:6};
test('one invitation under concurrent requests, membership gating, registration link and cancellation tombstone',async()=>{
 const f=setup();await member(f.env,{id:12345,first_name:'Test'},'pending');assert.equal(await assignToken(f.env,'12345',configuration),null);
 await member(f.env,{id:12345,first_name:'Test'},'member');await Promise.all(Array.from({length:6},()=>assignToken(f.env,'12345',configuration)));
 const invites=f.db.prepare('SELECT * FROM invites').all();assert.equal(invites.length,1);
 const r=await f.request('/auth/register',{method:'POST',body:{invite_code:invites[0].invite_code,username:'botviewer',email:'bot@example.test',password:PASSWORD}});assert.equal(r.status,201);
 const m=f.db.prepare('SELECT * FROM bot_members').get();assert.equal(m.account_id,r.body.user.id);
 await f.request('/me',{method:'DELETE',token:r.body.token,body:{confirmation:'please cancel me',password:PASSWORD}});
 const ended=f.db.prepare('SELECT * FROM bot_members').get();assert.equal(ended.blocked,1);assert.equal(ended.ever_assigned,1);assert.equal(await assignToken(f.env,'12345',configuration),null);
});
test('content preserves defaults and history, rejects stale save and unauthorized staff, accepts blank',async()=>{
 const f=setup(),staff=await f.staff();assert.equal((await f.request('/admin/bot/content',{token:staff.token})).status,403);
 const initial=await f.request('/admin/bot/content',{token:f.ownerToken});assert.equal(initial.status,200);assert.match(initial.body.content.find(c=>c.key==='guide').body,/PART 2 OF 2/);
 let r=await f.request('/admin/bot/content/whats_new',{method:'PUT',token:f.ownerToken,body:{body:'Release one',enabled:true,revision:0}});assert.equal(r.status,200);
 assert.equal((await f.request('/admin/bot/content/whats_new',{method:'PUT',token:f.ownerToken,body:{body:'Overwrite',enabled:true,revision:0}})).status,409);
 assert.equal((await f.request('/admin/bot/content/whats_new',{method:'PUT',token:f.ownerToken,body:{body:'',enabled:true,revision:1}})).status,200);
 const c=f.db.prepare("SELECT * FROM bot_content WHERE key='whats_new'").get();assert.equal(c.enabled,0);assert.equal(c.body,'');
 const h=await f.request('/admin/bot/content/whats_new/history',{token:f.ownerToken});assert.equal(h.body.history[0].body,'Release one');
});
test('webhook rejects forged requests and repeated update does not send again',async()=>{
 const f=setup();await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify(configuration)).run();
 const u={update_id:1,message:{message_id:1,chat:{id:12345,type:'private'},from:{id:12345,first_name:'Tester'},text:'/start'}};
 const req=(secret)=>new Request('https://test/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(u)});
 assert.equal((await webhook(req('wrong'),f.env)).status,403);assert.equal(f.sent.length,0);
 assert.equal((await webhook(req('local-test-secret'),f.env)).status,200);const count=f.sent.length;
 assert.equal((await webhook(req('local-test-secret'),f.env)).status,200);assert.equal(f.sent.length,count);
});
test('token only private, membership rechecked, blank optional menus hidden, default download supplied',async()=>{
 const f=setup();await member(f.env,{id:12345,first_name:'Tester'},'member');const inv=await assignToken(f.env,'12345',configuration);
 await handleUpdate(f.env,{message:{chat:{id:-100123456789,type:'supergroup'},from:{id:12345,first_name:'Tester'},text:'Mr.Charm my token'}},configuration);
 const msgs=f.sent.filter(s=>s.method==='sendMessage');assert.ok(msgs.some(s=>s.body.chat_id===configuration.group_id&&s.body.ephemeral_message_parameters?.receiver_user_id===12345&&s.body.text.includes(inv.invite_code)));assert.ok(!msgs.some(s=>!s.body.ephemeral_message_parameters&&s.body.text.includes(inv.invite_code)));
 f.sent.length=0;await handleUpdate(f.env,{message:{chat:{id:12345,type:'private'},from:{id:12345,first_name:'Tester'},text:'/help'}},configuration);
 assert.ok(!JSON.stringify(f.sent).includes('What’s New'));
 f.env.TELEGRAM_FETCH=async()=>Response.json({ok:true,result:{status:'left',user:{id:12345,first_name:'Tester'}}});
 // Run with a capturing rejected membership response.
 const out=[];f.env.TELEGRAM_FETCH=async(url,opt)=>{const b=JSON.parse(opt.body);out.push(b);return Response.json({ok:true,result:url.endsWith('getChatMember')?{status:'left',user:{id:12345,first_name:'Tester'}}:{message_id:1}});};
 await handleUpdate(f.env,{callback_query:{id:'cb',from:{id:12345,first_name:'Tester'},data:'token',message:{chat:{id:12345,type:'private'}}}},configuration);
 assert.ok(!JSON.stringify(out).includes(inv.invite_code));assert.match(out.at(-1).text,/Member access required/);
});
test('saved broadcasts do not send until queued, scheduler claims once, cancelled jobs not sent',async()=>{
 const f=setup();await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify(configuration)).run();
 await f.request('/admin/bot/content/broadcast',{method:'PUT',token:f.ownerToken,body:{body:'Hello members',enabled:true,revision:0}});assert.equal(f.sent.length,0);
 assert.equal((await f.request('/admin/bot/broadcast',{method:'POST',token:f.ownerToken,body:{revision:0}})).status,409);
 assert.equal((await f.request('/admin/bot/broadcast',{method:'POST',token:f.ownerToken,body:{revision:1}})).status,200);
 await botScheduled(f.env);await botScheduled(f.env);assert.equal(f.sent.filter(s=>s.method==='sendMessage').length,1);
 assert.equal(f.db.prepare('SELECT status FROM bot_jobs').get().status,'sent');
});
test('normal-language recognition and Telegram sized guide parts',()=>{assert.equal(intent('Hey Mr. Charm send me the guide'),'guide');assert.equal(intent('Mr Charm where do I get the app?'),'downloads');assert.equal(intent('Mr.Charm my token'),'token');assert.ok(splitText('a'.repeat(9000)).every(s=>s.length<=3500));});
test('full guide puts a fresh help menu after its two ordered messages and private troubleshooting stores answers',async()=>{
 const f=setup(),user={id:34567,first_name:'Guide Tester'},privateMessage=text=>({message:{chat:{id:34567,type:'private'},from:user,text}});
 await handleUpdate(f.env,privateMessage('Mr. Charm Guide'),configuration);
 const guide=f.sent.filter(s=>s.method==='sendMessage').map(s=>s.body.text);assert.equal(guide.length,3);assert.match(guide[0],/PART 1 OF 2/);assert.match(guide[1],/PART 2 OF 2/);assert.match(guide[2],/Click one of the buttons below/);assert.ok(guide.slice(0,2).every(s=>s.length<=4096));
 const cb=data=>({callback_query:{id:crypto.randomUUID(),from:user,data,message:{chat:{id:34567,type:'private'}}}});
 await handleUpdate(f.env,cb('issue:Black Screen'),configuration);
 await handleUpdate(f.env,privateMessage('Onn box'),configuration);
 await handleUpdate(f.env,cb('answer:Everything'),configuration);
 await handleUpdate(f.env,cb('answer:Yes'),configuration);
 await handleUpdate(f.env,cb('answer:No'),configuration);
 await handleUpdate(f.env,privateMessage('Black screen on every channel, build 167.'),configuration);
 const ticket=f.db.prepare('SELECT * FROM bot_support').get();assert.ok(ticket);const detail=JSON.parse(ticket.summary);assert.equal(detail.device,'Onn box');assert.equal(detail.audio,'Yes');assert.equal(detail.scope,'Everything');assert.match(detail.details,/167/);
});
test('combined ban revokes unused invitation even if Telegram refuses the ban',async()=>{
 const f=setup();await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify(configuration)).run();await member(f.env,{id:45678,first_name:'Test'},'member');const inv=await assignToken(f.env,'45678',configuration);
 f.env.TELEGRAM_FETCH=async()=>Response.json({ok:false,error_code:403},{status:403});
 const r=await f.request('/admin/bot/members/45678',{method:'PATCH',token:f.ownerToken,body:{action:'ban_both'}});assert.equal(r.status,409);assert.match(r.body.error,/App access is blocked/);assert.equal(f.db.prepare('SELECT status FROM invites WHERE id=?').get(inv.id).status,'disabled');
});
test('blank downloads do not show old default code and API rejects invalid links',async()=>{
 const f=setup(),s=await settings(f.env),download_codes=Array.from({length:3},()=>({label:'',code:'',enabled:false}));
 assert.equal((await f.request('/admin/bot/settings',{method:'PUT',token:f.ownerToken,body:{...s,download_codes,download_url:'javascript:alert(1)'}})).status,400);
 assert.equal((await f.request('/admin/bot/settings',{method:'PUT',token:f.ownerToken,body:{...s,download_codes,download_url:''}})).status,200);
 await handleUpdate(f.env,{message:{chat:{id:78901,type:'private'},from:{id:78901,first_name:'Blank'},text:'Mr Charm download'}},{...configuration,download_codes});
 assert.ok(!JSON.stringify(f.sent).includes('2977459'));assert.match(f.sent.at(-1).body.text,/unavailable/);
});
test('group discovery finds group events and gives actionable failures',async()=>{
 const f=setup();let mode='group';
 f.env.TELEGRAM_FETCH=async(url)=>{const method=url.split('/').pop();if(mode==='invalid')return Response.json({ok:false,error_code:401},{status:401});let result=method==='getMe'?{id:900,username:'CharmIPTVAssistantBot'}:method==='getWebhookInfo'?{url:''}:mode==='empty'?[]:[{message:{chat:{id:-100987654321,title:'CharmIPTV',type:'supergroup'}}}];return Response.json({ok:true,result});};
 let r=await f.request('/admin/bot/discover-groups',{token:f.ownerToken});assert.equal(r.status,200);assert.equal(r.body.groups[0].id,'-100987654321');
 mode='empty';r=await f.request('/admin/bot/discover-groups',{token:f.ownerToken});assert.equal(r.status,200);assert.match(r.body.message,/\/help@CharmIPTVAssistantBot/);
 mode='invalid';r=await f.request('/admin/bot/discover-groups',{token:f.ownerToken});assert.equal(r.status,400);assert.match(r.body.error,/rejected the saved bot token/);
});
test('group buttons need no private Start and route each member’s token only to that member',async()=>{
 const f=setup(),invitations=[];
 for(const id of [12345,23456]){await member(f.env,{id,first_name:'Tester'},'member');invitations.push(await assignToken(f.env,String(id),configuration));}
 const cb=(id,data)=>({callback_query:{id:'callback-'+id,from:{id,first_name:'Tester'},data,message:{chat:{id:Number(configuration.group_id),type:'supergroup'},message_thread_id:42}}});
 await Promise.all([handleUpdate(f.env,cb(12345,'token'),configuration),handleUpdate(f.env,cb(23456,'token'),configuration)]);
 const replies=f.sent.filter(s=>s.method==='sendMessage');assert.equal(replies.length,2);
 for(let i=0;i<2;i++){const id=[12345,23456][i],r=replies.find(s=>s.body.ephemeral_message_parameters.receiver_user_id===id).body;assert.equal(r.chat_id,configuration.group_id);assert.equal(r.ephemeral_message_parameters.callback_query_id,'callback-'+id);assert.equal(r.message_thread_id,42);assert.ok(r.text.includes(invitations[i].invite_code));assert.ok(!r.text.includes(invitations[1-i].invite_code));}
 assert.equal(f.env.BOT_GROUP_REPLY,undefined);
 await handleUpdate(f.env,cb(12345,'help'),configuration);assert.ok(f.sent.at(-1).body.reply_markup.inline_keyboard.length>=7);
 assert.equal(f.db.prepare('SELECT SUM(dm_started) n FROM bot_members').get().n,0);
});
test('failed ephemeral token delivery never retries the token publicly or by DM',async()=>{
 const f=setup();await member(f.env,{id:12345,first_name:'Tester'},'member');const inv=await assignToken(f.env,'12345',configuration),original=f.env.TELEGRAM_FETCH;
 f.env.TELEGRAM_FETCH=async(url,opt)=>{if(JSON.parse(opt.body).ephemeral_message_parameters){f.sent.push({method:url.split('/').pop(),body:JSON.parse(opt.body)});return Response.json({ok:false,error_code:400},{status:400});}return original(url,opt);};
 await handleUpdate(f.env,{message:{chat:{id:Number(configuration.group_id),type:'supergroup'},from:{id:12345,first_name:'Tester'},text:'Mr Charm token'}},configuration);
 const tokenReplies=f.sent.filter(s=>s.body.text?.includes(inv.invite_code));assert.equal(tokenReplies.length,1);assert.equal(tokenReplies[0].body.ephemeral_message_parameters.receiver_user_id,12345);
 const fallback=f.sent.at(-1).body;assert.ok(!fallback.text.includes(inv.invite_code));assert.match(fallback.reply_markup.inline_keyboard[0][0].url,/\?start=help$/);assert.doesNotMatch(fallback.text,/update Telegram/);
});
test('group support uses buttons through ticket submission without public personal answers',async()=>{
 const f=setup(),cb=data=>({callback_query:{id:crypto.randomUUID(),from:{id:12345,first_name:'Tester'},data,message:{chat:{id:Number(configuration.group_id),type:'supergroup'}}}});
 for(const data of ['issue:Black Screen','answer:Onn box','answer:Everything','answer:Yes','answer:No','answer:Send ticket'])await handleUpdate(f.env,cb(data),configuration);
 const ticket=JSON.parse(f.db.prepare('SELECT summary FROM bot_support').get().summary);assert.equal(ticket.device,'Onn box');assert.equal(ticket.audio,'Yes');assert.equal(ticket.scope,'Everything');
 assert.ok(f.sent.filter(s=>s.method==='sendMessage').every(s=>s.body.ephemeral_message_parameters.receiver_user_id===12345));
});
