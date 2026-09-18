import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {BOT_COMMANDS,commandButtons} from '../bot-command-catalog.js';
import {COMMAND_MENUS,HOME_COMMANDS} from '../bot-menus.js';
import {handleUpdate} from '../bot-telegram.js';
import {richPlain,PREFIX} from '../rich-text.js';
const config={enabled:true,group_id:'-100123456789',bot_username:'TestBot'};
function setup(){
 const f=fixture(),sent=[],admins=new Set([11111]);f.env.TELEGRAM_BOT_TOKEN='fake';
 f.env.TELEGRAM_FETCH=async(url,options)=>{
  const method=url.split('/').pop(),body=JSON.parse(options.body);sent.push({method,body});
  return Response.json({ok:true,result:method==='getChatMember'?{status:admins.has(Number(body.user_id))?'administrator':'member',user:{id:Number(body.user_id)}}:{message_id:sent.length}});
 };
 const invoke=async(id,data)=>{
  f.db.prepare('DELETE FROM bot_rate').run();
  await handleUpdate(f.env,{callback_query:{id:crypto.randomUUID(),data,from:{id,first_name:'Viewer'},message:{chat:{id:Number(config.group_id),type:'supergroup'},receiver_user:{id}}}},config);
  const body=sent.filter(call=>['sendMessage','sendRichMessage'].includes(call.method)).at(-1).body;
  return {...body,text:body.rich_message?richPlain(PREFIX+body.rich_message.html):body.text};
 };
 return {...f,sent,admins,invoke};
}

test('account linking instructions use numbered spaced steps and recipient-only navigation',async()=>{
 const f=setup();
 const instructions=await f.invoke(22222,'linking:user');
 assert.match(instructions.text,/1\. Open Charming/);
 assert.match(instructions.text,/\n\n2\. Sign in/);
 assert.equal(instructions.ephemeral_message_parameters.receiver_user_id,22222);
 assert.ok(!instructions.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='linking:admin'));
 assert.ok(instructions.text.length<3500);
 for(const key of ['linking:admin','linking:assist','linking:panel'])assert.match((await f.invoke(22222,key)).text,/Only current group admins/);
 const admin=await f.invoke(11111,'linking:user');
 assert.ok(admin.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='linking:admin'));
});
test('home restores compact icon menu and keeps admin navigation private',async()=>{
 const f=setup(),user=await f.invoke(22222,'help');
 assert.equal(user.text,'Here’s what I can help you with. Click one of the buttons below.');
 const buttons=user.reply_markup.inline_keyboard.flat();
 assert.ok(buttons.some(b=>b.text==='📖 Charming MediaLab User Guide'));
 assert.ok(buttons.some(b=>b.text==='👤 User Commands'));
 assert.ok(!buttons.some(b=>b.callback_data==='admin'));
 assert.ok(buttons.length<=HOME_COMMANDS.length+1);
 assert.equal(user.ephemeral_message_parameters.receiver_user_id,22222);
 const admin=await f.invoke(11111,'help');
 assert.ok(admin.reply_markup.inline_keyboard.flat().some(b=>b.text==='🛡 Admin Commands'));
 assert.equal(admin.ephemeral_message_parameters.receiver_user_id,11111);
});
test('categories cover every action once and retain short icon labels and clear descriptions',async()=>{
 const f=setup();
 const seen=new Set();
 for(const menu of COMMAND_MENUS){
  for(const id of menu.commands){assert.ok(!seen.has(id),id);seen.add(id);const c=BOT_COMMANDS.find(c=>c.id===id);assert.ok(c);assert.equal(Boolean(c.admin),Boolean(menu.admin));assert.notEqual(c.description,c.label);}
  const body=await f.invoke(menu.admin?11111:22222,menu.id);
  assert.ok(body.text.length<4000);
  const buttons=body.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.length<=9);
  for(const b of buttons){assert.doesNotMatch(b.text,/^Mr Charm /);assert.match(b.text,/^[^\p{L}\p{N}]/u);}
 }
 assert.deepEqual(seen,new Set(BOT_COMMANDS.filter(c=>!['help','admin','user_commands'].includes(c.id)).map(c=>c.id)));
});
test('every admin category rechecks current rights and forged unknown admin routes are denied',async()=>{
 const f=setup();
 for(const menu of COMMAND_MENUS.filter(m=>m.admin))assert.match((await f.invoke(22222,menu.id)).text,/Only current group admins/);
 await f.invoke(11111,'admin');f.admins.delete(11111);
 assert.match((await f.invoke(11111,'menu:admin:access')).text,/Only current group admins/);
 assert.match((await f.invoke(22222,'menu:admin:forged')).text,/Only current group admins/);
});
test('navigation cancels an active draft and preserves contextual back and cancel labels',async()=>{
 const f=setup();
 f.db.prepare('INSERT INTO bot_conversations VALUES(?,?,?,?)').run('11111','manage:input','{}',Math.floor(Date.now()/1000));
 await f.invoke(11111,'menu:admin:find');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_conversations').get().n,0);
 const buttons=commandButtons({inline_keyboard:[[{text:'Back to support admins',callback_data:'contact'},{text:'Cancel',callback_data:'admin'}]]}).inline_keyboard.flat();
 assert.equal(buttons[0].text,'↩ Back to support admins');assert.equal(buttons[1].text,'↩ Cancel');
});
test('unlinked group admins can read bot status but account changes require their verified panel identity',async()=>{
 const f=setup();
 const status=await f.invoke(11111,'manage_bot_status');
 assert.match(status.text,/Mr Charm: Enabled/);
 assert.equal(status.ephemeral_message_parameters.receiver_user_id,11111);
 assert.match((await f.invoke(11111,'manage_link_account')).text,/existing app\/panel administrator login/);
 assert.match((await f.invoke(22222,'manage_bot_status')).text,/Only current group admins/);
 f.admins.delete(11111);
 assert.match((await f.invoke(11111,'manage_bot_status')).text,/Only current group admins/);
});
