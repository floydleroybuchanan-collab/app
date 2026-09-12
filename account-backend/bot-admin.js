import {brandedContent} from './branding.js';
import {DEFAULT_CONTENT} from './bot-defaults.js';
import {q,rows,settings,content,event,now,fail} from './bot-store.js';
import {telegram} from './bot-telegram.js';
import {createGroupInvite,revokeGroupInvite,approveGroupInvite} from './bot-group-invites.js';
const boolKeys=['enabled','auto_tokens','downloads_enabled','accounts_enabled','reminder_enabled'];
export async function botAdmin(request,env,auth,{json,safeJson}){
 if(!auth.isOwner&&!auth.profile.can_manage_bot)fail('The owner must grant Mr. Charm control access.',403);
 const url=new URL(request.url),path=url.pathname.slice('/admin/bot'.length),method=request.method,id=auth.user.id;
 const s=await settings(env);
 if(path==='/group-invites'&&method==='POST')return json({success:true,invite:await createGroupInvite(env,s,await safeJson(request),id)},201);
 if(path==='/group-invites'&&method==='GET'){
  const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1))),search='%'+String(url.searchParams.get('search')||'').slice(0,100)+'%';
  return json({success:true,page,invites:await rows(env,`SELECT i.*,COUNT(a.id) attempt_count,COUNT(DISTINCT a.telegram_id) requester_count,CASE WHEN i.status IN ('active','pending') AND i.expires_at<=?1 THEN 'expired' ELSE i.status END display_status FROM bot_group_invites i LEFT JOIN bot_group_invite_attempts a ON a.invite_id=i.id WHERE i.telegram_id LIKE ?2 OR i.username LIKE ?2 OR i.recipient_label LIKE ?2 GROUP BY i.id ORDER BY i.created_at DESC,i.id DESC LIMIT 50 OFFSET ?3`,now(),search,(page-1)*50)});
 }
 const gi=path.match(/^\/group-invites\/([a-f0-9-]+)(\/(?:attempts|approve))?$/);
 if(gi&&gi[2]==='/attempts'&&method==='GET')return json({success:true,attempts:await rows(env,'SELECT * FROM bot_group_invite_attempts WHERE invite_id=?1 ORDER BY id DESC LIMIT 100',gi[1])});
 if(gi&&gi[2]==='/approve'&&method==='POST')return json({success:true,invite:await approveGroupInvite(env,s,gi[1],id,(await safeJson(request)).telegram_id)});
 if(gi&&!gi[2]&&method==='DELETE')return json({success:true,invite:await revokeGroupInvite(env,gi[1],id)});
 if(path==='/settings'&&method==='GET')return json({success:true,settings:s,ready:{token:!!env.TELEGRAM_BOT_TOKEN,webhook_secret:!!env.TELEGRAM_WEBHOOK_SECRET}});
 if(path==='/settings'&&method==='PUT'){
  const b=await safeJson(request);if(b.revision!==s.revision)fail('Settings changed. Refresh before saving.',409);
  const n={...s};for(const key of boolKeys){if(typeof b[key]!=='boolean')fail('Invalid '+key);n[key]=b[key];}
  for(const [key,min,max] of [['token_days',1,3650],['connections',1,20],['invite_days',1,365],['reminder_hours',1,24]]){
   if(key==='token_days'&&b[key]===null){n[key]=null;continue;}
   if(!Number.isInteger(b[key])||b[key]<min||b[key]>max)fail('Invalid '+key);n[key]=b[key];
  }
  n.group_id=String(b.group_id||'').trim();n.bot_username=String(b.bot_username||'').replace(/^@/,'').trim();
  if(n.group_id&&!/^-\d{5,20}$/.test(n.group_id))fail('Enter the group numeric ID, starting with a minus sign.');
  if(n.bot_username&&!/^[a-zA-Z0-9_]{5,32}$/.test(n.bot_username))fail('Invalid bot username.');
  if(n.enabled&&(!n.group_id||!n.bot_username||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET))fail('Add bot credentials, username and group before enabling.');
  if(n.enabled){const me=await telegram(env,'getMe',{});if(me.username.toLowerCase()!==n.bot_username.toLowerCase())fail('Username does not match the saved bot token.');const chat=await telegram(env,'getChat',{chat_id:n.group_id});if(!['group','supergroup'].includes(chat.type))fail('Choose the discussion group, not a channel.');const rights=await telegram(env,'getChatMember',{chat_id:n.group_id,user_id:me.id});if(rights.status!=='administrator'||!rights.can_invite_users)fail('Make Mr. Charm a group admin with Invite Users permission.');}
  if(n.group_id!==s.group_id){if(s.enabled)fail('Disable the bot before changing its group.');if((await q(env,'SELECT COUNT(*) n FROM bot_members').first()).n)fail('This group already has linked members. Contact the owner before migrating groups.');}
  if(b.download_codes!==undefined){
   if(!Array.isArray(b.download_codes)||b.download_codes.length!==3)fail('Use three download slots.');
   n.download_codes=b.download_codes.map(c=>{if(typeof c.code!=='string'||!/^\d{0,12}$/.test(c.code.trim())||typeof c.label!=='string'||c.label.length>80||typeof c.enabled!=='boolean')fail('Each downloader code must be digits or blank.');return {code:c.code.trim(),label:c.label.trim(),enabled:c.enabled};});
  }
  n.app_version=String(b.app_version||'').slice(0,80);n.download_url=String(b.download_url||'').trim();
  if(n.download_url){let u;try{u=new URL(n.download_url);}catch{fail('Invalid download link.');}if(u.protocol!=='https:'||u.username||u.password)fail('Use an HTTPS download link without embedded credentials.');}
  delete n.revision;const r=await q(env,'UPDATE bot_settings SET json=?1,revision=revision+1 WHERE id=1 AND revision=?2',JSON.stringify(n),b.revision).run();if(!r.meta.changes)fail('Settings changed. Refresh.',409);
  await event(env,null,'settings_updated','',id);return json({success:true});
 }
 if(path==='/content'&&method==='GET')return json({success:true,content:await Promise.all(Object.keys(DEFAULT_CONTENT).map(k=>content(env,k)))});
 const cm=path.match(/^\/content\/([a-z_]+)(\/history)?$/);
 if(cm){const key=cm[1];if(!Object.hasOwn(DEFAULT_CONTENT,key))fail('Unknown content.');
  if(cm[2]&&method==='GET')return json({success:true,history:(await rows(env,'SELECT * FROM bot_content_history WHERE key=?1 ORDER BY id DESC LIMIT 20',key)).map(brandedContent)});
  if(method==='PUT'&&!cm[2]){
   const b=await safeJson(request),old=await content(env,key);if(b.revision!==old.revision)fail('Content changed. Refresh before saving.',409);
   if(typeof b.body!=='string'||b.body.length>50000||typeof b.enabled!=='boolean')fail('Use text up to 50,000 characters and a valid enabled choice.');
   if(['broadcast','reminder','welcome','waiting','acknowledgment'].includes(key)&&b.body.length>3500)fail('This message must be 3,500 characters or fewer.');
   // Store revision zero defaults first so the optimistic update is transactional.
   await q(env,'INSERT OR IGNORE INTO bot_content VALUES(?1,?2,?3,0,?4,NULL)',key,DEFAULT_CONTENT[key].body,DEFAULT_CONTENT[key].enabled,now()).run();
   const r=await env.DB.batch([
    q(env,'INSERT INTO bot_content_history(key,body,enabled,revision,updated_at,updated_by) SELECT key,body,enabled,revision,updated_at,updated_by FROM bot_content WHERE key=?1 AND revision=?2',key,b.revision),
    q(env,'UPDATE bot_content SET body=?1,enabled=?2,revision=revision+1,updated_at=?3,updated_by=?4 WHERE key=?5 AND revision=?6',b.body,b.enabled&&!!b.body.trim()?1:0,now(),id,key,b.revision)
   ]);if(!r[1].meta.changes)fail('Content changed. Refresh.',409);await event(env,null,'content_updated',key,id);return json({success:true});
  }
 }
 if(path==='/dashboard'&&method==='GET')return json({success:true,members:await q(env,'SELECT COUNT(*) n FROM bot_members').first(),tickets:await q(env,"SELECT COUNT(*) n FROM bot_support WHERE status<>'closed'").first(),analytics:await rows(env,'SELECT action,COUNT(*) n FROM bot_events GROUP BY action ORDER BY n DESC'),jobs:await rows(env,'SELECT * FROM bot_jobs ORDER BY id DESC LIMIT 30')});
 if(path==='/members'&&method==='GET'){
  const page=Math.max(1,Number(url.searchParams.get('page'))||1),search='%'+String(url.searchParams.get('search')||'').slice(0,100)+'%';
  const data=await rows(env,`SELECT m.*,u.username account_username,u.status account_status,u.expires_at,u.max_sessions,i.invite_code,i.status invite_status FROM bot_members m LEFT JOIN users u ON u.id=m.account_id LEFT JOIN invites i ON i.id=m.invite_id WHERE m.telegram_id LIKE ?1 OR m.name LIKE ?1 OR m.username LIKE ?1 OR u.username LIKE ?1 OR i.invite_code LIKE ?1 ORDER BY m.updated_at DESC LIMIT 50 OFFSET ?2`,search,(page-1)*50);
  return json({success:true,members:data,page});
 }
 const mm=path.match(/^\/members\/(\d+)(\/timeline)?$/);
 if(mm){const tid=mm[1];if(mm[2]&&method==='GET')return json({success:true,events:await rows(env,"SELECT action,detail,created_at,admin_id,telegram_id FROM bot_events WHERE telegram_id=?1 UNION ALL SELECT action,'' AS detail,created_at,admin_user_id AS admin_id,?1 AS telegram_id FROM audit_log WHERE user_id=(SELECT account_id FROM bot_members WHERE telegram_id=?1) ORDER BY created_at DESC LIMIT 100",tid)});
  if(method==='PATCH'){
   const b=await safeJson(request),m=await q(env,'SELECT * FROM bot_members WHERE telegram_id=?1',tid).first();if(!m)fail('Member not found.',404);
   if(b.action==='link'){
    const inv=await q(env,'SELECT * FROM invites WHERE invite_code=?1',String(b.invite_code||'').trim().toUpperCase()).first();
    const user=inv?.redeemed_by_user_id?await q(env,'SELECT * FROM users WHERE id=?1',inv.redeemed_by_user_id).first():null;
    if(!inv||user?.role==='admin')fail('Enter a valid viewer invitation code.');
    if(m.invite_id||m.account_id)fail('Unlink the current record first.');
    try{await q(env,'UPDATE bot_members SET invite_id=?1,account_id=?2,ever_assigned=1 WHERE telegram_id=?3',inv.id,inv.redeemed_by_user_id,tid).run();}catch{fail('That invitation or account is already linked.',409);}
   }else if(b.action==='unlink')await q(env,'UPDATE bot_members SET invite_id=NULL,account_id=NULL,ever_assigned=1 WHERE telegram_id=?1',tid).run();
   else if(['block','unblock'].includes(b.action))await q(env,'UPDATE bot_members SET blocked=?1 WHERE telegram_id=?2',b.action==='block'?1:0,tid).run();
   else if(['ban_both','unban_both'].includes(b.action)){
    if(!auth.isOwner&&!auth.profile.can_suspend)fail('Account suspension permission required.',403);
    const banning=b.action==='ban_both';
    if(banning){await env.DB.batch([q(env,'UPDATE bot_members SET blocked=1 WHERE telegram_id=?1',tid),q(env,"UPDATE invites SET status='disabled' WHERE id=?1 AND status='unused'",m.invite_id),q(env,"UPDATE users SET status='disabled' WHERE id=?1 AND role='user'",m.account_id),q(env,'UPDATE sessions SET revoked=1 WHERE user_id=?1',m.account_id)]);try{await telegram(env,'banChatMember',{chat_id:s.group_id,user_id:Number(tid)});}catch(e){await event(env,tid,'ban_partial','App access blocked; Telegram ban failed',id);fail('App access is blocked, but the Telegram ban failed. Check Mr. Charm’s Ban Users permission and try again.',409);}}
    else{await telegram(env,'unbanChatMember',{chat_id:s.group_id,user_id:Number(tid),only_if_banned:true});await env.DB.batch([q(env,'UPDATE bot_members SET blocked=0 WHERE telegram_id=?1',tid),q(env,"UPDATE users SET status='active' WHERE id=?1 AND role='user' AND (expires_at IS NULL OR expires_at>?2)",m.account_id,now())]);}
   }else fail('Unknown action.');
   await event(env,tid,b.action,'',id);return json({success:true});
  }
 }
 if(path==='/support-admins/sync'&&method==='POST'){
  const list=await telegram(env,'getChatAdministrators',{chat_id:s.group_id});
  for(const a of list.filter(a=>!a.user.is_bot))await q(env,'INSERT INTO bot_support_admins(telegram_id,name,username) VALUES(?1,?2,?3) ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name,username=excluded.username',String(a.user.id),[a.user.first_name,a.user.last_name].filter(Boolean).join(' '),a.user.username||'').run();
  await event(env,null,'support_admins_synced','',id);return json({success:true});
 }
 if(path==='/support-admins'&&method==='GET')return json({success:true,admins:await rows(env,'SELECT * FROM bot_support_admins ORDER BY name')});
 const sa=path.match(/^\/support-admins\/(\d+)$/);if(sa&&method==='PATCH'){const b=await safeJson(request);if(typeof b.enabled!=='boolean')fail('Invalid enabled choice.');await q(env,'UPDATE bot_support_admins SET enabled=?1 WHERE telegram_id=?2',b.enabled?1:0,sa[1]).run();await event(env,null,'support_admin_updated',sa[1],id);return json({success:true});}
 if(path==='/support'&&method==='GET')return json({success:true,tickets:await rows(env,'SELECT t.*,m.name,m.username FROM bot_support t LEFT JOIN bot_members m ON m.telegram_id=t.telegram_id ORDER BY t.id DESC LIMIT 100')});
 const st=path.match(/^\/support\/(\d+)$/);if(st&&method==='PATCH'){const b=await safeJson(request);if(!['open','in_progress','closed'].includes(b.status))fail('Invalid ticket status.');await q(env,'UPDATE bot_support SET status=?1,updated_at=?2 WHERE id=?3',b.status,now(),Number(st[1])).run();await event(env,null,'support_updated',st[1],id);return json({success:true});}
 if(path==='/events'&&method==='GET')return json({success:true,events:await rows(env,'SELECT * FROM bot_events ORDER BY id DESC LIMIT 100')});
 if(path==='/broadcast'&&method==='POST'){
  const b=await safeJson(request),c=await content(env,'broadcast');if(!s.enabled||!c.enabled||!c.body.trim())fail('Enable the bot and save an enabled broadcast first.');if(b.revision!==c.revision)fail('Broadcast changed. Preview it again.',409);
  await q(env,"INSERT INTO bot_jobs(kind,chat_id,body,due_at) VALUES('broadcast',?1,?2,?3)",s.group_id,c.body,now()).run();await event(env,null,'broadcast_queued','',id);return json({success:true});
 }
 const job=path.match(/^\/jobs\/(\d+)$/);if(job&&method==='DELETE'){const r=await q(env,"UPDATE bot_jobs SET status='canceled' WHERE id=?1 AND status='pending'",Number(job[1])).run();if(!r.meta.changes)fail('This message already started or finished sending.',409);return json({success:true});}
 if(path==='/connect'&&method==='POST'){
  if(!auth.isOwner)fail('Only the owner can connect Telegram.',403);
  if(!s.enabled)fail('Save and enable valid bot settings first.');
  await telegram(env,'setWebhook',{url:url.origin+'/telegram/webhook',secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query','chat_join_request','chat_member','my_chat_member'],max_connections:1,drop_pending_updates:false});
  await event(env,null,'webhook_connected','',id);return json({success:true});
 }
 if(path==='/discover-groups'&&method==='GET'){
  if(!auth.isOwner)fail('Only the owner can set up the bot.',403);
  if(!env.TELEGRAM_BOT_TOKEN)fail('The bot token is not saved. Save TELEGRAM_BOT_TOKEN as a Cloudflare secret first.');
  try{
   const me=await telegram(env,'getMe',{});
   if(s.bot_username&&me.username.toLowerCase()!==s.bot_username.toLowerCase())fail('The saved token belongs to @'+me.username+', not @'+s.bot_username+'. Save the correct BotFather token.');
   const w=await telegram(env,'getWebhookInfo',{});
   if(w.url){if(s.group_id){const chat=await telegram(env,'getChat',{chat_id:s.group_id});return json({success:true,groups:[{id:String(chat.id),title:chat.title}]});}fail('Telegram is connected to another bot service. Its connection must be reviewed before this panel can discover your group.');}
   const updates=await telegram(env,'getUpdates',{timeout:0,allowed_updates:['message','my_chat_member','chat_member','chat_join_request']});
   const groups=new Map();for(const u of updates){const chat=u.message?.chat||u.my_chat_member?.chat||u.chat_member?.chat||u.chat_join_request?.chat;if(chat&&['group','supergroup'].includes(chat.type))groups.set(String(chat.id),{id:String(chat.id),title:chat.title});}
   const channel=updates.some(u=>(u.my_chat_member?.chat||u.channel_post?.chat)?.type==='channel');
   return json({success:true,groups:[...groups.values()],message:channel?'Telegram detected a broadcast channel. Add Mr. Charm to the discussion group where members can type messages.':'No group found yet. Add @'+me.username+' as an administrator, send /help@'+me.username+' in the group, then click Find my Telegram group again.'});
  }catch(e){
   if(e.telegramCode===401||e.telegramCode===404)fail('Telegram rejected the saved bot token. Copy the full token from BotFather and replace TELEGRAM_BOT_TOKEN in Cloudflare.');
   if(e.telegramCode===409)fail('Another service is checking this bot’s messages. Stop that service, then try Find my Telegram group again.');
   if(e.telegramCode===429)fail('Telegram is temporarily limiting requests. Wait a minute, then try again.');
   if(e.status&&e.status<500)throw e;
   fail('Could not reach Telegram'+(e.telegramCode?' (error '+e.telegramCode+')':'')+'. Please try again; if it continues, tell me this message.');
  }
 }
 if(path==='/connection'&&method==='GET'){const me=await telegram(env,'getMe',{}),w=await telegram(env,'getWebhookInfo',{});return json({success:true,username:me.username,url:w.url,pending:w.pending_update_count,last_error:w.last_error_message||''});}
 fail('Not found.',404);
}
