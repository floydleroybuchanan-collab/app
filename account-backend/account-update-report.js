import {rows,fail,now} from './bot-store.js';
import {appControls} from './app-controls.js';

// Last verified release baseline: RC10 / workflow 197 = Android version code 28.
// A newer version in App Controls advances the report target automatically.
export async function accountUpdateReport(env,auth){
 if(!auth.isOwner&&!auth.profile.can_manage_bot)fail('Reports require bot-management permission.',403);
 const target=Math.max(28,Number((await appControls(env)).update.version_code)||0);
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
  const updated=builds.some(b=>b>=target),old=builds.some(b=>b<target);
  return {...u,status:u.status==='active'&&u.expires_at&&u.expires_at<=t?'expired':u.status,builds,last_build:latest?.build||null,updated,linked:!!u.telegram,classification:!builds.length?'UNKNOWN':updated&&old?'MIXED':updated?'CURRENT OR NEWER':'OLDER ONLY'};
 })};
}
const clean=v=>String(v??'').replace(/[\r\n\t\x00-\x1f\x7f]/g,' ');
const time=t=>t?new Date(t*1000).toISOString():'Never reported';
export function formatAccountUpdateReport(r){
 const groups=[['UPDATED AND LINKED',u=>u.updated&&u.linked],['UPDATED, NOT LINKED',u=>u.updated&&!u.linked],['OLDER ONLY, LINKED',u=>!u.updated&&u.classification==='OLDER ONLY'&&u.linked],['OLDER ONLY, NOT LINKED',u=>!u.updated&&u.classification==='OLDER ONLY'&&!u.linked],['UNKNOWN VERSION, LINKED',u=>!u.builds.length&&u.linked],['UNKNOWN VERSION, NOT LINKED',u=>!u.builds.length&&!u.linked]];
 const lines=['CHARMING MEDIALAB - PRIVATE ADMIN ACCOUNT UPDATE REPORT',`Generated: ${time(r.generated_at)}`,`Scope: ${r.scope}`,`Target Android version code: ${r.target} (NOT the GitHub build number)`,`Accounts: ${r.users.length} | Linked: ${r.users.filter(u=>u.linked).length} | Updated reported: ${r.users.filter(u=>u.updated).length} | Both: ${r.users.filter(u=>u.updated&&u.linked).length}`,'','This is last-reported information, not proof of what is installed now.','MIXED means both older and current/newer versions were reported across retained sessions.','Unknown means no retained app version report; it does not mean outdated.','Session records may disappear on logout/cleanup. No passwords, usable tokens or stream URLs are included.',''];
 for(const [title,predicate] of groups){const users=r.users.filter(predicate);lines.push(`${title} (${users.length})`,'='.repeat(55));for(const u of users)lines.push(`${clean(u.username)} | Account: ${clean(u.status)} | ${u.classification}`,`  Account ID: ${clean(u.id)} | Email: ${clean(u.email)}`,`  Telegram name: ${clean(u.telegram_name)||'Unknown'} | Telegram ID: ${clean(u.telegram_id)||'Not linked'}${u.telegram_blocked?' (blocked)':''}`,`  Invitation ID: ${clean(u.invite_id)||'Not recorded'} | Masked invitation token: ${clean(u.token_reference)||'Not recorded'}`,`  Reported version codes: ${u.builds.join(', ')||'Unknown'} | Most recent: ${u.last_build||'Unknown'}`,`  Last report: ${time(u.last_seen)} | Telegram: ${clean(u.telegram)||'Not linked'}`);if(!users.length)lines.push('None');lines.push('');}
 return '\uFEFF'+lines.join('\r\n');
}
