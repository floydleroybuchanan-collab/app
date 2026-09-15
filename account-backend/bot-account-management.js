import {BOT_COMMANDS} from './bot-command-catalog.js';
import {ACCOUNT_COMMANDS,ADMIN_ACCOUNT_COMMANDS} from './bot-account-commands.js';
import {q,rows,now,fail,event} from './bot-store.js';
import {send,telegram} from './bot-telegram.js';
import {currentTelegramAdmin} from './bot-commands.js';
import {handleAdminRequest,resolveAdminAccess} from './admin-service.js';
import {accountAdminHelpers} from './worker.js';
const buttons=items=>({inline_keyboard:items.map(([text,callback_data])=>[{text,callback_data}])});
const date=value=>value?new Date(value*1000).toISOString().slice(0,16).replace('T',' ')+' UTC':'No expiration';
const save=(env,id,state,data)=>q(env,'INSERT INTO bot_conversations VALUES(?1,?2,?3,?4) ON CONFLICT(telegram_id) DO UPDATE SET state=excluded.state,json=excluded.json,updated_at=excluded.updated_at',id,state,JSON.stringify(data),now()).run();
const clear=(env,id)=>q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();
const summary=user=>`${user.username}\nStatus: ${user.status==='active'&&user.expires_at&&user.expires_at<=now()?'expired':user.status}\nExpires: ${date(user.expires_at)}\nLogin limit: ${user.max_sessions}\nTelegram: ${user.telegram_id?`${user.telegram_username?'@'+user.telegram_username+' · ':''}${user.telegram_id}`:'Not linked'}`;
async function linkedUser(env,id){
 const m=await q(env,'SELECT * FROM bot_members WHERE telegram_id=?1',id).first();
 if(!m?.account_id||m.blocked)fail('No verified app account is linked. In the app, use Settings → Account → Link Telegram. For a forgotten password, use the Admin-assisted recovery option.',403);
 const user=await q(env,'SELECT * FROM users WHERE id=?1',m.account_id).first();
 if(!user)fail('The linked account is unavailable.',404);
 return {...user,telegram_id:id,telegram_username:m.username};
}
async function adminApi(env,id,s){
 if(!await currentTelegramAdmin(env,id,s,telegram))fail('Only current group admins can access these commands.',403);
 const user=await linkedUser(env,id);
 if(user.role!=='admin'||user.status!=='active')fail('Link your authorized panel administrator account through the app first. Group membership alone does not grant account-management permissions.',403);
 const auth=await resolveAdminAccess(env,user);
 const call=async(path,method='GET',body)=>{
  const response=await handleAdminRequest(new Request('https://internal'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),env,{...accountAdminHelpers(),requireUser:async()=>({ok:true,user})});
  const result=await response.json();if(!response.ok||!result.success)fail(result.error||'The action could not be completed.',response.status);return result;
 };
 return {call,auth};
}
async function resolveUser(call,identifier){
 const found=await call('/admin/users?search='+encodeURIComponent(identifier.replace(/^@/,''))+'&page_size=100');
 const needle=identifier.replace(/^@/,'').toLowerCase();
 const matches=found.users.filter(u=>[u.username,u.telegram_id,u.telegram_username].some(v=>String(v||'').toLowerCase()===needle));
 if(matches.length!==1)fail(matches.length?'Multiple accounts match. Use the exact app username.':'No account in your permitted scope matches that identifier.',404);
 return (await call('/admin/users/'+matches[0].id)).user;
}
async function selfAction(env,id,command,confirmed=false){
 if(command==='invite_status'){
  const invite=await q(env,'SELECT i.status,i.expires_at,i.redeemed_at FROM invites i JOIN bot_members m ON m.invite_id=i.id WHERE m.telegram_id=?1 AND m.blocked=0',id).first();
  return send(env,id,invite?`Invitation: ${invite.status==='unused'&&invite.expires_at&&invite.expires_at<=now()?'expired':invite.status}\nUnused code expiry: ${date(invite.expires_at)}${invite.redeemed_at?'\nRedeemed: '+date(invite.redeemed_at):''}`:'No available bot invitation is associated with your Telegram account.');
 }
 const user=await linkedUser(env,id),t=now();
 if(command==='sign_out_all'||command==='unlink_my_account'){
  if(!confirmed){await save(env,id,'self:confirm',{command,userId:user.id});return send(env,id,command==='sign_out_all'?'Sign out every app session? You will need your app password to sign in again.':'Remove your Telegram recovery link? Automatic password recovery will stop. Make sure you know your app password. Linking again requires proof of account ownership.',buttons([['Confirm','self:confirm'],['Cancel','self:cancel']]));}
  if(command==='sign_out_all')await q(env,'UPDATE sessions SET revoked=1 WHERE user_id=?1',user.id).run();
  else{
   const key='unlink-cooldown:'+user.id,previous=await q(env,'SELECT value FROM bot_runtime WHERE key=?1',key).first();
   if(previous&&Number(previous.value)>t-86400)fail('Telegram unlinking is limited to once every 24 hours.',429);
   await env.DB.batch([q(env,'UPDATE bot_members SET account_id=NULL,ever_assigned=1 WHERE telegram_id=?1 AND account_id=?2',id,user.id),q(env,"UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND status IN('waiting','approved')",user.id),q(env,'INSERT INTO bot_runtime(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,String(t))]);
  }
  await accountAdminHelpers().audit(env,user.id,null,command,null);await event(env,id,command,user.id);
  return send(env,id,command==='sign_out_all'?'All app sessions have been signed out.':'Telegram recovery was unlinked. Your app account still exists.');
 }
 if(command==='my_sessions'){
  const count=await q(env,'SELECT COUNT(*) n FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?2',user.id,t).first();
  return send(env,id,`${user.username}\nActive sessions: ${count.n}\nLogin limit: ${user.max_sessions}`,buttons([['Sign out all','sign_out_all'],['User Commands','help']]));
 }
 if(command==='my_security'){
  const reset=await q(env,'SELECT completed_at FROM account_reset_cooldown WHERE user_id=?1',user.id).first();
  return send(env,id,`${user.username}\nVerified Telegram ID: ${id}\nLast self-service reset: ${reset?date(reset.completed_at):'None recorded'}\nReset requests: up to three per hour. One successful self-service reset per 24 hours. Your password is entered only in the app.`,buttons([['User Commands','help']]));
 }
 return send(env,id,summary(user),buttons([['Sessions','my_sessions'],['Security','my_security'],['User Commands','help']]));
}

export async function accountManagement(env,id,text,cmd,s,message){
 const raw=text.replace(/^\/start(?:@\w+)?\s+manage_/,'/').replace(/^mr\.?\s*charm\s*/i,'').replace(/^\//,'').replace(/^([a-z_]+)@\w+\b/i,'$1').trim();
 const self=ACCOUNT_COMMANDS.find(c=>cmd===c.id||raw.toLowerCase()===c.phrase);
 const canonical=c=>(BOT_COMMANDS.find(x=>x.id===c.id)?.phrase||c.phrase).toLowerCase();
 let command=ADMIN_ACCOUNT_COMMANDS.find(c=>raw.toLowerCase()===canonical(c)||raw.toLowerCase().startsWith(canonical(c)+' ')||cmd===c.id||raw.toLowerCase()===c.command||raw.toLowerCase()===c.phrase||raw.toLowerCase().startsWith(c.phrase+' ')||raw.toLowerCase().startsWith(c.command+' '));
 if(self&&!command?.usage){await selfAction(env,id,self.id);return true;}
 if(self&&raw.toLowerCase()===self.phrase){await selfAction(env,id,self.id);return true;}
 const state=await q(env,'SELECT * FROM bot_conversations WHERE telegram_id=?1',id).first();
 if(cmd==='self:cancel'||cmd==='manage:cancel'){await clear(env,id);await send(env,id,'Canceled.',buttons([['User Commands','help']]));return true;}
 if(cmd==='self:confirm'){
  if(!state||state.state!=='self:confirm'||state.updated_at<now()-600)fail('This confirmation expired. Start again.',409);
  const data=JSON.parse(state.json);if((await linkedUser(env,id)).id!==data.userId)fail('Your account link changed. Start again.',409);
  await clear(env,id);await selfAction(env,id,data.command,true);return true;
 }
 let args=command?[canonical(command),command.phrase,command.command].filter(prefix=>raw.toLowerCase().startsWith(prefix+' ')).map(prefix=>raw.slice(prefix.length).trim())[0]||'':'';
 if(cmd==='manage:confirm'){
  if(!state||state.state!=='manage:confirm'||state.updated_at<now()-600)fail('This confirmation expired. Start again.',409);
  const data=JSON.parse(state.json),api=await adminApi(env,id,s);
  const claimed=await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1 AND state=?2 AND json=?3',id,state.state,state.json).run();if(!claimed.meta.changes)fail('This action was already handled.',409);
  if(data.targetId)await api.call('/admin/users/'+data.targetId);
  if(data.custom==='link'){
   if(!api.auth.isOwner&&!api.auth.profile.can_reset_password)fail('Account recovery permission is required.',403);
   const member=await q(env,'SELECT account_id,blocked FROM bot_members WHERE telegram_id=?1',data.telegramId).first();
   if(!member||member.blocked||member.account_id&&member.account_id!==data.targetId)fail('The target Telegram identity is unavailable or already linked.',409);
   const live=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(data.telegramId)});if(!['member','administrator','creator'].includes(live.status)&&!(live.status==='restricted'&&live.is_member))fail('The target must be an approved room member.',403);
   // Reassign atomically only while the destination is still eligible. The
   // unique account link index also rejects competing Telegram identities.
   const changed=await env.DB.batch([q(env,'UPDATE bot_members SET account_id=NULL WHERE account_id=?1 AND telegram_id<>?2 AND EXISTS(SELECT 1 FROM bot_members m WHERE m.telegram_id=?2 AND m.blocked=0 AND (m.account_id IS NULL OR m.account_id=?1))',data.targetId,data.telegramId),q(env,'UPDATE bot_members SET account_id=?1,ever_assigned=1,updated_at=?3 WHERE telegram_id=?2 AND blocked=0 AND (account_id IS NULL OR account_id=?1)',data.targetId,data.telegramId,now()),q(env,"UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND status IN('waiting','approved') AND EXISTS(SELECT 1 FROM bot_members m WHERE m.telegram_id=?2 AND m.account_id=?1)",data.targetId,data.telegramId),q(env,'UPDATE sessions SET revoked=1 WHERE user_id=?1 AND EXISTS(SELECT 1 FROM bot_members m WHERE m.telegram_id=?2 AND m.account_id=?1)',data.targetId,data.telegramId)]);
   if(!changed[1].meta.changes)fail('The Telegram link changed. Start again.',409);
  }else if(data.custom==='unlink'){
   if(!api.auth.isOwner&&!api.auth.profile.can_reset_password)fail('Account recovery permission is required.',403);
   await env.DB.batch([q(env,'UPDATE bot_members SET account_id=NULL,ever_assigned=1 WHERE account_id=?1',data.targetId),q(env,"UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND status IN('waiting','approved')",data.targetId)]);
  }else {
   const result=await api.call(data.path,data.method,data.body);
   if(result.invite?.invite_code)await send(env,id,'New app invitation: '+result.invite.invite_code+'\nShare it privately with its intended recipient.');
  }
  await accountAdminHelpers().audit(env,data.targetId||null,api.auth.user.id,'telegram_admin_'+data.command,JSON.stringify({telegram_id:id,admin_username:api.auth.user.username,target:data.targetId||data.path,result:'completed'}));
  await event(env,id,'admin_action_completed',data.command+':'+(data.targetId||data.path),api.auth.user.id);
  await send(env,id,'Completed: '+data.label,buttons([['Admin Commands','admin']]));return true;
 }
 if(!command&&state?.state==='manage:input'&&text&&!/^(mr\.?\s*charm|\/)/i.test(text)){
  if(state.updated_at<now()-600){await clear(env,id);fail('This admin request expired. Start again.',409);}
  const data=JSON.parse(state.json);command=ADMIN_ACCOUNT_COMMANDS.find(c=>c.id===data.command);args=text.trim();
 }
 if(!command)return false;
 const {call,auth}=await adminApi(env,id,s);
 if(command.command==='userinfo'&&message.reply_to_message?.from)args=String(message.reply_to_message.from.id);
 if(['link_account','relink_account'].includes(command.command)&&message.reply_to_message?.from&&args&&!/\s/.test(args))args+=' '+message.reply_to_message.from.id;
 const readOnly=['userinfo','search_user','user_status','user_sessions','invite_info','recent_users','recent_links','user_audit','bot_status','bot_stats'].includes(command.command);
 if(env.BOT_GROUP_REPLY&&(!readOnly||command.usage&&!args)){
  // Preserve the replied-to permanent identity without posting it publicly.
  if(args)await save(env,id,'manage:resume',{command:command.id,args});
  await send(env,id,'Continue privately to use '+command.label+'.',{inline_keyboard:[[{text:'Open private Admin Commands',url:'https://t.me/'+s.bot_username+'?start='+command.id}]]});return true;
 }
 if(!env.BOT_GROUP_REPLY&&!args&&state?.state==='manage:resume'&&state.updated_at>=now()-600){const saved=JSON.parse(state.json);if(saved.command===command.id)args=saved.args;}
 if(command.usage&&!args){await save(env,id,'manage:input',{command:command.id});await send(env,id,`${command.label}\nUsage: ${BOT_COMMANDS.find(x=>x.id===command.id)?.label||("Mr Charm "+command.phrase)} ${command.usage}\nEnter ${command.usage} now. Never send passwords.`,buttons([['Cancel','manage:cancel']]));return true;}
 await clear(env,id);
 const parts=args.split(/\s+/),name=parts[0],extra=parts.slice(1).join(' '),key=command.command;
 let action=null;
 if(key==='recent_users'||key==='search_user'){
  const data=await call('/admin/users?page_size=10&search='+encodeURIComponent(key==='search_user'?args:''));
  await send(env,id,data.users.length?data.users.map(summary).join('\n\n'):'No accounts in your permitted scope match.');return true;
 }
 if(key==='bot_stats'){const data=await call('/admin/dashboard');await send(env,id,'Account statistics\n'+JSON.stringify(data.stats||data,null,2).slice(0,3000));return true;}
 if(key==='bot_status'){await send(env,id,`Mr. Charm: ${s.enabled?'Enabled':'Disabled'}\nAccount requests: ${s.accounts_enabled?'Enabled':'Paused'}\nDownloads: ${s.downloads_enabled?'Enabled':'Paused'}\nPersonal replies expire after ten minutes.`);return true;}
 if(key==='recent_links'){
  const data=await call('/admin/users?page_size=100');const allowed=new Set(data.users.map(u=>u.id));
  const links=await rows(env,'SELECT account_id,telegram_id,username,updated_at FROM bot_members WHERE account_id IS NOT NULL ORDER BY updated_at DESC LIMIT 100');
  await send(env,id,links.filter(l=>allowed.has(l.account_id)).slice(0,15).map(l=>`${data.users.find(u=>u.id===l.account_id).username} · @${l.username||'no_username'} · ${l.telegram_id}`).join('\n')||'No linked accounts in the current account list.');return true;
 }
 if(key==='create_app_invite')action={path:'/admin/invites',method:'POST',body:{account_duration_days:Number(name),max_sessions:Number(extra),invite_expires_days:7}};
 else if(key==='invite_info'||key==='cancel_invite'){
  const data=await call('/admin/invites?search='+encodeURIComponent(name));const invite=data.invites.find(i=>i.invite_code===name.toUpperCase());if(!invite)fail('Invitation not found in your permitted scope.',404);
  if(key==='invite_info'){await send(env,id,`Invitation ${invite.invite_code}\nStatus: ${invite.status}\nExpires: ${date(invite.expires_at)}\nLogin limit: ${invite.max_sessions}`);return true;}
  action={path:'/admin/invites/'+invite.id+'/revoke',method:'POST',body:{}};
 }else{
  const user=await resolveUser(call,name),base='/admin/users/'+user.id;
  if(['userinfo','user_status'].includes(key)){await send(env,id,summary(user));return true;}
  if(key==='user_sessions'){const count=await q(env,'SELECT COUNT(*) n FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?2',user.id,now()).first();await send(env,id,`${user.username}\nActive sessions: ${count.n}\nLogin limit: ${user.max_sessions}`);return true;}
  if(key==='user_audit'){
   if(!auth.isOwner&&!auth.profile.can_view_audit)fail('Audit permission is required.',403);
   const events=await rows(env,'SELECT action,created_at FROM audit_log WHERE user_id=?1 ORDER BY id DESC LIMIT 15',user.id);await send(env,id,user.username+'\n'+events.map(e=>date(e.created_at)+' · '+e.action).join('\n'));return true;
  }
  if(key==='reset_user_password'){await send(env,id,`For ${user.username}: open Users → Manage → Verified account recovery in the private admin panel. Verify ownership and enter your admin password there. Give the one-time recovery code only to the verified owner; they set their new password in the app. Never type passwords into Telegram.`,{inline_keyboard:[[{text:'Open admin panel',url:'https://charmiptv-admin.agentleakage.workers.dev'}]]});return true;}
  action={targetId:user.id,path:base,method:'PATCH',body:{}};
  if(['signout_user','revoke_sessions'].includes(key))Object.assign(action,{path:base+'/logout',method:'POST'});
  else if(['disable_account','enable_account'].includes(key))action.body={status:key==='disable_account'?'disabled':'active'};
  else if(key==='delete_account')Object.assign(action,{method:'DELETE',body:{confirmation:user.username}});
  else if(key==='extend_user')action.body={extend_days:Number(extra)};
  else if(key==='set_limit')action.body={max_sessions:Number(extra)};
  else if(key==='set_expiration'){if(!/^\d{4}-\d{2}-\d{2}$/.test(extra))fail('Use YYYY-MM-DD.');action.body={expires_at:Math.floor(Date.parse(extra+'T23:59:59Z')/1000)};}
  else if(['ban_user','unban_user'].includes(key)){if(!user.telegram_id)fail('This account has no verified Telegram link.');Object.assign(action,{path:'/admin/bot/members/'+user.telegram_id,method:'PATCH',body:{action:key==='ban_user'?'ban_both':'unban_both'}});}
  else if(key==='unlink_account')action.custom='unlink';
  else if(key==='link_account'||key==='relink_account'){
   if(!/^\d{5,20}$/.test(extra))fail('Supply the permanent Telegram numeric ID after the app username, or reply to that member in the room.');
   if(key==='link_account'&&user.telegram_id)fail('This account is linked already. Use Relink after verifying ownership.');
   const target=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(extra)});
   if(target.user?.is_bot)fail('An app account must belong to a person.');
   action.custom='link';action.telegramId=extra;action.identity=[target.user?.first_name,target.user?.last_name,target.user?.username?'@'+target.user.username:'',extra].filter(Boolean).join(' · ');
  }
  else fail('This admin action is unavailable.');
 }
 const label=command.label+' · '+(args||''),data={...action,command:key,label};
 await save(env,id,'manage:confirm',data);
 await send(env,id,`Confirm ${label}?\n${action.custom?'Confirm only after verifying that this Telegram identity belongs to the app account owner.\n':''}${action.identity?'Telegram: '+action.identity+'\n':''}${key==='delete_account'?'This permanently deletes account data.\n':''}Change: ${JSON.stringify(action.body)}\nThis confirmation expires in ten minutes.`,buttons([['Confirm','manage:confirm'],['Cancel','manage:cancel']]));return true;
}
