import {isRich,readRich,richPlain,richLength,richAppend} from './rich-text.js';
import {currentRecurring,runRecurring} from './bot-recurring.js';
import {LINK_INSTRUCTIONS} from './bot-link-instructions.js';
import {banterReply,addressedText,pick,UNKNOWN_REPLIES,sendHumor} from './bot-banter.js';
import {moderation} from './bot-moderation.js';
import {usageCommand} from './bot-usage.js';
import {websiteConfig,queueWebsitePost} from './website-announcements.js';
import {HOME_COMMANDS,COMMAND_MENUS} from './bot-menus.js';
import {supportContacts} from './telegram-contacts.js';
import {telegramTransport,rememberResponse,cleanExpiredResponses} from './bot-delivery.js';
import {BOT_COMMANDS,exactCommand,currentTelegramAdmin,syncCommandMenu,migrateCommandMenus,commandButtons,commandText} from './bot-commands.js';
import {accountFlow} from './bot-account-flow.js';
import {botAnnouncementFlow} from './bot-announcements.js';
import {accountManagement} from './bot-account-management.js';
import {brandText,brandedTelegramBody} from './branding.js';
import {now,q,rows,settings,content,event,member,assignToken,fail} from './bot-store.js';
import {handleGroupJoinRequest,recordGroupAdmission,maintainGroupInvites,createGroupInvite,revokeGroupInvite} from './bot-group-invites.js';
export const isMember=m=>['member','administrator','creator'].includes(m.status)||(m.status==='restricted'&&m.is_member===true);
export async function telegram(env,method,body){
 if(method==='deleteMessage'&&await currentRecurring(env,body.chat_id,body.message_id))return true;
 if(!env.TELEGRAM_BOT_TOKEN)fail('Save TELEGRAM_BOT_TOKEN in Cloudflare first.',503);
 body=brandedTelegramBody(body);
 if(body.reply_markup)body.reply_markup=commandButtons(body.reply_markup);
 // Request-local routing: personal replies never fall back to public group messages.
 const target=env.BOT_GROUP_REPLY;
 if(target&&['sendMessage','sendRichMessage'].includes(method)&&String(body.chat_id)===target.user_id){
  body={...body,chat_id:target.chat_id,...(env.BOT_PUBLIC_HUMOR?{}:{ephemeral_message_parameters:{receiver_user_id:Number(target.user_id),...(target.callback_query_id?{callback_query_id:target.callback_query_id}:{})}}),...(target.message_thread_id?{message_thread_id:target.message_thread_id}:{})};
 }
 const result=await telegramTransport(env,method,body);
 await rememberResponse(env,method,body,result);
 return result;
}
const keyboard=items=>({inline_keyboard:items.map(([text,data])=>[{text,callback_data:data}])});
const activate=s=>({inline_keyboard:[[{text:'Activate Mr. Charm',url:'https://t.me/'+s.bot_username+'?start=help'}]]});
const groupHelp=()=>keyboard([['💜 Mr. Charm Help','help']]);
export function splitText(text,max=3500){const out=[];while(text.length>max){let n=text.lastIndexOf('\n',max);if(n<max/2)n=max;out.push(text.slice(0,n));text=text.slice(n).replace(/^\n/,'');}if(text)out.push(text);return out;}
const plain=text=>text.replace(/^#{1,6} /gm,'').replace(/\*\*(.*?)\*\*/g,'$1');
export async function send(env,id,text,reply_markup){
 if(isRich(text)){const rich=readRich(text);try{return await telegram(env,'sendRichMessage',{chat_id:id,rich_message:{html:rich.html},...(reply_markup?{reply_markup}:{})});}catch(e){if(e.telegramCode!==400)throw e;await event(env,null,'rich_message_fallback','Telegram declined rich formatting; sending plain text.');text=rich.text;}}
 let result;const chunks=splitText(plain(commandText(brandText(text))),4000);for(let i=0;i<chunks.length;i++){result=await telegram(env,'sendMessage',{chat_id:id,text:chunks[i],...(i===chunks.length-1&&reply_markup?{reply_markup}:{})});
 }return result;}
async function show(env,id,key,s){const c=await content(env,key);if(!c.enabled||!c.body.trim())return send(env,id,'This information is currently unavailable. Please contact an Admin.');
 if(isRich(c.body)){await send(env,id,c.body);await event(env,id,key+'_viewed');return;}
 if(key==='guide'){const marker='💜 YOUR Charming MediaLab GUIDE\nPART 2 OF 2',pos=c.body.indexOf(marker);if(pos>0){await send(env,id,c.body.slice(0,pos).trim());await send(env,id,c.body.slice(pos));}else await send(env,id,c.body);}
 else if(key==='rules'){
  const warning='VIOLATION OF ANY OF THESE RULES IS A LIFETIME BAN FROM THE Charming MediaLab APP AND THE TELEGRAM GROUP.';
  if(c.body.trim().endsWith(warning)){await send(env,id,c.body.slice(0,c.body.lastIndexOf(warning)).trim());
   try{await telegram(env,'sendRichMessage',{chat_id:id,rich_message:{html:'<h1><b>'+warning+'</b></h1>'}});}catch(e){if(e.telegramCode!==400)throw e;await telegram(env,'sendMessage',{chat_id:id,text:warning,entities:[{type:'bold',offset:0,length:warning.length}]});}
  }
  else await send(env,id,c.body);
 }else await send(env,id,c.body);await event(env,id,key+'_viewed');
 // Long guides and rules leave the original buttons far above the reader.
 // Put the full Help menu after the content so the next action is always here.
 if(['guide','rules','app_help'].includes(key))await help(env,id,s);
}
async function authorizedMember(env,id,s){
 const live=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(id)});
 await member(env,live.user,live.status==='restricted'&&live.is_member?'restricted_member':live.status);
 return isMember(live);
}
export function intent(text){
 const exact=exactCommand(text);if(exact)return exact;
 const t=text.toLowerCase().replace(/mr\.?\s*charm/g,'').replace(/^\//,'').trim();
 if(/multiview|multi.view|real.?debrid|xtream|sources|nova|playback help/.test(t))return 'app_help';
 if(/token/.test(t))return 'token';if(/account|login|time remaining|active login/.test(t))return 'account';
 if(/what.?s new|release/.test(t))return 'whats_new';if(/trouble|buffer|freez|black screen/.test(t))return 'troubleshooting';
 if(/download|downloader|apk|where.*app/.test(t))return 'downloads';if(/guide/.test(t))return 'guide';if(/rule/.test(t))return 'rules';
 if(/admin|support/.test(t))return 'contact';if(/status/.test(t))return 'status';if(/about/.test(t))return 'about';return 'help';
}
async function help(env,id,s){
 const admin=await currentTelegramAdmin(env,id,s,telegram);
 const commands=await availableCommands(env,HOME_COMMANDS);
 const items=commands.map(c=>[c.buttonLabel,c.id]);
 items.push(['👤 User Commands','user_commands']);
 if(admin)items.push(['🛡 Admin Commands','admin']);
 try{await syncCommandMenu(env,id,s,admin,telegram);}catch(e){await event(env,id,'command_menu_sync_failed',e.telegramCode?String(e.telegramCode):'network');}
 const result=await send(env,id,'Here’s what I can help you with. Click one of the buttons below.',keyboard(items));
 await event(env,id,'help_menu_delivered');return result;
}
async function availableCommands(env,ids){
 const commands=[];
 for(const id of ids){
  const command=BOT_COMMANDS.find(c=>c.id===id);if(!command)continue;
  if(command.content){const c=await content(env,id);if(!c.enabled||!c.body.trim())continue;}
  commands.push(command);
 }
 return commands;
}
async function commandMenu(env,id,cmd,s){
 const selected=COMMAND_MENUS.find(menu=>menu.id===cmd);
 const admin=cmd==='admin'||selected?.admin||cmd.startsWith('menu:admin:');
 if(admin&&!await currentTelegramAdmin(env,id,s,telegram))return send(env,id,'Only current group admins can access Admin tools.',keyboard([['Main menu','help']]));
 if(cmd.startsWith('menu:')&&!selected)return help(env,id,s);
 if(selected){
  const commands=await availableCommands(env,selected.commands);
  return send(env,id,selected.label+'\n'+selected.description+'\n\n'+(commands.length?commands.map(c=>c.buttonLabel+'\n'+c.description).join('\n\n'):'No information is available in this category yet.'),keyboard(commands.map(c=>[c.buttonLabel,c.id]).concat([['↩ '+(admin?'Admin Commands':'User Commands'),admin?'admin':'user_commands'],['🏠 Main menu','help']])));
 }
 const menus=COMMAND_MENUS.filter(menu=>Boolean(menu.admin)===Boolean(admin));
 return send(env,id,(admin?'🛡 Admin Commands':'👤 User Commands')+'\nChoose a category below. Each command includes a short explanation.\n\n'+menus.map(menu=>menu.label+' — '+menu.description).join('\n\n'),keyboard(menus.map(menu=>[menu.label,menu.id]).concat([['🏠 Main menu','help']])));
}

async function account(env,id,s,tokenOnly){
 if(!s.accounts_enabled)return send(env,id,'Account help is temporarily paused. Please contact an Admin.');
 const m=await q(env,'SELECT * FROM bot_members WHERE telegram_id=?1',id).first();
 const inv=m.invite_id?await q(env,'SELECT * FROM invites WHERE id=?1',m.invite_id).first():null;
 const u=m.account_id?await q(env,'SELECT * FROM users WHERE id=?1',m.account_id).first():null;
 if(m.blocked||u&&(u.status!=='active'||u.expires_at!==null&&u.expires_at<=now()))return send(env,id,'Your account is inactive or blocked. Please contact an Admin.');
 if(tokenOnly){
  if(!inv||['disabled','expired'].includes(inv.status)||inv.status==='unused'&&inv.expires_at!==null&&inv.expires_at<=now())return send(env,id,'Your invitation is unavailable. An Admin can check your account; requesting again will not create a replacement.');
  return send(env,id,'Your Charming MediaLab invitation token:\n'+inv.invite_code+'\n\n'+(inv.status==='used'?'Already used to register. Sign in using your app username and password.':'Use this once to register in the app.')+'\nKeep this token private.');
 }
 const count=u?await q(env,'SELECT COUNT(*) n FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?2',u.id,now()).first():null;
 return send(env,id,u?`My Account\nUsername: ${u.username}\nStatus: ${u.status}\nExpiration: ${u.expires_at===null?'Unlimited':new Date(u.expires_at*1000).toISOString()}\nTime remaining: ${u.expires_at===null?'Unlimited':Math.max(0,Math.ceil((u.expires_at-now())/86400))+' days'}\nActive logins: ${count.n} of ${u.max_sessions}\nTelegram: Linked\nInvitation: ${inv?.status||'No surviving record'}`:'Mr Charm recognizes your Telegram identity, but no verified app-account link is saved yet. '+(inv?'Your invitation is '+inv.status+'. Register in the app to activate your account.':'An Admin must check or link your existing account.'),keyboard([['🔗 Account Linking','linking:user'],['🔑 My Token','token'],['Login help','issue:Login / Token'],['Account FAQ','faq'],['Contact an Admin','contact']]));
}
async function contact(env,id,s,selected=null){
 let live;
 const support={text:'Open support ticket',callback_data:'issue:Other'};
 try{live=await telegram(env,'getChatAdministrators',{chat_id:s.group_id});}
 catch(e){await event(env,id,'support_admin_lookup_failed',e.telegramMethod+' '+(e.telegramCode||'network'));return send(env,id,'I could not retrieve the group admin list just now. Please try again shortly or open a support ticket.',{inline_keyboard:[[support]]});}
 const people=await supportContacts(env,live);
 const back={text:'Back to support admins',callback_data:'contact'};
 if(selected){
  const person=people.find(p=>p.id===selected);
  if(!person)return send(env,id,'This support contact is no longer available.',{inline_keyboard:[[back],[support]]});
  const text=person.name+(person.username?'\n@'+person.username:'\nNo public Telegram username is set. Open the group, tap its name, open the member list and select '+person.name+'. You can also open a support ticket below.');
  return send(env,id,text,{inline_keyboard:[...(person.username?[[{text:'Contact '+person.name,url:'https://t.me/'+person.username}]]:[]),[back],[support]]});
 }
 const text=people.length?'Charming MediaLab Support Admins ('+people.length+')\n\n'+people.map(p=>p.name+(p.username?' (@'+p.username+')':' — select below for contact help')).join('\n')+'\n\nPlease contact one Admin at a time.':'Support Admin contacts are being configured. You can open a support ticket below.';
 // Every enabled live human admin receives a button, even without a public username.
 const markup={inline_keyboard:[...people.map(p=>[{text:p.name,...(p.username?{url:'https://t.me/'+p.username}:{callback_data:'contact-admin:'+p.id})}]),[support]]};
 try{return await send(env,id,text,markup);}
 catch(e){if(e.telegramCode!==400)throw e;await event(env,id,'support_admin_buttons_rejected',e.telegramMethod||'sendMessage');return send(env,id,text,{inline_keyboard:[...people.map(p=>[{text:p.name,callback_data:'contact-admin:'+p.id}]),[support]]});}
}
async function inviteCommand(env,id,text,m,s,updateId){
 const actor=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(id)});
 if(!['administrator','creator'].includes(actor.status)||actor.user?.is_bot)return send(env,id,'Only current Charming MediaLab group admins can create group invites.');
 if(/^\s*mr\.?\s*charm\s+invites\s*$/i.test(text)){
  const list=await rows(env,'SELECT * FROM bot_group_invites WHERE group_id=?1 ORDER BY created_at DESC,id DESC LIMIT 15',s.group_id);
  return send(env,id,list.length?'Recent group invites\n\n'+list.map(i=>i.id.slice(0,8)+' · '+i.recipient_label+' · '+(i.expires_at!==null&&i.expires_at<=now()&&['active','pending'].includes(i.status)?'expired':i.status)+'\nExpires: '+(i.expires_at?new Date(i.expires_at*1000).toISOString():'Never')).join('\n\n')+'\n\nCancel one with Mr. Charm Revoke INVITE_ID. Full links and join history are in the admin panel.':'No group invites yet. Use Mr. Charm Invite John Smith 60.');
 }
 if(/^\s*mr\.?\s*charm\s+revoke\b/i.test(text)){
  const key=text.replace(/^\s*mr\.?\s*charm\s+revoke\s*/i,'').trim().toLowerCase();
  if(!/^(?:[a-f0-9]{8}|[a-f0-9]{8}-[a-f0-9-]{27})$/.test(key))return send(env,id,'Use Mr. Charm Invites to find the invite ID, then Mr. Charm Revoke INVITE_ID.');
  const matches=await rows(env,'SELECT id FROM bot_group_invites WHERE group_id=?1 AND id LIKE ?2',s.group_id,key+'%');
  if(matches.length!==1)return send(env,id,'That ID was not found or is ambiguous. Use the full ID from the panel.');
  try{const result=await revokeGroupInvite(env,matches[0].id,'telegram:'+id);return send(env,id,result.revoked_at?'Invite revoked. Existing group members have not been removed.':'The invite is blocked locally. Telegram revocation is pending and will retry automatically.');}
  catch(e){if(e.status&&e.status<500)return send(env,id,e.message);throw e;}
 }
 const args=text.replace(/^\s*mr\.?\s*charm\s+invite\b/i,'').trim().split(/\s+/).filter(Boolean);
 const replied=m.reply_to_message?.from;
 const duration=(replied&&args.length===1||args.length>1)&&/^\d+$/.test(args.at(-1))?args.pop():'60';
 const recipient=replied&&!replied.is_bot?String(replied.id):args.length===1&&/^\d+$/.test(args[0])?args[0]:null;
 const label=replied?[replied.first_name,replied.last_name].filter(Boolean).join(' '):recipient?'Telegram '+recipient:args.join(' ')||'New member';
 const minutes=Number(duration);
 if(!Number.isInteger(minutes)||minutes<1||minutes>10080||label.length>100)return send(env,id,'Use Mr. Charm Invite John Smith 60, or Mr. Charm Invite 123456789 60 when you know their Telegram ID. Default: 60 minutes; maximum: 7 days. The recipient still needs a human admin’s approval.');
 try{
  const invite=await createGroupInvite(env,s,{telegram_id:recipient,recipient_label:label,username:replied?.username||'',expires_at:now()+minutes*60,approved:true},'telegram:'+id,Number.isSafeInteger(updateId)?'telegram-update:'+updateId:null);
  return send(env,id,'Personal group invite for '+invite.recipient_label+(invite.telegram_id?' · Telegram ID '+invite.telegram_id:'')+'\n'+invite.invite_link+'\nExpires: '+new Date(invite.expires_at*1000).toISOString()+'\nShare this link only with the intended person. A human admin must verify and approve the requester.');
 }catch(e){if(e.status&&e.status<500)return send(env,id,e.message);throw e;}
}
const topics=['Installing the App','Login / Token','Channel Won’t Play','Buffering / Freezing','Guide / EPG','Sound but No Picture','Black Screen','App Won’t Update','Other'];
async function troubleshooting(env,id){return send(env,id,'What are you having trouble with?',keyboard(topics.map(t=>[t,'issue:'+t])));}
async function conversation(env,id,text,data){
 const c=await q(env,'SELECT * FROM bot_conversations WHERE telegram_id=?1',id).first();if(!c)return false;
 if(now()-c.updated_at>3600){await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();return false;}
 const d=JSON.parse(c.json);let next,prompt;
 if(c.state==='device'){if(!text&&!data?.startsWith('answer:'))return false;d.device=(text||data.slice(7)).slice(0,300);next='scope';prompt='Does it affect everything or only some channels?';}
 else if(c.state==='scope'){d.scope=(data||text||'').replace('answer:','').slice(0,300);next='audio';prompt='Do you hear audio when the problem happens?';}
 else if(c.state==='audio'){d.audio=(data||text||'').replace('answer:','').slice(0,300);next='result';prompt='Try these steps:\n1. Close and reopen Charming MediaLab.\n2. Check another channel and your internet connection.\n3. Restart your device.\n'+(/Guide/.test(d.topic)?'4. In Settings, clear the guide cache and reload the guide.':/Login/.test(d.topic)?'4. Check your username and password. Invitation codes are only used for initial registration.':/Install|Update/.test(d.topic)?'4. Use the current download and allow installation from Downloader in your device settings.':'4. Note which channels fail and any error shown.')+'\n\nDid that fix the issue?';}
 else if(c.state==='result'){
  if(data==='answer:Yes'){await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();await send(env,id,'Glad that helped. Type Mr. Charm Help anytime.');return true;}
  next='details';prompt=env.BOT_GROUP_REPLY?'Would you like me to send your answers to the Admins as a support ticket?':'Describe what happened and any error message. Do not include passwords or tokens. I’ll include your earlier answers in a support ticket.';
 }else if(c.state==='details'){
  if(!text&&data!=='answer:Send ticket')return false;d.details=(text||'Member requested Admin help using the group buttons. Please follow up for further details.').slice(0,1800).replace(/CHM-[A-Z0-9-]+/gi,'[token removed]');
  await env.DB.batch([q(env,'INSERT INTO bot_support(telegram_id,summary,created_at,updated_at) VALUES(?1,?2,?3,?3)',id,JSON.stringify(d),now()),q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id)]);
  await event(env,id,'support_opened',d.topic);await send(env,id,'Your support ticket is saved for the Admins with your troubleshooting answers.');return true;
 }else return false;
 const result=await send(env,id,prompt,next==='scope'?keyboard([['Everything','answer:Everything'],['Only some channels','answer:Some channels']]):['audio','result'].includes(next)?keyboard([['Yes','answer:Yes'],['No','answer:No']]):next==='details'&&env.BOT_GROUP_REPLY?keyboard([['Send ticket to Admins','answer:Send ticket'],['Back to Help','help']]):undefined);
 // The shared delivery layer replaces the prior response, including ephemeral
 // group replies, only after this step was successfully delivered.
 d.prompt_message=result?.message_id?{chat_id:env.BOT_GROUP_REPLY?.chat_id||id,message_id:result.message_id}:null;
 await q(env,'UPDATE bot_conversations SET state=?1,json=?2,updated_at=?3 WHERE telegram_id=?4',next,JSON.stringify(d),now(),id).run();return true;
}
async function handleCommand(env,id,cmd,s){
 if(cmd==='usage'||cmd.startsWith('usage:')||cmd==='website_release'||cmd==='update_report')return usageCommand(env,id,cmd,s);
 if(cmd==='admin'||cmd.startsWith('admin_')){
  if(!await currentTelegramAdmin(env,id,s,telegram))return send(env,id,'Only current group admins can access Admin tools.');
  if(cmd==='admin')return commandMenu(env,id,cmd,s);
  if(cmd==='admin_invites')return inviteCommand(env,id,'Mr Charm Invites',{},s);
  if(['admin_invite','admin_revoke'].includes(cmd)){
   if(env.BOT_GROUP_REPLY)return send(env,id,'Open Mr. Charm privately to enter invitation details.',{inline_keyboard:[[{text:'Continue privately',url:'https://t.me/'+s.bot_username+'?start='+cmd}]]});
   await q(env,'INSERT INTO bot_conversations VALUES(?1,?2,?3,?4) ON CONFLICT(telegram_id) DO UPDATE SET state=excluded.state,json=excluded.json,updated_at=excluded.updated_at',id,cmd,'{}',now()).run();
   return send(env,id,cmd==='admin_invite'?'Enter the recipient’s name or Telegram numeric ID followed by the duration in minutes. Example: John Smith 60.':'Enter the invitation ID from Recent room invitations.',keyboard([['Cancel','admin']]));
  }
 }
 if(cmd==='user_commands'||cmd.startsWith('menu:'))return commandMenu(env,id,cmd,s);
 if(Object.hasOwn(LINK_INSTRUCTIONS,cmd)){
  const admin=await currentTelegramAdmin(env,id,s,telegram);
  if(cmd!=='linking:user'&&!admin)return send(env,id,'Only current group admins can open these instructions.',keyboard([['🔗 Account Linking','linking:user'],['🏠 Main menu','help']]));
  const options=[['👤 Link My User Account','linking:user']];
  if(admin)options.push(['🛡 Administrator Linking','linking:admin'],['🤝 Helping Another User','linking:assist'],['📋 Web Panel & Recovery','linking:panel']);
  return send(env,id,LINK_INSTRUCTIONS[cmd],keyboard([...options,['↩ Account Help','account'],['🏠 Main menu','help']]));
 }
 if(cmd==='help')return help(env,id,s);
 if(cmd==='website'){const website=await websiteConfig(env);return send(env,id,'🌐 Charming MediaLab website\nDownload the app, read installation steps and find account help.',{inline_keyboard:[[{text:'🌐 Open website',url:website.url}],[{text:'↩ Main menu',callback_data:'help'}]]});}
 if(['account','token','downloads'].includes(cmd)||cmd.startsWith('issue:')||cmd==='troubleshooting'){
  if(!await authorizedMember(env,id,s))return send(env,id,'Member access required. Your join request must be approved and you must still be in the Charming MediaLab group.');
 }
 if(cmd==='account'||cmd==='token')return account(env,id,s,cmd==='token');
 if(cmd==='downloads'){
  if(!s.downloads_enabled)return send(env,id,'A new Charming MediaLab download is being prepared. Please check back shortly.');
  const codes=(s.download_codes||[{label:'Primary',code:'2977459',enabled:true}]).filter(c=>c.enabled&&c.code.trim());
  if(!codes.length&&!s.download_url)return send(env,id,'The download is currently unavailable. Please contact an Admin.');
  await event(env,id,'downloads_viewed');
  return send(env,id,'Download Charming MediaLab'+(s.app_version?' · '+s.app_version:'')+'\n\nOpen the Downloader app and enter:\n'+codes.map(c=>(c.label||'Downloader code')+': '+c.code).join('\n')+'\n\nFollow the download and installation prompts. Your personal invitation token is separate.',s.download_url?{inline_keyboard:[[{text:'Download Charming MediaLab',url:s.download_url}]]}:undefined);
 }
 if(cmd==='contact')return contact(env,id,s);
 if(/^contact-admin:[1-9]\d{4,19}$/.test(cmd))return contact(env,id,s,cmd.slice(14));
 if(cmd==='troubleshooting')return troubleshooting(env,id);
 if(cmd.startsWith('issue:')){
  const topic=cmd.slice(6);if(!topics.includes(topic))return;
  await q(env,"INSERT INTO bot_conversations VALUES(?1,'device',?2,?3) ON CONFLICT(telegram_id) DO UPDATE SET state='device',json=excluded.json,updated_at=excluded.updated_at",id,JSON.stringify({topic}),now()).run();return send(env,id,env.BOT_GROUP_REPLY?'What device are you using? Choose a button below.':'What device are you using? Please type its name and model.',env.BOT_GROUP_REPLY?keyboard(['Fire TV / Fire Stick','Onn box','Android TV / Google TV','Android phone / tablet','Other / Not sure'].map(d=>[d,'answer:'+d])):undefined);
 }
 if(cmd==='faq')return send(env,id,'Your invitation is for one registration. After registration, sign in with your username and password. Do not share your invitation or account. Your connection allowance is simultaneous logins, not permanently registered devices. Admins can review expired or disabled accounts. Use Forgot Password in the app, then privately approve the request with your linked Telegram account. Enter the new password only in the app. Mr. Charm never reveals or asks for your password.');
 if(['guide','rules','whats_new','status','about','app_help'].includes(cmd))return show(env,id,cmd,s);
 return help(env,id,s);
}
export async function handleUpdate(env,u,s){
 if(u.chat_join_request){const j=u.chat_join_request;if(String(j.chat.id)!==s.group_id||j.from.is_bot)return;
  if(await handleGroupJoinRequest(env,u,s))return;
  await member(env,j.from,'pending');await q(env,'UPDATE bot_members SET requested_at=?1 WHERE telegram_id=?2',j.date,String(j.from.id)).run();await event(env,String(j.from.id),'join_requested');
  const c=await content(env,'waiting');if(c.enabled&&c.body.trim()){
   try{await send(env,j.user_chat_id,c.body,activate(s));}catch(e){if(![400,403].includes(e.telegramCode))throw e;await event(env,String(j.from.id),'waiting_dm_unavailable','Temporary Telegram contact window unavailable');}
  }return;
 }
 if(u.chat_member){const j=u.chat_member;if(String(j.chat.id)!==s.group_id||j.new_chat_member.user.is_bot)return;
  await recordGroupAdmission(env,j);
  const id=String(j.new_chat_member.user.id),live=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(id)});
  await member(env,live.user,live.status==='restricted'&&live.is_member?'restricted_member':live.status);
  await event(env,id,'membership_changed',live.status);
  if(isMember(live)&&!isMember(j.old_chat_member)){
   await q(env,'UPDATE bot_members SET joined_at=?1 WHERE telegram_id=?2',j.date,id).run();await assignToken(env,id,s);
   const c=await content(env,'welcome');if(c.enabled&&c.body.trim())await send({...env,BOT_GROUP_REPLY:{chat_id:s.group_id,user_id:id}},id,c.body.replaceAll('{name}',live.user.first_name),groupHelp());
  }return;
 }
 const cb=u.callback_query,m=cb?.message||u.message,user=cb?.from||m?.from;
 if(!m||!user||user.is_bot||m.sender_chat)return;
 const privateChat=m.chat.type==='private';if(!privateChat&&String(m.chat.id)!==s.group_id)return;
 if(privateChat&&String(m.chat.id)!==String(user.id))return;
 if(cb)await telegram(env,'answerCallbackQuery',{callback_query_id:cb.id});
 const text=u.message?.text||'';if(!privateChat&&!cb&&!/\bmr\.?\s*charm\b/i.test(text)&&!/^\/help(?:@\w+)?(?:\s|$)/i.test(text))return;
 const id=String(user.id);await member(env,user);
 env={...env,BOT_INTERACTION:{recipient:id,generation:crypto.randomUUID()},BOT_CALLBACK_MESSAGE:privateChat&&cb?m.message_id:null};
 if(cb&&m.receiver_user&&String(m.receiver_user.id)!==id)return;
 if(!privateChat)env={...env,BOT_GROUP_REPLY:{chat_id:s.group_id,user_id:id,callback_query_id:cb?.id,message_thread_id:m.message_thread_id}};
 const window=Math.floor(now()/60);
 await q(env,'INSERT INTO bot_rate VALUES(?1,?2,1) ON CONFLICT(telegram_id) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window',id,window).run();
 if((await q(env,'SELECT count FROM bot_rate WHERE telegram_id=?1',id).first()).count>12){
  await event(env,id,'command_rate_limited',privateChat?'private':'group');
  if(cb)await telegram(env,'answerCallbackQuery',{callback_query_id:cb.id,text:'Please wait until the next minute, then try again.',show_alert:true});
  return;
 }
 if(privateChat)await q(env,'UPDATE bot_members SET dm_started=1 WHERE telegram_id=?1',id).run();
 const start=text.match(/^\/start(?:@\w+)?\s+(admin_\w+|manage_\w+|notify_update|usage|website_release|update_report)$/i);
 const cmd=cb?.data||start?.[1]||intent(text);
 if((['help','admin','user_commands'].includes(cmd)||cmd.startsWith('menu:'))&&(text.startsWith('/')||/mr\.?\s*charm/i.test(text)||cb))await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();
 try{
  if(await moderation(env,id,text,cmd,s,m,u.update_id,telegram,send))return;
  const joke=!cb&&banterReply(text);
  if(joke)return await sendHumor(env,id,joke,send);
  if(Object.hasOwn(LINK_INSTRUCTIONS,cmd)){await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();return await handleCommand(env,id,cmd,s);}
  if((cb||exactCommand(text)||/^\s*mr\.?\s*charm\s*$/i.test(text))&&(['help','admin','user_commands'].includes(cmd)||cmd.startsWith('menu:')))return await handleCommand(env,id,cmd,s);
  if(cmd==='usage'||cmd.startsWith('usage:')||cmd==='website_release'||cmd==='update_report'){
   await event(env,id,'usage_requested',(privateChat?'private':'group')+' '+(cb?'button':'text'));
   await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();
   const result=await handleCommand(env,id,cmd,s);
   await event(env,id,'usage_delivered',privateChat?'private':'group');return result;
  }
  if(await accountManagement(env,id,text,cmd,s,m))return;
  if(await botAnnouncementFlow(env,id,text,cmd,s))return;
  if(await accountFlow(env,id,text,cmd,s))return;
  if(privateChat&&text&&!/^(\/|.*mr\.?\s*charm)/i.test(text)){
   const draft=await q(env,'SELECT * FROM bot_conversations WHERE telegram_id=?1',id).first();
   if(draft&&['admin_invite','admin_revoke'].includes(draft.state)){
    await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();
    if(now()-draft.updated_at>600)return send(env,id,'This admin action expired. Open Admin tools to start again.');
    return await inviteCommand(env,id,'Mr Charm '+(draft.state==='admin_invite'?'Invite ':'Revoke ')+text,m,s,u.update_id);
   }
  }
  if(/^\s*mr\.?\s*charm\s+(?:invites?|revoke)\b/i.test(text))return await inviteCommand(env,id,text,m,s,u.update_id);
  if(cmd.startsWith('answer:')){
   if(!await authorizedMember(env,id,s))return send(env,id,'Member access required. Please contact an Admin.');
   if(await conversation(env,id,'',cb?.data))return;
  }else if(privateChat&&text&&!/^(\/|.*mr\.?\s*charm)/i.test(text)){if(await conversation(env,id,text,cb?.data))return;}
  if(!cb&&cmd==='help'&&addressedText(text)&&!exactCommand(text))return await sendHumor(env,id,pick(UNKNOWN_REPLIES),send);
  await handleCommand(env,id,cmd,s);
 }catch(e){
  if(e.status&&e.status<500&&!e.telegramCode)return send(env,id,e.message,keyboard([['Help','help']]));
  if(!privateChat&&[400,403].includes(e.telegramCode)){
   await event(env,id,'group_private_reply_unavailable',(e.telegramMethod||'unknown')+' '+String(e.telegramCode));
   // A delivery failure must never disclose even the fallback response to the group.
   if(cb)await telegram(env,'answerCallbackQuery',{callback_query_id:cb.id,text:'Open Mr. Charm privately and press Start, then repeat your request.',show_alert:true});
   else try{await send({...env,BOT_GROUP_REPLY:undefined},id,'Open this private assistant and press Start, then repeat your request.',activate(s));}catch(fallback){if(![400,403].includes(fallback.telegramCode))throw fallback;}
  }else if(e.telegramCode===403){await q(env,'UPDATE bot_members SET dm_started=0 WHERE telegram_id=?1',id).run();await event(env,id,'private_chat_activation_needed');}
  else throw e;
 }
}
export async function webhook(request,env){
 const supplied=request.headers.get('X-Telegram-Bot-Api-Secret-Token')||'';
 if(!env.TELEGRAM_WEBHOOK_SECRET||supplied.length!==env.TELEGRAM_WEBHOOK_SECRET.length||Array.from(supplied).reduce((n,c,i)=>n|(c.charCodeAt(0)^env.TELEGRAM_WEBHOOK_SECRET.charCodeAt(i)),0))return new Response('Forbidden',{status:403});
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 const raw=await request.text();if(raw.length>100000)return new Response('Too large',{status:413});
 let u;try{u=JSON.parse(raw);}catch{return new Response('Bad request',{status:400});}
 if(!Number.isSafeInteger(u.update_id))return new Response('Bad update',{status:400});
 const s=await settings(env);if(!s.enabled)return new Response('OK');
 const r=await q(env,"INSERT INTO bot_updates VALUES(?1,'processing',?2) ON CONFLICT(id) DO UPDATE SET status='processing',updated_at=excluded.updated_at WHERE bot_updates.status='failed' OR (bot_updates.status='processing' AND bot_updates.updated_at<?2-60)",u.update_id,now()).run();
 if(!r.meta.changes)return new Response('OK');
 try{await handleUpdate(env,u,s);await q(env,"UPDATE bot_updates SET status='done' WHERE id=?1",u.update_id).run();return new Response('OK');}
 catch(e){await q(env,"UPDATE bot_updates SET status='failed',updated_at=?2 WHERE id=?1",u.update_id,now()).run();await event(env,null,'telegram_error',e.telegramCode?String(e.telegramCode):'delivery_or_service_error');return new Response('Retry later',{status:503});}
}
export async function botScheduled(env){
 if(!env.TELEGRAM_BOT_TOKEN)return;
 await cleanExpiredResponses(env);
 const s=await settings(env);
 await maintainGroupInvites(env,s.enabled);
 if(s.enabled)await migrateCommandMenus(env,s,telegram);
 if(!s.enabled)return;
 await queueWebsitePost(env,s);
 for(const job of await rows(env,"SELECT * FROM bot_jobs WHERE status='pending' AND due_at<=?1 ORDER BY id LIMIT 20",now())){
  const claimed=await q(env,"UPDATE bot_jobs SET status='sending' WHERE id=?1 AND status='pending'",job.id).run();if(!claimed.meta.changes)continue;
  try{const result=job.kind==='delete'?await telegram(env,'deleteMessage',{chat_id:job.chat_id,message_id:job.message_id}):await send(env,job.chat_id,job.body);
   await q(env,"UPDATE bot_jobs SET status='sent',message_id=COALESCE(?1,message_id) WHERE id=?2",result?.message_id||null,job.id).run();
  }catch(e){await q(env,"UPDATE bot_jobs SET status='failed',error=?1 WHERE id=?2",e.message,job.id).run();}
 }
 await runRecurring(env,s,send,telegram);
 await env.DB.batch([q(env,'DELETE FROM bot_updates WHERE updated_at<?1',now()-7*86400),q(env,'DELETE FROM bot_rate WHERE window<?1',Math.floor(now()/60)-60),q(env,'DELETE FROM bot_conversations WHERE updated_at<?1',now()-86400),q(env,"UPDATE bot_jobs SET status='failed',error='Delivery interrupted. Check the group before sending again.' WHERE status='sending' AND due_at<?1",now()-300)]);
}
