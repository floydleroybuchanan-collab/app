import {q,rows,now,fail,event} from './bot-store.js';
import {telegram,isMember} from './bot-telegram.js';

const get=(env,id)=>q(env,'SELECT * FROM bot_group_invites WHERE id=?1',id).first();
const identity=value=>{
 const id=String(value??'').trim();
 if(!/^[1-9][0-9]{0,15}$/.test(id)||!Number.isSafeInteger(Number(id)))fail('Enter a valid numeric Telegram user ID.');
 return id;
};
async function eligible(env,id){
 const m=await q(env,`SELECT m.blocked,u.status,u.expires_at FROM bot_members m LEFT JOIN users u ON u.id=m.account_id WHERE m.telegram_id=?1`,id).first();
 return !m||!m.blocked&&(!m.status||m.status==='active'&&(m.expires_at===null||m.expires_at>now()));
}
async function lock(env,id){
 const token=crypto.randomUUID();
 const r=await q(env,'UPDATE bot_group_invites SET lease_token=?1,lease_until=?2 WHERE id=?3 AND lease_until<=?4',token,now()+90,id,now()).run();
 if(!r.meta.changes)fail('This invite is being processed. Refresh and retry shortly.',409);
 return token;
}
const unlock=(env,id,token)=>q(env,'UPDATE bot_group_invites SET lease_token=NULL,lease_until=0 WHERE id=?1 AND lease_token=?2',id,token).run();
async function alertAdmins(env,s,invite,requester){
 // A bot may DM only admins who previously started it. The panel remains the
 // reliable review queue; this is a prompt notification, never a substitute.
 const configured=await rows(env,'SELECT telegram_id FROM bot_support_admins WHERE enabled=1');
 let administrators=[];
 try{administrators=await telegram(env,'getChatAdministrators',{chat_id:s.group_id});}catch{await event(env,null,'group_invite_alert_lookup_failed',invite.id);return;}
 const permitted=administrators.filter(a=>!a.user.is_bot&&(!configured.length||configured.some(p=>p.telegram_id===String(a.user.id))));
 const started=await rows(env,`SELECT telegram_id FROM bot_members WHERE dm_started=1 AND telegram_id IN (${permitted.map(()=>'?').join(',')||"''"})`,...permitted.map(a=>String(a.user.id)));
 const text='CharmIPTV invite request waiting for approval\n\nRecipient: '+invite.recipient_label+'\nRequester: '+requester.telegram_id+(requester.username?' (@'+requester.username+')':'')+'\n\nOpen Mr. Charm → Group Invites in the panel to verify and approve or revoke it.';
 for(const admin of started){
  try{await telegram(env,'sendMessage',{chat_id:Number(admin.telegram_id),text});await event(env,requester.telegram_id,'group_invite_admin_alerted',invite.id,admin.telegram_id);}
  catch{await event(env,requester.telegram_id,'group_invite_admin_alert_failed',invite.id,admin.telegram_id);}
 }
}
async function revokeLink(env,invite){
 if(!invite.invite_link)return;
 try{
  if(!invite.revoked_at){
   await telegram(env,'revokeChatInviteLink',{chat_id:invite.group_id,invite_link:invite.invite_link});
   await q(env,'UPDATE bot_group_invites SET revoked_at=?1,last_error=NULL WHERE id=?2',now(),invite.id).run();
  }
  // Telegram link revocation does not settle requests already waiting. Decline
  // the remaining requesters explicitly; never discard their audit records.
  const waiting=await rows(env,"SELECT DISTINCT telegram_id FROM bot_group_invite_attempts WHERE invite_id=?1 AND outcome IN ('waiting','received','approving')",invite.id);
  for(const requester of waiting){
   await telegram(env,'declineChatJoinRequest',{chat_id:invite.group_id,user_id:Number(requester.telegram_id)});
   await q(env,"UPDATE bot_group_invite_attempts SET outcome='denied',processed_at=?1 WHERE invite_id=?2 AND telegram_id=?3 AND outcome IN ('waiting','received','approving')",now(),invite.id,requester.telegram_id).run();
  }
  await q(env,'UPDATE bot_group_invites SET last_error=NULL WHERE id=?1',invite.id).run();
 }catch(e){
  // Do not treat generic Telegram 400/403 responses as proof of revocation.
  await q(env,'UPDATE bot_group_invites SET last_error=?1 WHERE id=?2','Link revocation or pending-request rejection needs retry. Check bot Invite Users permission.',invite.id).run();
  throw e;
 }
}
export async function createGroupInvite(env,s,body,admin,requestKey=null){
 if(!s.enabled||!s.group_id)fail('Enable and connect the bot before creating group invites.');
 if(body.approved!==true)fail('Approve the recipient before creating their group invite.');
 const tid=body.telegram_id===undefined||body.telegram_id===null||String(body.telegram_id).trim()===''?null:identity(body.telegram_id),username=String(body.username||'').trim().replace(/^@/,'');
 const label=String(body.recipient_label||'New member').trim();if(!label||label.length>100)fail('Use a recipient label of 1–100 characters.');
 if(username&&!/^[a-zA-Z0-9_]{1,32}$/.test(username))fail('Enter a Telegram username without spaces, or leave it blank.');
 const expires=body.expires_at??null;
 if(expires!==null&&(!Number.isSafeInteger(expires)||expires<now()+60||expires>now()+365*86400))fail('Expiration must be at least one minute and no more than one year from now.');
 if(tid&&!await eligible(env,tid))fail('This member is blocked or their linked app account is inactive.',409);
 if(requestKey){const existing=await q(env,'SELECT * FROM bot_group_invites WHERE request_key=?1',requestKey).first();if(existing){if(existing.invite_link)return existing;fail('This command already started creating an invite. Check Group Invites before requesting another.',409);}}
 const id=crypto.randomUUID(),token=crypto.randomUUID();
 const inserted=await q(env,`INSERT OR IGNORE INTO bot_group_invites(id,group_id,telegram_id,username,created_by,created_at,expires_at,status,lease_token,lease_until,approval_mode,recipient_label,request_key) VALUES(?1,?2,?3,?4,?5,?6,?7,'creating',?8,?9,'manual',?10,?11)`,id,s.group_id,tid,username,admin,now(),expires,token,now()+90,label,requestKey).run();
 if(!inserted.meta.changes)fail('This user already has an active or processing invite. View or revoke it before creating another.',409);
 try{
  const link=await telegram(env,'createChatInviteLink',{chat_id:s.group_id,name:'charm:'+id.slice(0,26),creates_join_request:true,...(expires===null?{}:{expire_date:expires})});
  if(!link.invite_link||!link.creates_join_request)throw new Error('Telegram did not return a join-request link.');
  await q(env,"UPDATE bot_group_invites SET invite_link=?1,status='active' WHERE id=?2",link.invite_link,id).run();
  await event(env,tid,'group_invite_created',id,admin);
  return await get(env,id);
 }catch(e){
  // A timeout can leave an undelivered link at Telegram. Named unknown links are
  // always denied by handleGroupJoinRequest; never retry creation automatically.
  await q(env,"UPDATE bot_group_invites SET status=CASE WHEN invite_link IS NULL THEN 'failed' ELSE status END,last_error='Creation interrupted. Refresh before retrying.' WHERE id=?1",id).run();
  throw e;
 }finally{await unlock(env,id,token);}
}
export async function revokeGroupInvite(env,id,admin){
 if(!await get(env,id))fail('Invite not found.',404);
 const token=await lock(env,id);
 try{
  const invite=await get(env,id);if(!invite)fail('Invite not found.',404);
  if(invite.status==='creating')fail('Creation is still processing. Refresh shortly.',409);
  if(invite.status==='approving'){
   const live=await telegram(env,'getChatMember',{chat_id:invite.group_id,user_id:Number(invite.telegram_id)});
   if(isMember(live)){try{await finishAdmission(env,invite);}catch{}return await get(env,id);}
  }
  await q(env,"UPDATE bot_group_invites SET status=CASE WHEN status IN ('used','expired','failed') THEN status ELSE 'revoked' END WHERE id=?1",id).run();
  await event(env,invite.telegram_id,'group_invite_revoked',id,admin);
  // The local denial takes effect even if Telegram is temporarily unavailable.
  try{await revokeLink(env,await get(env,id));}catch{}
  return await get(env,id);
 }finally{await unlock(env,id,token);}
}
async function finishAdmission(env,invite){
 await q(env,"UPDATE bot_group_invites SET status='used',used_at=COALESCE(used_at,?1),used_by=telegram_id,last_error=NULL WHERE id=?2",now(),invite.id).run();
 await q(env,"UPDATE bot_group_invite_attempts SET outcome='approved',processed_at=?1 WHERE invite_id=?2 AND telegram_id=?3 AND outcome='approving'",now(),invite.id,invite.telegram_id).run();
 await revokeLink(env,await get(env,invite.id));
}
async function resumeAdmission(env,invite,allowApproval=true){
 const live=await telegram(env,'getChatMember',{chat_id:invite.group_id,user_id:Number(invite.telegram_id)});
 if(isMember(live)){await finishAdmission(env,invite);return;}
 if(!await eligible(env,invite.telegram_id)||invite.expires_at!==null&&invite.expires_at<=now()){
  await q(env,"UPDATE bot_group_invites SET status=?1 WHERE id=?2",invite.expires_at!==null&&invite.expires_at<=now()?'expired':'revoked',invite.id).run();
  await telegram(env,'declineChatJoinRequest',{chat_id:invite.group_id,user_id:Number(invite.telegram_id)});
  await q(env,"UPDATE bot_group_invite_attempts SET outcome='denied',processed_at=?1 WHERE invite_id=?2 AND outcome='approving'",now(),invite.id).run();
  await revokeLink(env,await get(env,invite.id));return;
 }
 if(!allowApproval)return;
 // Persist 'approving' before calling Telegram. A lost success response is
 // reconciled with getChatMember on the next webhook or scheduled retry.
 await telegram(env,'approveChatJoinRequest',{chat_id:invite.group_id,user_id:Number(invite.telegram_id)});
 await finishAdmission(env,invite);
}
export async function handleGroupJoinRequest(env,u,s){
 const j=u.chat_join_request,link=j.invite_link?.invite_link;
 const invite=link?await q(env,'SELECT * FROM bot_group_invites WHERE group_id=?1 AND invite_link=?2',s.group_id,link).first():null;
 if(!invite){
  if(j.invite_link?.name?.startsWith('charm:')){await telegram(env,'declineChatJoinRequest',{chat_id:s.group_id,user_id:j.from.id});return true;}
  return false; // Preserve existing human approval for unmanaged group links.
 }
 const tid=String(j.from.id),uid=u.update_id;
 if(!Number.isSafeInteger(uid))fail('Missing Telegram update ID.');
 await q(env,`INSERT OR IGNORE INTO bot_group_invite_attempts(invite_id,update_id,telegram_id,username,requested_at,outcome) VALUES(?1,?2,?3,?4,?5,'received')`,invite.id,uid,tid,j.from.username||'',j.date).run();
 const attempt=await q(env,'SELECT * FROM bot_group_invite_attempts WHERE invite_id=?1 AND update_id=?2',invite.id,uid).first();
 if(['approved','denied'].includes(attempt.outcome))return true;
 const token=await lock(env,invite.id);
 try{
  const current=await get(env,invite.id);
  if(tid===current.telegram_id&&current.status==='approving'){await resumeAdmission(env,current);return true;}
  const allowed=(!current.telegram_id||tid===current.telegram_id)&&['active','pending'].includes(current.status)&&(current.expires_at===null||current.expires_at>now())&&await eligible(env,tid);
  if(!allowed){
   await telegram(env,'declineChatJoinRequest',{chat_id:s.group_id,user_id:j.from.id});
   await q(env,"UPDATE bot_group_invite_attempts SET outcome='denied',processed_at=?1 WHERE id=?2",now(),attempt.id).run();
   await event(env,tid,'group_invite_denied',invite.id);
   return true;
  }
  await env.DB.batch([
   q(env,"UPDATE bot_group_invites SET status='pending',request_at=COALESCE(request_at,?1) WHERE id=?2",j.date,invite.id),
   q(env,"UPDATE bot_group_invite_attempts SET outcome='waiting',processed_at=?1 WHERE id=?2",now(),attempt.id)
  ]);
  await event(env,tid,'group_invite_awaiting_admin',invite.id);
  await alertAdmins(env,s,current,{telegram_id:tid,username:j.from.username||''});
  return false; // Existing waiting message; no admission or account allocation.
 }finally{await unlock(env,invite.id,token);}
}
export async function approveGroupInvite(env,s,id,admin,recipient){
 if(!s.enabled)fail('Enable the bot before approving a group invite.');
 if(!await get(env,id))fail('Invite not found.',404);
 const token=await lock(env,id);
 try{
  const invite=await get(env,id);
  if(invite.group_id!==s.group_id||!['pending','approving'].includes(invite.status))fail('This invite has no pending join request.',409);
  const tid=identity(recipient||invite.telegram_id);
  if(invite.telegram_id&&invite.telegram_id!==tid)fail('This link belongs to a different Telegram user.',409);
  const attempt=await q(env,"SELECT * FROM bot_group_invite_attempts WHERE invite_id=?1 AND telegram_id=?2 AND outcome IN ('waiting','approving') ORDER BY id DESC LIMIT 1",id,tid).first();
  if(!attempt)fail('Select a recorded pending requester for this link.',409);
  if(invite.expires_at!==null&&invite.expires_at<=now()||!await eligible(env,tid))fail('This invite has expired or the recipient is blocked.',409);
  await env.DB.batch([
   q(env,"UPDATE bot_group_invites SET status='approving',telegram_id=?2,used_username=?3,request_at=?4 WHERE id=?1",id,tid,attempt.username,attempt.requested_at),
   q(env,"UPDATE bot_group_invite_attempts SET outcome='approving' WHERE invite_id=?1 AND telegram_id=?2 AND outcome='waiting'",id,tid)
  ]);
  await event(env,tid,'group_invite_admin_approved',id,admin);
  await resumeAdmission(env,await get(env,id));
  return await get(env,id);
 }finally{await unlock(env,id,token);}
}
export async function recordGroupAdmission(env,j){
 if(!isMember(j.new_chat_member)||isMember(j.old_chat_member))return;
 const tid=String(j.new_chat_member.user.id);
 let matched=await rows(env,`SELECT * FROM bot_group_invites WHERE group_id=?1 AND ((invite_link=?3 AND (telegram_id IS NULL OR telegram_id=?2)) OR (telegram_id=?2 AND status IN ('approving','used') AND request_at<=?4 AND joined_at IS NULL))`,String(j.chat.id),tid,j.invite_link?.invite_link||'',j.date);
 if(!matched.length&&!j.invite_link&&j.via_join_request){
  const candidates=await rows(env,`SELECT DISTINCT i.* FROM bot_group_invites i JOIN bot_group_invite_attempts a ON a.invite_id=i.id WHERE i.group_id=?1 AND i.status='pending' AND a.telegram_id=?2 AND a.outcome='waiting' AND a.requested_at<=?3`,String(j.chat.id),tid,j.date);
  if(candidates.length===1)matched=candidates;
  else if(candidates.length>1)await event(env,tid,'group_invite_join_ambiguous','Telegram omitted the invite link; review pending invites.');
 }
 for(const invite of matched){
  await env.DB.batch([
   q(env,`UPDATE bot_group_invites SET telegram_id=?2,username=?3,joined_at=COALESCE(joined_at,?1),used_at=COALESCE(used_at,?1),used_by=?2,used_username=?3,status='used' WHERE id=?4`,j.date,tid,j.new_chat_member.user.username||'',invite.id),
   q(env,"UPDATE bot_group_invite_attempts SET outcome='approved',processed_at=?1 WHERE invite_id=?2 AND telegram_id=?3 AND outcome IN ('waiting','approving')",now(),invite.id,tid)
  ]);
  await revokeLink(env,await get(env,invite.id));
 }
}
export async function maintainGroupInvites(env,allowApproval=true){
 // Cleanup also runs while the bot is paused: disabled admission must not stop
 // revocation of previously used or administratively canceled links.
 await q(env,"UPDATE bot_group_invites SET status='expired' WHERE status IN ('active','pending') AND expires_at<=?1 AND lease_until<=?1",now()).run();
 await q(env,"UPDATE bot_group_invites SET status='failed',last_error='Creation interrupted; no link was delivered.' WHERE status='creating' AND lease_until<=?1",now()).run();
 const pending=await rows(env,`SELECT * FROM bot_group_invites WHERE lease_until<=?1 AND (status='approving' OR (status IN ('used','revoked','expired') AND invite_link IS NOT NULL AND (revoked_at IS NULL OR EXISTS(SELECT 1 FROM bot_group_invite_attempts a WHERE a.invite_id=bot_group_invites.id AND a.outcome IN ('waiting','received','approving'))))) ORDER BY last_attempt_at,created_at LIMIT 30`,now());
 for(const invite of pending){
  let token;
  try{token=await lock(env,invite.id);await q(env,'UPDATE bot_group_invites SET last_attempt_at=?1 WHERE id=?2',now(),invite.id).run();const current=await get(env,invite.id);if(current.status==='approving')await resumeAdmission(env,current,allowApproval);else await revokeLink(env,current);}
  catch{await q(env,"UPDATE bot_group_invites SET last_error='Telegram action pending. Check connection and Invite Users permission; automatic retry scheduled.' WHERE id=?1",invite.id).run();}
  finally{if(token)await unlock(env,invite.id,token);}
 }
}
