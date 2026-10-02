import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW} from './fixture.mjs';
import {handleUpdate,send} from '../bot-telegram.js';
import {navigationParent,navigationDestination,withNavigation} from '../bot-navigation.js';
import {COMMAND_MENUS} from '../bot-menus.js';
const s={enabled:true,group_id:'-100123456789',bot_username:'TestBot',accounts_enabled:true,downloads_enabled:false};
function setup(){
 const f=fixture(),calls=[];let seq=0;
 f.env.TELEGRAM_BOT_TOKEN='test';
 f.env.TELEGRAM_FETCH=async(url,opt)=>{
  const method=url.split('/').pop(),body=JSON.parse(opt.body);calls.push({method,body});
  return Response.json({ok:true,result:method==='getChatMember'?{status:'member',user:{id:100,first_name:'Member'}}:method==='getChatAdministrators'?[]:method.startsWith('send')?{message_id:++seq}:true});
 };
 const invoke=async(data,text)=>{
  f.db.prepare('DELETE FROM bot_rate').run();
  const message={message_id:++seq,chat:{id:100,type:'private'},from:{id:100,first_name:'Member'},text};
  await handleUpdate(f.env,{update_id:seq,...(data?{callback_query:{id:String(seq),from:message.from,message,data}}:{message})},s);
  return calls.filter(c=>c.method.startsWith('send')).at(-1).body;
 };
 return {...f,calls,invoke};
}
const buttons=b=>b.reply_markup.inline_keyboard.flat();
test('every category and command has a safe parent; forged mutation destinations are rejected',()=>{
 for(const menu of COMMAND_MENUS){assert.ok(navigationDestination('nav:'+navigationParent(menu.id)));for(const command of menu.commands)assert.ok(navigationDestination('nav:'+navigationParent(command)));}
 for(const cmd of ['nav:manage:confirm','nav:flow:yes:123','nav:announce:publish','nav:unknown'])assert.equal(navigationDestination(cmd),null);
});
test('interactive information and unavailable downloads have Back; category Back returns one level',async()=>{
 const f=setup();
 for(const command of ['downloads','about','status','token','faq'])assert.ok(buttons(await f.invoke(command)).some(b=>b.callback_data==='nav:help'||b.callback_data==='nav:menu:user:access'));
 assert.ok(buttons(await f.invoke('menu:user:recovery')).some(b=>b.callback_data==='nav:user_commands'));
 assert.match((await f.invoke('nav:user_commands')).text,/Choose a category/);
 assert.match((await f.invoke('nav:help')).text,/Here’s what I can help/);
});
test('Back leaves support prompts and cancels stale answers without saving a ticket',async()=>{
 const f=setup();
 let result=await f.invoke('issue:Other');assert.ok(buttons(result).some(b=>b.callback_data==='nav:troubleshooting'));
 result=await f.invoke(null,'Mr Charm Android TV');assert.ok(buttons(result).some(b=>b.callback_data==='nav:troubleshooting'));
 await f.invoke('nav:troubleshooting');assert.equal(f.db.prepare('SELECT * FROM bot_conversations WHERE telegram_id=?').get('100'),undefined);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_support').get().n,0);
});
test('Back cancels pending admin confirmation and cannot bypass live administrator checks',async()=>{
 const f=setup();
 f.db.prepare('INSERT INTO bot_conversations VALUES(?,?,?,?)').run('100','manage:confirm',JSON.stringify({command:'manage_delete_account',targetId:'someone'}),NOW());
 const result=await f.invoke('nav:menu:admin:access');assert.match(result.text,/Only current group admins/);
 assert.equal(f.db.prepare('SELECT * FROM bot_conversations WHERE telegram_id=?').get('100'),undefined);
 assert.equal(f.calls.some(c=>['banChatMember','approveChatJoinRequest'].includes(c.method)),false);
});
test('navigation preserves buttons and only attaches to intended interactive recipient',async()=>{
 const f=setup(),env={...f.env,BOT_NAVIGATION:{userId:'100',parent:'account'}};
 const original={inline_keyboard:[[{text:'Confirm',callback_data:'self:confirm'}],[{text:'Help',callback_data:'help'}]]};
 const nav=withNavigation(env,100,original);assert.equal(original.inline_keyboard[1][0].callback_data,'help');
 assert.ok(nav.inline_keyboard.flat().some(b=>b.callback_data==='self:confirm'));
 assert.equal(withNavigation(env,777,original),original);
 assert.equal(withNavigation({...env,BOT_PUBLIC_HUMOR:true},100,undefined),undefined);
 await send(env,100,'x'.repeat(8100));const sent=f.calls.filter(c=>c.method==='sendMessage');
 assert.equal(sent[0].body.reply_markup,undefined);assert.equal(sent[1].body.reply_markup,undefined);assert.ok(buttons(sent[2].body).some(b=>b.callback_data==='nav:account'));
});
