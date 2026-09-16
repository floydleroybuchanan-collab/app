import {q,rows,now,fail} from './bot-store.js';
export function usageInput(b){
 if(!['iptv','vod','idle'].includes(b.mode)||typeof b.playing!=='boolean'||!Number.isSafeInteger(b.sequence)||b.sequence<0||!Number.isInteger(b.build)||b.build<1)fail('Invalid activity update.',400);
 if(b.mode==='idle'&&b.playing)fail('Idle activity cannot be playing.',400);
 return b;
}
export async function usageHeartbeat(request,env,auth,{json,safeJson}){
 const b=usageInput(await safeJson(request)),t=now(),day=Math.floor(t/86400)*86400;
 // Every statement runs in one D1 transaction. Duplicate/reordered updates cannot add time twice.
 // Only bounded intervals observed on both sides of a heartbeat count; offline gaps never count.
 const valid='sequence < ?3 AND last_seen >= ?4 AND last_seen < ?5';
 await env.DB.batch([
  ...[day-86400,day].map(bucket=>q(env,`INSERT INTO app_usage_daily(user_id,day,iptv_seconds,vod_seconds,foreground_seconds)
   SELECT user_id,?2,CASE WHEN mode='iptv' AND playing=1 THEN MIN(?5,?2+86400)-MAX(last_seen,?2) ELSE 0 END,
   CASE WHEN mode='vod' AND playing=1 THEN MIN(?5,?2+86400)-MAX(last_seen,?2) ELSE 0 END,
   CASE WHEN mode<>'idle' THEN MIN(?5,?2+86400)-MAX(last_seen,?2) ELSE 0 END
   FROM app_presence WHERE session_id=?1 AND ${valid} AND last_seen<?2+86400 AND ?5>?2
   ON CONFLICT(user_id,day) DO UPDATE SET iptv_seconds=iptv_seconds+excluded.iptv_seconds,vod_seconds=vod_seconds+excluded.vod_seconds,foreground_seconds=foreground_seconds+excluded.foreground_seconds`,auth.session.id,bucket,b.sequence,t-90,t)),
  q(env,`INSERT INTO app_usage_daily(user_id,day,visits) SELECT ?1,?2,1 WHERE ?3<>'idle' AND NOT EXISTS(SELECT 1 FROM app_presence WHERE session_id=?4 AND (last_seen>=?5 OR sequence>=?6))
   ON CONFLICT(user_id,day) DO UPDATE SET visits=visits+1`,auth.user.id,day,b.mode,auth.session.id,t-120,b.sequence),
  q(env,`INSERT INTO app_usage_daily(user_id,day,signins) SELECT ?1,?2,1 WHERE NOT EXISTS(SELECT 1 FROM app_presence WHERE session_id=?3) ON CONFLICT(user_id,day) DO UPDATE SET signins=signins+1`,auth.user.id,day,auth.session.id),
  q(env,`INSERT INTO app_presence(session_id,user_id,sequence,mode,playing,last_seen,started_at,build) VALUES(?1,?2,?3,?4,?5,?6,?6,?7)
   ON CONFLICT(session_id) DO UPDATE SET sequence=excluded.sequence,mode=excluded.mode,playing=excluded.playing,last_seen=excluded.last_seen,
   started_at=CASE WHEN app_presence.last_seen<excluded.last_seen-120 OR app_presence.playing=0 AND excluded.playing=1 THEN excluded.last_seen ELSE app_presence.started_at END,build=excluded.build
   WHERE excluded.sequence>app_presence.sequence`,auth.session.id,auth.user.id,b.sequence,b.mode,b.playing?1:0,t,b.build)
 ]);
 return json({success:true,server_time:t});
}
export async function usageReport(env,auth,period='30'){
 if(!auth.isOwner&&!auth.profile.can_manage_bot)fail('Usage reports require bot-management permission.',403);
 if(!['1','7','30','all'].includes(period))fail('Choose Today, 7 days, 30 days or All time.',400);
 const t=now(),since=period==='all'?0:Math.floor(t/86400)*86400-(Number(period)-1)*86400;
 const scoped=auth.isOwner||auth.profile.can_manage_all;
 const scope=scoped?'1=1':'EXISTS(SELECT 1 FROM admin_user_attribution a WHERE a.user_id=u.id AND a.admin_user_id=?2)';
 const values=scoped?[t]:[t,auth.user.id];
 const accounts=await q(env,`SELECT COUNT(*) active_accounts,SUM(CASE WHEN EXISTS(SELECT 1 FROM bot_members m WHERE m.account_id=u.id AND m.blocked=0) THEN 1 ELSE 0 END) linked_accounts FROM users u WHERE u.status='active' AND (u.expires_at IS NULL OR u.expires_at>?1) AND ${scope}`,...values).first();
 const online=await rows(env,`SELECT u.id,u.username,p.mode,MAX(p.playing) playing,MIN(p.started_at) started_at,MAX(p.build) build FROM app_presence p JOIN users u ON u.id=p.user_id JOIN sessions s ON s.id=p.session_id WHERE p.last_seen>?1-120 AND p.mode<>'idle' AND s.revoked=0 AND s.expires_at>?1 AND u.status='active' AND (u.expires_at IS NULL OR u.expires_at>?1) AND ${scope} GROUP BY u.id,p.mode ORDER BY started_at,u.id`,...values);
 const rankValues=scoped?[since]:[since,auth.user.id];
 const rankBase=`SELECT u.id,u.username,SUM(d.iptv_seconds) iptv_seconds,SUM(d.vod_seconds) vod_seconds,SUM(d.iptv_seconds+d.vod_seconds) watch_seconds,SUM(d.foreground_seconds) foreground_seconds,SUM(d.visits) visits,SUM(d.signins) signins FROM app_usage_daily d JOIN users u ON u.id=d.user_id WHERE d.day>=?1 AND ${scope} GROUP BY u.id HAVING SUM(d.iptv_seconds+d.vod_seconds)>0`;
 const most=await rows(env,rankBase+' ORDER BY watch_seconds DESC,u.id LIMIT 10',...rankValues);
 const least=await rows(env,rankBase+' ORDER BY watch_seconds ASC,u.id LIMIT 10',...rankValues);
 const visits=await rows(env,rankBase+' ORDER BY visits DESC,u.id LIMIT 10',...rankValues);
 const signins=await rows(env,rankBase.replace('HAVING SUM(d.iptv_seconds+d.vod_seconds)>0','HAVING SUM(d.signins)>0')+' ORDER BY signins DESC,u.id LIMIT 10',...rankValues);
 return {period,tracking_started_at:(await q(env,'SELECT started_at FROM app_usage_metadata WHERE id=1').first()).started_at,accounts:{...accounts,linked_accounts:accounts.linked_accounts||0,unlinked_accounts:accounts.active_accounts-(accounts.linked_accounts||0)},online,online_users:new Set(online.map(x=>x.id)).size,iptv_users:new Set(online.filter(x=>x.mode==='iptv').map(x=>x.id)).size,vod_users:new Set(online.filter(x=>x.mode==='vod').map(x=>x.id)).size,most,least,visits,signins};
}
