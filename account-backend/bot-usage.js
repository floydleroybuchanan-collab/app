import {adminApi} from './bot-account-management.js';
import {send} from './bot-telegram.js';
const buttons=items=>({inline_keyboard:items.map(([text,callback_data])=>[{text,callback_data}])});
const hours=n=>(Number(n||0)/3600).toFixed(1)+' h';
export async function usageCommand(env,id,cmd,s){
 const {call}=await adminApi(env,id,s);
 if(env.BOT_GROUP_REPLY)return send(env,id,'Open this report privately. Usage information is only available to authorized administrators.',{inline_keyboard:[[{text:'📊 Open private report',url:'https://t.me/'+s.bot_username+'?start='+ (cmd==='website_release'?'website_release':'usage')}]]});
 if(cmd==='website_release'){
  const {release:r}=await call('/admin/bot/release');
  return send(env,id,`🌐 Website release\n${r.version} · Build ${r.build}\n${r.release_date} · ${(r.size_bytes/1000000).toFixed(1)} MB\n${r.title}\n\nPanel → Mr Charm Control Center → App Release → Preview → Publish. Publishing does not send a group announcement.`,{inline_keyboard:[[{text:'Open admin panel',url:'https://charmiptv-admin.agentleakage.workers.dev/'}],[{text:'↩ Admin Commands',callback_data:'admin'}]]});
 }
 const [,section='menu',period='30']=cmd.split(':');
 const {usage:u}=await call('/admin/bot/usage?period='+encodeURIComponent(period));
 const links=[['🟢 Online Now','usage:online:'+period],['🔗 Linked Accounts','usage:links:'+period],['🏆 Top 10 Watch Time','usage:most:'+period],['⌛ Least Watch Time','usage:least:'+period],['📱 Most App Visits','usage:visits:'+period],['🔑 Most App Sign-ins','usage:signins:'+period]];
 let text=`📊 App Usage · ${period==='all'?'All time':period==='1'?'Today (UTC)':period+' days'}\n`;
 if(section==='online'){
  const watching=u.online.filter(x=>x.playing);
  text+=`Online: ${u.online_users} users\nIPTV: ${u.iptv_users} · VOD: ${u.vod_users}\nPlaying: ${new Set(watching.map(x=>x.id)).size}\n\n`+u.online.slice(0,20).map(x=>`${x.username} · ${x.mode.toUpperCase()} · ${x.playing?'playing':'browsing'}`).join('\n');
  if(watching.length){const sorted=[...watching].sort((a,b)=>a.started_at-b.started_at);text+=`\n\nLongest current playback: ${sorted[0].username} (${hours(Date.now()/1000-sorted[0].started_at)})\nNewest current playback: ${sorted.at(-1).username} (${hours(Date.now()/1000-sorted.at(-1).started_at)})`;}
 }else if(section==='links')text+=`Active accounts: ${u.accounts.active_accounts}\nTelegram linked: ${u.accounts.linked_accounts}\nNot linked: ${u.accounts.unlinked_accounts}`;
 else if(['most','least','visits','signins'].includes(section)){const data=u[section];text+=data.length?data.map((x,i)=>`${i+1}. ${x.username} · ${hours(x.watch_seconds)}\nIPTV ${hours(x.iptv_seconds)} · VOD ${hours(x.vod_seconds)} · ${x.visits} app visits · ${x.signins} sign-ins`).join('\n\n'):'No measured playback yet.';}
 else text+='Choose a private report below.';
 text+=`\n\nOnline means a heartbeat within 2 minutes. Rankings include measured playback, not idle menus. Least excludes zero-use accounts. App visits are observed returns after a 2-minute gap, not password logins. Sign-ins count distinct authenticated app sessions first observed since tracking began. Tracking began ${new Date(u.tracking_started_at*1000).toISOString().slice(0,10)}; older builds do not report activity.`;
 return send(env,id,text,buttons([...links,['Today','usage:'+section+':1'],['7 days','usage:'+section+':7'],['30 days','usage:'+section+':30'],['All time','usage:'+section+':all'],['↩ Admin Commands','admin']]));
}
