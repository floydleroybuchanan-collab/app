import {TELEGRAM_LINK_STEPS,ADMIN_LINK_STEPS} from './telegram-link-help.js';
import {q,rows,fail,now} from './bot-store.js';

export function telegramUsername(value){
 if(typeof value!=='string')fail('Enter a Telegram username, with or without @.',400);
 const name=value.trim().replace(/^@/,'');
 if(name&&!/^[a-zA-Z0-9_]{1,32}$/.test(name))fail('Use the Telegram @username, not an email, phone number or display name.',400);
 return name;
}

export async function accountContact(env,userId,lookupUsername){
 const saved=await q(env,'SELECT username,telegram_id,updated_at FROM account_telegram_contacts WHERE user_id=?1',userId).first();
 const linked=await q(env,'SELECT telegram_id,username,name FROM bot_members WHERE account_id=?1',userId).first();
 const contact=saved||{username:'',telegram_id:null};
 // Suggestions identify people for the operator; they never authorize an account.
 const matches=await rows(env,`SELECT telegram_id,name,username,status FROM bot_members
  WHERE telegram_id=?1 OR telegram_id=?2 OR (?3<>'' AND lower(username)=lower(?3)) ORDER BY telegram_id LIMIT 10`,contact.telegram_id,linked?.telegram_id||null,lookupUsername===undefined?contact.username:telegramUsername(lookupUsername));
 return {contact,linked:linked||null,matches,link_instructions:[...TELEGRAM_LINK_STEPS,...ADMIN_LINK_STEPS]};
}

export async function saveAccountContact(env,userId,body){
 const username=telegramUsername(body.username);
 const id=body.telegram_id==null||body.telegram_id===''?null:String(body.telegram_id).trim();
 if(id&&!/^[1-9]\d{4,19}$/.test(id))fail('Use the numeric Telegram ID from a recorded member.',400);
 if(id){
  const person=await q(env,'SELECT telegram_id FROM bot_members WHERE telegram_id=?1 UNION SELECT telegram_id FROM bot_support_admins WHERE telegram_id=?1',id).first();
  if(!person)fail('Mr. Charm has not recorded that Telegram ID yet. Save the username alone or select a recorded member.',400);
  const linked=await q(env,'SELECT account_id FROM bot_members WHERE telegram_id=?1 AND account_id IS NOT NULL',id).first();
  if(linked&&linked.account_id!==userId)fail('This Telegram member is already verified against a different account.',409);
 }
 const existingLink=await q(env,'SELECT telegram_id FROM bot_members WHERE account_id=?1',userId).first();
 if(id&&existingLink&&existingLink.telegram_id!==id)fail('This account already has a different verified Telegram identity. Review its member link first.',409);
 try{
  if(!username&&!id)await q(env,'DELETE FROM account_telegram_contacts WHERE user_id=?1',userId).run();
  else await q(env,`INSERT INTO account_telegram_contacts(user_id,username,telegram_id,updated_at) VALUES(?1,?2,?3,?4)
   ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,telegram_id=excluded.telegram_id,updated_at=excluded.updated_at`,userId,username,id,now()).run();
 }catch(e){if(/UNIQUE constraint failed/i.test(e.message))fail('That Telegram username or ID is already assigned in the contact directory.',409);throw e;}
 return accountContact(env,userId);
}

export async function supportContacts(env,live){
 const configured=await rows(env,'SELECT * FROM bot_support_admins');
 const accounts=await rows(env,`SELECT c.telegram_id,c.username FROM account_telegram_contacts c
  JOIN users u ON u.id=c.user_id JOIN admin_profiles p ON p.user_id=u.id WHERE u.role='admin' AND p.enabled=1 AND c.telegram_id IS NOT NULL`);
 return live.filter(a=>!a.user.is_bot&&(!configured.length||configured.some(p=>p.telegram_id===String(a.user.id)&&p.enabled===1))).map(a=>{
  const id=String(a.user.id),record=configured.find(p=>p.telegram_id===id),account=accounts.find(p=>p.telegram_id===id);
  // Current Telegram data wins. Manually entered contacts are a public-link fallback only.
  return {id,name:[a.user.first_name,a.user.last_name].filter(Boolean).join(' ')||record?.name||'Admin',username:a.user.username||record?.contact_username||account?.username||''};
 });
}
