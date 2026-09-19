import {rows,fail,now} from './bot-store.js';


// Public release confirmed by owner: RC9 / build 196. RC10 / build 197 is testing.
// Do not infer public promotion from an optional update notice.
export async function accountUpdateReport(env,auth){
 if(!auth.isOwner&&!auth.profile.can_manage_bot)fail('Reports require bot-management permission.',403);
 const target=27;
 const scoped=auth.isOwner||auth.profile.can_manage_all;
 const users=await rows(env,`SELECT u.id,u.username,u.email,u.status,u.expires_at,
  (SELECT GROUP_CONCAT(COALESCE(NULLIF(m.username,''),'Telegram ID '||m.telegram_id),', ') FROM bot_members m WHERE m.account_id=u.id AND m.blocked=0) telegram,
  (SELECT m.telegram_id FROM bot_members m WHERE m.account_id=u.id) telegram_id,
  (SELECT m.name FROM bot_members m WHERE m.account_id=u.id) telegram_name,
  (SELECT m.blocked FROM bot_members m WHERE m.account_id=u.id) telegram_blocked,
  (SELECT i.id FROM invites i WHERE i.redeemed_by_user_id=u.id ORDER BY i.redeemed_at DESC LIMIT 1) invite_id,
  (SELECT '****'||substr(i.invite_code,-4) FROM invites i WHERE i.redeemed_by_user_id=u.id ORDER BY i.redeemed_at DESC LIMIT 1) token_reference,
  (SELECT MAX(p.last_seen) FROM app_presence p WHERE p.user_id=u.id) last_seen
  FROM users u WHERE ${scoped?'1=1':'EXISTS(SELECT 1 FROM admin_user_attribution a WHERE a.user_id=u.id AND a.admin_user_id=?1)'} ORDER BY u.username COLLATE NOCASE`,...(scoped?[]:[auth.user.id]));
 const observations=await rows(env,`SELECT p.user_id,p.build,MAX(p.last_seen) last_seen FROM app_presence p JOIN users u ON u.id=p.user_id WHERE ${scoped?'1=1':'EXISTS(SELECT 1 FROM admin_user_attribution a WHERE a.user_id=u.id AND a.admin_user_id=?1)'} GROUP BY p.user_id,p.build`,...(scoped?[]:[auth.user.id]));
 const byUser=new Map();for(const p of observations){if(!byUser.has(p.user_id))byUser.set(p.user_id,[]);byUser.get(p.user_id).push(p);}
 const t=now();
 return {target,generated_at:t,scope:scoped?'All accounts':'Only accounts assigned to this administrator',users:users.map(u=>{
  const seen=byUser.get(u.id)||[],builds=seen.map(p=>p.build).sort((a,b)=>a-b);
  const latest=seen.reduce((best,p)=>!best||p.last_seen>best.last_seen?p:best,null);
  const updated=builds.some(b=>b===27||b===28||b===29),old=builds.some(b=>b<target);
  return {...u,status:u.status==='active'&&u.expires_at&&u.expires_at<=t?'expired':u.status,builds,last_build:latest?.build||null,updated,linked:!!u.telegram,classification:!builds.length?'UNKNOWN':updated&&old?'MIXED':updated?'CURRENT OR NEWER':'OLDER ONLY'};
 })};
}
const clean=v=>String(v??'').replace(/[\r\n\t\x00-\x1f\x7f]/g,' ');
const time=t=>t?new Date(t*1000).toISOString():'Never reported';
export function releaseName(code){
 const older={19:[1,182],20:[2,184],21:[3,185],22:[4,186],23:[5,189],24:[6,190],25:[7,193],26:[8,195]};
 if(older[code]){const [rc,build]=older[code];return `Charming.MediaLab-2.2.0-RC${rc}-Sideload-${build} [OLDER RELEASE; version code ${code}]`;}
 if(code===27)return 'Charming.MediaLab-2.2.0-RC9-Sideload-196 [CURRENT PUBLIC RELEASE]';
 if(code===29)return 'Charming.MediaLab-2.2.0-RC11-Sideload-198 [RELEASE APK - public rollout not yet confirmed]';
 if(code===28)return 'Charming.MediaLab-2.2.0-RC10-Sideload-197 [TEST BUILD]';
 return code?'Android version code '+code+' [exact release/build not mapped]':'Unknown - no app version reported';
}
export function formatAccountUpdateReport(r){
 const groups=[['NEW RELEASE APK REPORTED',u=>u.last_build===29],['TEST BUILD REPORTED',u=>u.last_build===28],['CURRENT PUBLIC RELEASE REPORTED',u=>u.last_build===27],['OLDER VERSION LAST REPORTED',u=>u.last_build&&u.last_build<27],['UNRECOGNIZED NEWER VERSION',u=>u.last_build>29],['UNKNOWN VERSION',u=>!u.last_build]];
 const lines=['CHARMING MEDIALAB - PRIVATE ADMIN ACCOUNT UPDATE REPORT',`Generated: ${time(r.generated_at)}`,`Scope: ${r.scope}`,'','PUBLIC RELEASE: '+releaseName(27),'TESTING ONLY: '+releaseName(28),'RC9 users are up to date. RC10 is not required for public users.','',`Accounts: ${r.users.length}`,`Linked: ${r.users.filter(u=>u.linked).length}`,`Public or test release observed: ${r.users.filter(u=>u.updated).length}`,`Release observed AND linked: ${r.users.filter(u=>u.updated&&u.linked).length}`,'','Versions below are last reported, not proof of what is installed now.',
 'Build names map the reported Android version code to our verified APK records.',
 'Rebuilds sharing a version code cannot be distinguished by older app telemetry.','Multiple versions may come from different devices or older retained sessions.','Unknown means no retained version report; it does not mean outdated.','Session records may disappear on logout/cleanup. No usable credentials are included.',''];
 for(const [title,predicate] of groups){
  const users=r.users.filter(predicate);lines.push('='.repeat(65),`${title} (${users.length})`,'='.repeat(65),'');
  for(const u of users)lines.push(
   `APP LOGIN: ${clean(u.username)}`,
   `Last reported release: ${releaseName(u.last_build)}`,
   `Last report: ${time(u.last_seen)}`,
   `Account status: ${clean(u.status)}`,
   `Telegram linked: ${u.linked?'YES':'NO'}${u.telegram_blocked?' (blocked)':''}`,
   `Public/test release observed AND linked: ${u.updated&&u.linked?'YES':'NO'}`,
   '',
   `Account ID: ${clean(u.id)}`,
   `Email: ${clean(u.email)}`,
   `Telegram name: ${clean(u.telegram_name)||'Not recorded'}`,
   `Telegram username: ${clean(u.telegram)||'Not linked'}`,
   `Telegram ID: ${clean(u.telegram_id)||'Not linked'}`,
   `Invitation ID: ${clean(u.invite_id)||'Not recorded'}`,
   `Masked invitation token: ${clean(u.token_reference)||'Not recorded'}`,
   '',
   'All retained version reports:',
   ...u.builds.map(code=>'  - '+releaseName(code)),
   ...(!u.builds.length?['  No version report available.']:[]),
   '', '-'.repeat(65), '', ''
  );
  if(!users.length)lines.push('None','');
 }
 return '\uFEFF'+lines.join('\r\n');
}
