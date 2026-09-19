import {q,rows,event,now,fail} from './bot-store.js';
import {addressedText,pick} from './bot-banter.js';

const KICK=[
 'Get the fuck outta here, {user}. Mr. Charm has spoken. 😂👋',
 'And just like that, {user} got their ass launched out the fucking door. 🚪💨😂',
 'Pack your shit, {user}. Your free trial of this group has officially fucking expired. 😂',
 '🚨 BOOT ACTIVATED 🚨 {user}, get the fuck on down the road. 👢😂',
 'Damn {user}… you fucked around and made an admin summon Mr. Charm. Bye, motherfucker. 👋😂',
 'Another one bites the dust. 💀 {user} has been yeeted the fuck out of Charming MediaLab.'
];
const MUTE=[
 '🔇 {user}, shut the fuck up for {minutes} minutes. Mr. Charm has had enough of your ass. 😂',
 'Damn {user}, you talked so much shit somebody called Mr. Charm. Enjoy your fucking silence. 🤐😂',
 '🚨 MUTE HAMMER ACTIVATED 🚨 {user} can’t say a damn thing for the next {minutes} minutes. Beautiful, isn’t it? 😂',
 '{user}, congratulations! You just won {minutes} minutes of shutting the fuck up. 🏆😂',
 'Mr. Charm has officially put {user}’s loud ass on timeout for {minutes} minutes. Sit there and think about your bullshit. 😂',
 '🔇 Somebody take {user}’s microphone away—oh wait, I fucking did. See you in {minutes} minutes. 😂'
];
export function parseModeration(text){
 const value=addressedText(text);if(value===null)return null;
 let m=value.match(/^(kick|mute)(?:\s+(.*))?$/i);
 if(!m){const alt=value.match(/^(@\w+|\d+)\s+(kick|mute)(?:\s+(.*))?$/i);if(alt)m=[alt[0],alt[2],[alt[1],alt[3]].filter(Boolean).join(' ')];}
 return m?{action:m[1].toLowerCase(),args:(m[2]||'').trim().split(/\s+/).filter(Boolean)}:null;
}
const markup={inline_keyboard:[[{text:'↩ Group moderation',callback_data:'menu:admin:moderation'}],[{text:'🛡 Admin Commands',callback_data:'admin'}]]};
const instructions='👢 Kick removes a member; they can request to join again.\nMr Charm Kick @username\n\n🔇 Mute temporarily stops a member from posting. The number is minutes (1–525600).\nMr Charm Mute @username 100\n\nYou can use their numeric Telegram ID instead of @username. In the group, reply directly to their message with “Mr Charm Kick” or “Mr Charm Mute 100”.\n\nOnly Telegram admins with Restrict Members permission may act. Owners, admins and bots are protected. Confirmations are private. Existing restrictions are never replaced with a shorter mute.';
export async function moderation(env,id,text,cmd,s,m,updateId,telegram,send){
 const parsed=parseModeration(text),button=['admin_kick','admin_mute'].includes(cmd);
 if(!parsed&&!button)return false;
 const actor=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(id)});
 if(!['creator','administrator'].includes(actor.status)||actor.user?.is_bot||String(actor.user?.id)!==String(id)){
  await event(env,id,'moderation_denied','Current Telegram admin required');await send(env,id,'Only current Telegram group admins can use kick and mute.');return true;
 }
 if(actor.status!=='creator'&&!actor.can_restrict_members){await send(env,id,'Your Telegram admin permissions need “Restrict Members” enabled to kick or mute.');return true;}
 const action=parsed?.action||cmd.slice(6),args=parsed?.args||[];
 const reply=m.chat.type!=='private'&&!m.reply_to_message?.sender_chat?m.reply_to_message?.from:null;
 if(!args.length&&!reply){await send(env,id,instructions,markup);return true;}
 let target=args[0],duration=args[1];
 if(reply&&((action==='kick'&&args.length===0)||(action==='mute'&&args.length===1))){target=String(reply.id);duration=args[0];}
 else if(args.length!==(action==='mute'?2:1)){await send(env,id,instructions,markup);return true;}
 if(!/^(@[a-z0-9_]{5,32}|[1-9]\d{0,15})$/i.test(target||'')){await send(env,id,'Use @username, a numeric Telegram ID, or reply directly to the member’s message.\n\n'+instructions,markup);return true;}
 const minutes=Number(duration);
 if(action==='mute'&&(!/^\d+$/.test(duration||'')||!Number.isInteger(minutes)||minutes<1||minutes>525600)){await send(env,id,'Choose a whole number of minutes from 1 to 525600. Example: Mr Charm Mute @username 100',markup);return true;}
 let targetId=target;
 if(target.startsWith('@')){
  const matches=await rows(env,'SELECT telegram_id FROM bot_members WHERE lower(username)=lower(?1)',target.slice(1));
  if(matches.length!==1){await send(env,id,'I cannot safely identify that username. Reply to the member’s message in the group, or use their numeric Telegram ID.',markup);return true;}
  targetId=matches[0].telegram_id;
 }
 if(!Number.isSafeInteger(Number(targetId))||Number(targetId)<=0)fail('Invalid Telegram ID.');
 const live=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(targetId)});
 if(String(live.user?.id)!==String(targetId)||(target.startsWith('@')&&live.user?.username?.toLowerCase()!==target.slice(1).toLowerCase()))fail('That username has changed. Reply to the member’s message or use their numeric Telegram ID.');
 if(targetId===String(id)||live.user.is_bot||['creator','administrator'].includes(live.status))fail('Owners, administrators, bots and your own account are protected.');
 if(live.status!=='member'&&!(live.status==='restricted'&&live.is_member))fail('That person is not currently a member of this group.');
 // Telegram lifts restrictions at until_date. Do not accidentally lift an older restriction.
 if(action==='mute'&&live.status==='restricted')fail('This member already has restrictions. Review their existing restrictions in Telegram; I will not overwrite them.');
 const me=await telegram(env,'getMe',{}),bot=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:me.id});
 if(bot.status!=='administrator'||!bot.can_restrict_members)fail('Mr. Charm needs Telegram administrator permission to Restrict Members.');
 // Claim before the external mutation. A webhook retry must never repeat/extend it.
 const operation='moderation:'+s.group_id+':'+(Number.isSafeInteger(updateId)?updateId:id+':'+m.message_id);
 const claim=await q(env,'INSERT OR IGNORE INTO bot_runtime(key,value) VALUES(?1,?2)',operation,JSON.stringify({action,targetId,at:now(),state:'pending'})).run();
 if(!claim.meta.changes){await send(env,id,'This moderation request was already handled or is being checked. Check the member’s status before submitting another command.',markup);return true;}
 const until=now()+minutes*60;
 try{
  if(action==='kick')await telegram(env,'unbanChatMember',{chat_id:s.group_id,user_id:Number(targetId),only_if_banned:false});
  else await telegram(env,'restrictChatMember',{chat_id:s.group_id,user_id:Number(targetId),use_independent_chat_permissions:true,until_date:until,permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false,can_change_info:false,can_invite_users:false,can_pin_messages:false,can_manage_topics:false,can_react_to_messages:false}});
 }catch(e){await event(env,id,'moderation_failed',action+' target='+targetId+' Telegram='+String(e.telegramCode||'unconfirmed'));await send(env,id,'Telegram could not confirm this action. Check the member’s status and Mr. Charm’s Restrict Members permission before trying again.',markup);return true;}
 await q(env,'UPDATE bot_runtime SET value=?1 WHERE key=?2',JSON.stringify({action,targetId,at:now(),state:'done',...(action==='mute'?{until}: {})}),operation).run();
 await event(env,id,'moderation_'+action,'target='+targetId+(action==='mute'?' minutes='+minutes+' until='+until:''));
 const label=live.user.username?'@'+live.user.username:String(targetId);
 await send(env,id,pick(action==='kick'?KICK:MUTE).replaceAll('{user}',label).replaceAll('{minutes}',String(minutes))+'\n\n'+(action==='kick'?'Removed from the group. This is not a permanent ban.':'Muted for '+minutes+' minutes. Telegram will lift this mute automatically.'),markup);
 return true;
}
