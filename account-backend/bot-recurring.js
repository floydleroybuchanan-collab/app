import {q,event,now,content,fail} from './bot-store.js';

export const recurringInterval=s=>Math.max(1,Math.min(24,Number(s.reminder_hours)||6))*3600;
export async function nextRecurring(env,s,t=now()){
 const saved=await q(env,'SELECT value FROM bot_runtime WHERE key=?1','reminder_next:'+s.group_id).first();
 if(saved)return Number(saved.value);
 const interval=recurringInterval(s),slot=Math.floor(t/interval);
 const legacy=await q(env,'SELECT value FROM bot_runtime WHERE key=?1','reminder_slot:'+s.group_id).first();
 return legacy?.value===String(slot)?(slot+1)*interval:t;
}
export async function restartRecurring(env,s,t=now()){
 await q(env,'INSERT INTO bot_runtime VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value','reminder_next:'+s.group_id,String(t+recurringInterval(s))).run();
}
export async function runRecurring(env,s,send,remove,{force=false}={}){
 const c=await content(env,'reminder');
 if(!s.enabled||!s.reminder_enabled||!s.group_id||!c.enabled||!c.body.trim()){
  if(force)fail('Enable the bot, recurring schedule and saved announcement message first.');return false;
 }
 if(!force&&await nextRecurring(env,s)>now())return false;
 const key='reminder_lock:'+s.group_id,lease=String(now()+120)+':'+crypto.randomUUID();
 const claimed=await q(env,'INSERT INTO bot_runtime VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<=?3',key,lease,now()).run();
 if(!claimed.meta.changes){if(force)fail('An announcement is already being sent. Refresh shortly.',409);return false;}
 try{
  if(!force&&await nextRecurring(env,s)>now())return false;
  await replaceRecurring(env,s.group_id,c.body,send,remove);
  await restartRecurring(env,s);
  return true;
 }catch(e){await event(env,null,'reminder_send_failed',e.message);if(force)throw e;return false;}
 finally{await q(env,'DELETE FROM bot_runtime WHERE key=?1 AND value=?2',key,lease).run();}
}

export function recurringIds(value){
 try { const parsed=JSON.parse(value||'[]');return (Array.isArray(parsed)?parsed:[parsed]).filter(n=>Number.isSafeInteger(n)&&n>0); } catch { return []; }
}
export async function currentRecurring(env,chatId,messageId){
 const row=await q(env,'SELECT value FROM bot_runtime WHERE key=?1','reminder_message:'+chatId).first();
 return recurringIds(row?.value).includes(Number(messageId));
}
export async function replaceRecurring(env,chatId,text,send,remove){
 const key='reminder_message:'+chatId;
 const previous=recurringIds((await q(env,'SELECT value FROM bot_runtime WHERE key=?1',key).first())?.value);
 const delivery={chatId:String(chatId),ids:[]};
 try {
  await send({...env,BOT_RECURRING:delivery},chatId,text);
  if(!delivery.ids.length)throw new Error('Telegram did not return an announcement message ID.');
  await q(env,'INSERT INTO bot_runtime VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(delivery.ids)).run();
 } catch(e) {
  // A partial long post must not replace the previous complete announcement.
  for(const id of delivery.ids)try{await remove(env,'deleteMessage',{chat_id:chatId,message_id:id});}catch{}
  throw e;
 }
 for(const id of previous)try{await remove(env,'deleteMessage',{chat_id:chatId,message_id:id});}catch(e){await event(env,null,'reminder_delete_failed',e.message);}
 await event(env,null,'reminder_sent','Recurring announcement delivered; retained until its scheduled replacement.');
}
