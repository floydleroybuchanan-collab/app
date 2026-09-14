import {now,q,rows,settings,fail,event} from './bot-store.js';

export const securityHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
const shortCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>'23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[b%31]).join('');
const active=user=>user&&user.status==='active'&&(user.expires_at===null||user.expires_at>now());
export async function issueRecoveryGrant(env,user,actor,reason){
 if(!active(user)||user.role!=='user')fail('Recovery is available only for active viewer accounts.',403);
 if(typeof reason!=='string'||reason.trim().length<15||reason.length>500)fail('Record how you verified the account owner (15–500 characters).');
 const raw=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(),id=crypto.randomUUID(),t=now();
 await env.DB.batch([
  q(env,'UPDATE account_recovery_grants SET expires_at=?1 WHERE user_id=?2 AND used_at IS NULL',t,user.id),
  q(env,'INSERT INTO account_recovery_grants(id,user_id,token_hash,created_by,reason,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7)',id,user.id,await securityHash(raw),actor,reason.trim(),t,t+3600)
 ]);
 await event(env,null,'verified_recovery_issued',user.id,actor);
 return {code:raw.match(/.{1,6}/g).join('-'),expires_at:t+3600};
}

async function limit(env,key,max,seconds){
 const hashed=await securityHash(key),window=Math.floor(now()/seconds);
 const result=await q(env,`INSERT INTO account_security_rate VALUES(?1,?2,1) ON CONFLICT(rate_key) DO UPDATE SET
 count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window
 WHERE window<>excluded.window OR count<?3`,hashed,window,max).run();
 if(!result.meta.changes)fail('Too many attempts. Please try again later.',429);
}

export async function loadChallenge(env,token){
 if(typeof token!=='string'||!/^[a-f0-9]{48}$/.test(token))fail('This request is unavailable. Start again in the app.',404);
 const c=await q(env,'SELECT * FROM account_challenges WHERE token_hash=?1',await securityHash(token)).first();
 if(!c)fail('This request is unavailable. Start again in the app.',404);
 if(c.expires_at<=now())fail('This request expired. Start again in the app.',410);
 return c;
}

export async function securityApi(request,env,helpers){
 const {json,safeJson,requireUser,verifyPassword,hashPassword,audit}=helpers;
 const path=new URL(request.url).pathname;
 if(path==='/auth/registration-policy'&&request.method==='POST'){
  const body=await safeJson(request),code=String(body.invite_code||'').trim().toUpperCase();
  await limit(env,'registration-policy:'+(request.headers.get('CF-Connecting-IP')||'local'),30,600);
  const linked=await q(env,'SELECT m.telegram_id FROM bot_members m JOIN invites i ON i.id=m.invite_id WHERE i.invite_code=?1',code).first();
  return json({success:true,requires_telegram_approval:!!linked});
 }
 if(path==='/auth/community'&&request.method==='GET'){
  const s=await settings(env),link=await q(env,"SELECT value FROM bot_runtime WHERE key='community_join_request_link'").first();
  return json({success:true,bot_username:s.bot_username,bot_url:'https://t.me/'+s.bot_username,community_url:link?.value||null});
 }
 if(path==='/me/password'&&request.method==='POST'){
  const auth=await requireUser(request,env);if(!auth.ok)return auth.response;
  await limit(env,'password:'+auth.user.id,5,3600);
  const body=await safeJson(request),password=String(body.new_password||'');
  if(password.length<(auth.user.role==='admin'?12:8)||password.length>256)fail('Choose a longer password, up to 256 characters.');
  if(!await verifyPassword(String(body.current_password||''),auth.user.password_hash))fail('The current password is incorrect.',403);
  const changed=await env.DB.batch([
   q(env,'UPDATE users SET password_hash=?1 WHERE id=?2 AND password_hash=?3',await hashPassword(password),auth.user.id,auth.user.password_hash),
   q(env,'UPDATE sessions SET revoked=1 WHERE user_id=?1 AND id<>?2',auth.user.id,auth.session.id),
   q(env,"UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND kind='reset' AND status IN('waiting','approved')",auth.user.id)
  ]);
  if(!changed[0].meta.changes)fail('Your account changed. Sign in again.',409);
  await audit(env,auth.user.id,null,'password_changed',null);
  return json({success:true,message:'Password changed. Other app sessions were signed out.'});
 }
 if(path==='/me/security'&&request.method==='GET'){
  const auth=await requireUser(request,env);if(!auth.ok)return auth.response;
  const link=await q(env,'SELECT telegram_id,username,name FROM bot_members WHERE account_id=?1',auth.user.id).first();
  const activity=await rows(env,"SELECT action,created_at FROM audit_log WHERE user_id=?1 AND (action LIKE '%password%' OR action LIKE '%telegram%' OR action='login') ORDER BY created_at DESC LIMIT 20",auth.user.id);
  return json({success:true,telegram:link||null,activity});
 }
 if(path==='/auth/challenges'&&request.method==='POST'){
  const body=await safeJson(request),kind=String(body.kind||'');
  if(!['reset','link','access','registration'].includes(kind))fail('Choose a supported account action.');
  await limit(env,'challenge-ip:'+(request.headers.get('CF-Connecting-IP')||'local'),20,3600);
  let user=null,telegramId=null,payload={},recovery=null;
  if(kind==='reset'){
   const login=String(body.login||'').trim().toLowerCase();if(!login||login.length>254)fail('Enter your username or email.');
   await limit(env,'reset:'+login,3,3600);
   const candidate=await q(env,'SELECT * FROM users WHERE lower(username)=?1 OR lower(email)=?1',login).first();
   if(body.recovery_code){
    const code=String(body.recovery_code).replace(/[-\s]/g,'').toUpperCase();
    recovery=await q(env,'SELECT * FROM account_recovery_grants WHERE token_hash=?1 AND expires_at>?2 AND used_at IS NULL AND challenge_id IS NULL',await securityHash(code),now()).first();
    if(!active(candidate)||!recovery||recovery.user_id!==candidate.id)fail('The recovery code is invalid, expired, or already used.',403);
    user=candidate;payload={recovery_id:recovery.id};
   }
   if(!recovery&&active(candidate)){
    const m=await q(env,'SELECT telegram_id FROM bot_members WHERE account_id=?1 AND blocked=0',candidate.id).first();
    const cooldown=await q(env,'SELECT completed_at FROM account_reset_cooldown WHERE user_id=?1',candidate.id).first();
    if(m&&(!cooldown||cooldown.completed_at<=now()-86400)){user=candidate;telegramId=m.telegram_id;}
   }
  }
  if(kind==='link'){
   const auth=await requireUser(request,env);if(!auth.ok)return auth.response;
   await limit(env,'link:'+auth.user.id,3,3600);
   if(!await verifyPassword(String(body.current_password||''),auth.user.password_hash))fail('The current password is incorrect.',403);
   user=auth.user;
   const existing=await q(env,'SELECT telegram_id FROM bot_members WHERE account_id=?1',user.id).first();
   telegramId=existing?.telegram_id||null;
  }
  if(kind==='registration'){
   const code=String(body.invite_code||'').trim().toUpperCase(),username=String(body.username||'').trim().toLowerCase(),email=String(body.email||'').trim().toLowerCase();
   if(!/^[a-z0-9._-]{3,32}$/.test(username)||!/^\S+@\S+\.\S+$/.test(email))fail('Enter your chosen username and email.');
   await limit(env,'registration:'+code,5,3600);
   const inv=await q(env,'SELECT id,status,expires_at FROM invites WHERE invite_code=?1',code).first();
   if(!inv||inv.status!=='unused'||inv.expires_at!==null&&inv.expires_at<=now())fail('This invitation is unavailable.',409);
   const m=await q(env,'SELECT telegram_id,blocked,account_id FROM bot_members WHERE invite_id=?1',inv.id).first();
   if(!m||m.blocked||m.account_id)fail('This invitation needs an administrator’s review.',409);
   telegramId=m.telegram_id;payload={invite_id:inv.id,username,email};
  }
  const token=secret(),botToken=secret(),code=shortCode(),id=crypto.randomUUID(),t=now();
  const statements=[];
  if(recovery)statements.push(q(env,'UPDATE account_recovery_grants SET challenge_id=?1 WHERE id=?2 AND challenge_id IS NULL AND expires_at>?3',id,recovery.id,t));
  if(user)statements.push(q(env,"UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND kind=?2 AND status IN('waiting','approved')",user.id,kind));
  if(kind==='registration')statements.push(q(env,"UPDATE account_challenges SET status='canceled' WHERE telegram_id=?1 AND kind='registration' AND status IN('waiting','approved')",telegramId));
  statements.push(q(env,`INSERT INTO account_challenges(id,kind,user_id,telegram_id,token_hash,bot_hash,code_hash,payload,created_at,expires_at)
   VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,id,kind,user?.id||null,telegramId,await securityHash(token),await securityHash(botToken),await securityHash(code),JSON.stringify(payload),t,t+600));
  const created=await env.DB.batch(statements);
  if(recovery&&!created[0].meta.changes){await q(env,"UPDATE account_challenges SET status='canceled' WHERE id=?1",id).run();fail('This recovery code was already used. Contact your Admin.',409);}
  const s=await settings(env);
  return json({success:true,token,code:code.slice(0,4)+'-'+code.slice(4),expires_at:t+600,bot_username:s.bot_username,telegram_url:'https://t.me/'+s.bot_username+'?start=flow_'+botToken},201);
 }
 if(path==='/auth/challenges/status'&&request.method==='POST'){
  const body=await safeJson(request),c=await loadChallenge(env,body.token);
  return json({success:true,kind:c.kind,status:c.status,expires_at:c.expires_at});
 }
 if(path==='/auth/challenges/cancel'&&request.method==='POST'){
  const body=await safeJson(request),c=await loadChallenge(env,body.token);
  await q(env,"UPDATE account_challenges SET status='canceled' WHERE id=?1 AND status IN('waiting','approved')",c.id).run();
  return json({success:true});
 }
 if(path==='/auth/reset-password'&&request.method==='POST'){
  const body=await safeJson(request),c=await loadChallenge(env,body.token),password=String(body.new_password||'');
  if(c.kind!=='reset'||c.status!=='approved'||!c.user_id)fail('Approve this reset in your linked Telegram account first.',403);
  const user=await q(env,'SELECT * FROM users WHERE id=?1',c.user_id).first();
  if(!active(user))fail('Account recovery requires administrator assistance.',403);
  if(password.length<(user.role==='admin'?12:8)||password.length>256)fail('Choose a longer password, up to 256 characters.');
  const completion=crypto.randomUUID(),hash=await hashPassword(password),t=now(),recoveryId=JSON.parse(c.payload).recovery_id||null;
  const result=await env.DB.batch([
   q(env,`UPDATE account_challenges SET status='consumed',completion_id=?1 WHERE id=?2 AND kind='reset' AND status='approved' AND expires_at>?3
    AND ((?6 IS NULL AND EXISTS(SELECT 1 FROM bot_members WHERE account_id=?4 AND telegram_id=?5 AND blocked=0)
    AND NOT EXISTS(SELECT 1 FROM account_reset_cooldown WHERE user_id=?4 AND completed_at>?3-86400)) OR
    (?6 IS NOT NULL AND EXISTS(SELECT 1 FROM account_recovery_grants WHERE id=?6 AND user_id=?4 AND challenge_id=?2 AND expires_at>?3 AND used_at IS NULL)
    AND EXISTS(SELECT 1 FROM bot_members WHERE telegram_id=?5 AND blocked=0 AND (account_id IS NULL OR account_id=?4))))`,completion,c.id,t,c.user_id,c.telegram_id,recoveryId),
   q(env,'UPDATE bot_members SET account_id=NULL,blocked=1 WHERE account_id=?1 AND telegram_id<>?2 AND ?3 IS NOT NULL AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?4)',c.user_id,c.telegram_id,recoveryId,completion),
   q(env,'UPDATE bot_members SET account_id=?1,ever_assigned=1 WHERE telegram_id=?2 AND ?3 IS NOT NULL AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?4)',c.user_id,c.telegram_id,recoveryId,completion),
   q(env,'UPDATE account_recovery_grants SET used_at=?1 WHERE id=?2 AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?3)',t,recoveryId,completion),
   q(env,"UPDATE users SET password_hash=?1 WHERE id=?2 AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?3)",hash,c.user_id,completion),
   q(env,'UPDATE sessions SET revoked=1 WHERE user_id=?1 AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?2)',c.user_id,completion),
   q(env,'INSERT INTO account_reset_cooldown SELECT ?1,?2 WHERE EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?3) ON CONFLICT(user_id) DO UPDATE SET completed_at=excluded.completed_at',c.user_id,t,completion),
   q(env,"UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND kind='reset' AND id<>?2 AND status IN('waiting','approved') AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?3)",c.user_id,c.id,completion)
  ]);
  if(!result[0].meta.changes)fail('This reset is no longer available. Start again or contact an Admin.',409);
  await audit(env,c.user_id,null,'password_reset_telegram_approved',null);
  if(recoveryId)await audit(env,c.user_id,null,'telegram_identity_recovered',null);
  return json({success:true,message:'Password reset. Sign in with your new password.'});
 }
 return null;
}

export async function findBotChallenge(env,id,reference){
 await limit(env,'bot-code:'+id,8,600);
 const normalized=reference.replace(/[-\s]/g,'').toUpperCase();
 const c=await q(env,'SELECT * FROM account_challenges WHERE bot_hash=?1 OR code_hash=?2',await securityHash(reference),await securityHash(normalized)).first();
 if(!c||c.expires_at<=now()||!['waiting','approved'].includes(c.status))fail('This request expired or is unavailable. Start again in the app.',410);
 if(c.telegram_id&&c.telegram_id!==id)fail('Open this request using the Telegram account linked to it.',403);
 if(c.kind==='reset'&&!c.user_id)fail('Recovery could not be verified. Contact an Admin for help with legacy or lost Telegram access.',403);
 return c;
}

export async function confirmBotChallenge(env,id,challengeId,approved){
 const c=await q(env,'SELECT * FROM account_challenges WHERE id=?1',challengeId).first();
 if(!c||c.expires_at<=now()||c.status!=='waiting')fail('This request expired or was already handled.',409);
 if(c.telegram_id!==id)fail('This request belongs to another Telegram account.',403);
 const status=approved?'approved':'denied';
 if(approved&&c.kind==='link'){
  const member=await q(env,'SELECT * FROM bot_members WHERE telegram_id=?1',id).first();
  if(!member||member.blocked||member.account_id&&member.account_id!==c.user_id)fail('This Telegram account cannot be linked. Contact an Admin.',409);
  const linked=await q(env,'SELECT telegram_id FROM bot_members WHERE account_id=?1',c.user_id).first();
  if(linked&&linked.telegram_id!==id)fail('A different Telegram account is linked. An Admin must verify recovery.',409);
  const r=await env.DB.batch([
   q(env,"UPDATE account_challenges SET status='approved' WHERE id=?1 AND status='waiting' AND expires_at>?2",c.id,now()),
   q(env,"UPDATE bot_members SET account_id=?1 WHERE telegram_id=?2 AND (account_id IS NULL OR account_id=?1) AND blocked=0 AND EXISTS(SELECT 1 FROM account_challenges WHERE id=?3 AND status='approved')",c.user_id,id,c.id)
  ]);
  if(!r[0].meta.changes||!r[1].meta.changes)fail('The account link changed. Contact an Admin.',409);
  await event(env,id,'telegram_link_verified',c.user_id);
 }else{const changed=await q(env,"UPDATE account_challenges SET status=?1 WHERE id=?2 AND status='waiting' AND expires_at>?3",status,c.id,now()).run();if(!changed.meta.changes)fail('This request was already handled or expired.',409);}
 return {...c,status};
}
