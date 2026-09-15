import {BOT_COMMANDS} from './bot-command-catalog.js';
export {BOT_COMMANDS,commandLabel,commandText,commandButtons} from './bot-command-catalog.js';
import {q,rows} from './bot-store.js';

export function exactCommand(text) {
 const command=text.trim().replace(/^mr\.?\s*charm\s*/i,'').replace(/^\//,'').replace(/@\w+\b/,'').trim().toLowerCase();
 const alias={'request app access':'request_access','forgot password':'forgot_password','link telegram':'link_telegram','link my account':'link_telegram','notify update':'notify_update','support':'contact','user commands':'help','admin commands':'admin'}[command];
 return alias||BOT_COMMANDS.find(c=>c.command===command||c.id===command||c.phrase.toLowerCase()===command)?.id;
}

export async function currentTelegramAdmin(env,id,s,telegram) {
 const m=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(id)});
 return ['administrator','creator'].includes(m.status)&&!m.user?.is_bot;
}


// Telegram's slash-command menu cannot represent spaced phrases. Use the
// recipient-only inline command buttons, and remove the old scoped lists.
export async function syncCommandMenu(env,id,s,isAdmin,telegram) {
 await telegram(env,'deleteMyCommands',{scope:{type:'chat',chat_id:Number(id)}});
 if(s.group_id)await telegram(env,'deleteMyCommands',{scope:{type:'chat_member',chat_id:s.group_id,user_id:Number(id)}});
 await q(env,'INSERT OR REPLACE INTO bot_runtime(key,value) VALUES(?1,?2)','phrase-menu-v1:'+id,'done').run();
}
export async function migrateCommandMenus(env,s,telegram){
 const globalKey='phrase-menu-v1:global';
 if(!await q(env,'SELECT value FROM bot_runtime WHERE key=?1',globalKey).first()){
  for(const type of ['default','all_private_chats','all_group_chats','all_chat_administrators'])await telegram(env,'deleteMyCommands',{scope:{type}});
  if(s.group_id)for(const type of ['chat','chat_administrators'])await telegram(env,'deleteMyCommands',{scope:{type,chat_id:s.group_id}});
  await q(env,'INSERT OR REPLACE INTO bot_runtime(key,value) VALUES(?1,?2)',globalKey,'done').run();
 }
 const members=await rows(env,"SELECT telegram_id FROM bot_members m WHERE NOT EXISTS(SELECT 1 FROM bot_runtime r WHERE r.key='phrase-menu-v1:'||m.telegram_id) ORDER BY telegram_id LIMIT 8");
 for(const m of members)try{await syncCommandMenu(env,m.telegram_id,s,false,telegram);}catch(e){if(![400,403].includes(e.telegramCode))throw e;await q(env,'INSERT OR REPLACE INTO bot_runtime(key,value) VALUES(?1,?2)','phrase-menu-v1:'+m.telegram_id,'unavailable').run();}
}
