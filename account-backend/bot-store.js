import { DEFAULT_CONTENT } from './bot-defaults.js';
export const now=()=>Math.floor(Date.now()/1000);
export const q=(env,sql,...v)=>v.length?env.DB.prepare(sql).bind(...v):env.DB.prepare(sql);
export const rows=async(env,sql,...v)=>(await q(env,sql,...v).all()).results||[];
export function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
export async function settings(env){const r=await q(env,'SELECT * FROM bot_settings WHERE id=1').first();return {...JSON.parse(r.json),revision:r.revision};}
export async function content(env,key){return await q(env,'SELECT * FROM bot_content WHERE key=?1',key).first()||{key,...DEFAULT_CONTENT[key],revision:0};}
export async function event(env,id,action,detail='',admin=null){await q(env,'INSERT INTO bot_events(telegram_id,action,detail,admin_id,created_at) VALUES(?1,?2,?3,?4,?5)',id,action,detail,admin,now()).run();}
export async function member(env,user,status=null,date=now()){
 await q(env,`INSERT INTO bot_members(telegram_id,name,username,status,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name,username=excluded.username,status=CASE WHEN ?6 IS NULL THEN bot_members.status ELSE excluded.status END,updated_at=MAX(bot_members.updated_at,excluded.updated_at)`,String(user.id),[user.first_name,user.last_name].filter(Boolean).join(' ').slice(0,200),String(user.username||''),status||'unknown',date,status).run();
 return q(env,'SELECT * FROM bot_members WHERE telegram_id=?1',String(user.id)).first();
}
export async function assignToken(env,id,s){
 const m=await q(env,'SELECT * FROM bot_members WHERE telegram_id=?1',id).first();
 if(!m||m.blocked||!['member','administrator','creator','restricted_member'].includes(m.status))return null;
 if(m.invite_id)return q(env,'SELECT * FROM invites WHERE id=?1',m.invite_id).first();
 if(m.ever_assigned||m.account_id||!s.auto_tokens||!s.accounts_enabled)return null;
 const owner=await q(env,'SELECT user_id FROM admin_owner').first();
 if(!owner)return null;
 const iid=crypto.randomUUID(),code='CHM-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(),t=now();
 // Both statements commit together; repeated/concurrent requests cannot allocate twice.
 await env.DB.batch([
 q(env,`INSERT INTO invites(id,invite_code,account_duration_days,max_sessions,created_by_user_id,created_at,expires_at) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM bot_members WHERE telegram_id=?8 AND ever_assigned=0 AND invite_id IS NULL AND account_id IS NULL AND blocked=0 AND status IN('member','administrator','creator','restricted_member'))`,iid,code,s.token_days,s.connections,owner.user_id,t,t+s.invite_days*86400,id),
 q(env,`UPDATE bot_members SET invite_id=?1,ever_assigned=1 WHERE telegram_id=?2 AND ever_assigned=0 AND EXISTS(SELECT 1 FROM invites WHERE id=?1)`,iid,id),
 q(env,`INSERT INTO bot_events(telegram_id,action,created_at) SELECT ?1,'token_created',?2 WHERE EXISTS(SELECT 1 FROM bot_members WHERE telegram_id=?1 AND invite_id=?3)`,id,t,iid)
 ]);
 return q(env,'SELECT i.* FROM invites i JOIN bot_members m ON m.invite_id=i.id WHERE m.telegram_id=?1',id).first();
}
