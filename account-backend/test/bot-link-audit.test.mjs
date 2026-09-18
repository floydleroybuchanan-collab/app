import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER} from './fixture.mjs';
import {member} from '../bot-store.js';
import {BOT_COMMANDS} from '../bot-command-catalog.js';
import {ACCOUNT_COMMANDS,ADMIN_ACCOUNT_COMMANDS} from '../bot-account-commands.js';
import {handleUpdate} from '../bot-telegram.js';
const config={enabled:true,group_id:'-100123456789',bot_username:'TestBot',accounts_enabled:true,downloads_enabled:true};
async function setup(linked=true,admin=true){
 const f=fixture(),sent=[];f.env.TELEGRAM_BOT_TOKEN='fake';
 f.env.TELEGRAM_FETCH=async(url,options)=>{
  const method=url.split('/').pop(),body=options.body instanceof FormData?Object.fromEntries(options.body):JSON.parse(options.body);sent.push({method,body});
  return Response.json({ok:true,result:method==='getChatMember'?{status:admin?'administrator':'member',user:{id:11111,first_name:'Renamed person',username:'new_name'}}:method==='getChatAdministrators'?[]:{message_id:sent.length}});
 };
 await member(f.env,{id:11111,first_name:'Original person',username:'old_name'},'member');
 if(linked)f.db.prepare('UPDATE bot_members SET account_id=? WHERE telegram_id=?').run(OWNER,'11111');
 const invoke=async(id)=>{
  f.db.prepare('DELETE FROM bot_rate').run();sent.length=0;
  await handleUpdate(f.env,{callback_query:{id:crypto.randomUUID(),data:id,from:{id:11111,first_name:'Renamed person',username:'new_name'},message:{chat:{id:11111,type:'private'}}}},config);
  return sent.filter(c=>['sendMessage','sendRichMessage','sendDocument'].includes(c.method)).map(c=>c.body.text||c.body.rich_message?.html||c.body.caption).join('\n');
 };
 return {...f,sent,invoke};
}
test('every catalog command recognizes a verified account after a Telegram username change',async()=>{
 for(const command of BOT_COMMANDS){
  const f=await setup();const text=await f.invoke(command.id);
  assert.ok(text,command.id+' must respond');
  assert.doesNotMatch(text,/No verified app account|not linked to an authorized|Group membership alone/i,command.id);
  assert.equal(f.db.prepare('SELECT account_id FROM bot_members WHERE telegram_id=?').get('11111').account_id,OWNER,command.id);
 }
});
test('all account-admin actions reject contact-only identities without silently granting privileges',async()=>{
 for(const command of ADMIN_ACCOUNT_COMMANDS.filter(c=>c.command!=='bot_status')){
  const f=await setup(false);
  f.db.prepare('INSERT INTO account_telegram_contacts VALUES(?,?,?,?)').run(OWNER,'old_name','11111',Math.floor(Date.now()/1000));
  assert.match(await f.invoke(command.id),/not linked to an authorized app\/panel admin account/,command.id);
 }
});
test('every protected account-admin command rejects non-admin Telegram identities even with a link',async()=>{
 for(const command of ADMIN_ACCOUNT_COMMANDS){
  const f=await setup(true,false);
  assert.match(await f.invoke(command.id),/Only current group admins/,command.id);
 }
});
test('every self-account command reads a linked regular user rather than requiring an admin role',async()=>{
 for(const command of ACCOUNT_COMMANDS){
  const f=await setup(true,false);f.user('regular');
  f.db.prepare('UPDATE bot_members SET account_id=? WHERE telegram_id=?').run('regular','11111');
  assert.doesNotMatch(await f.invoke(command.id),/No verified app account|administrator permission|Only current group admins/i,command.id);
 }
});
test('Account Help does not describe an unlinked Telegram member as linked',async()=>{
 const f=await setup(false,false);const text=await f.invoke('account');
 assert.doesNotMatch(text,/Your Telegram is linked/);
 assert.match(text,/no verified app-account link/i);
});
test('legacy linking guidance is available to users, admins and the panel without requiring a new account',async()=>{
 const f=await setup(false);
 const userHelp=await f.invoke('link_telegram');
 assert.match(userHelp,/accounts created before Mr Charm/);
 assert.match(userHelp,/Android app’s Settings, not the web panel/);
 assert.match(userHelp,/Do not create a second account/);
 const adminHelp=await f.invoke('manage_link_account');
 assert.match(adminHelp,/For your own admin access/);
 assert.match(adminHelp,/To help another user/);
 const panel=await f.request('/admin/admins/'+OWNER+'/telegram',{token:f.ownerToken});
 assert.equal(panel.status,200);
 assert.ok(panel.body.link_instructions.some(step=>step.includes('Android app’s Settings, not the web panel')));
 assert.ok(panel.body.link_instructions.some(step=>step.includes('already show a verified link')));
});
