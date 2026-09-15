import {q,rows,now,fail,event} from './bot-store.js';
export const DEFAULT_WEBSITE='https://charming-medialab.wasmer.app/';
export function validateWebsite(input){
 const n={url:String(input.url||'').trim(),message:String(input.message||'').trim(),enabled:input.enabled,timezone:String(input.timezone||''),time:String(input.time||''),repeat:input.repeat,weekday:Number(input.weekday)};
 let u;try{u=new URL(n.url);}catch{fail('Enter a valid HTTPS website address.');}
 if(u.protocol!=='https:'||u.username||u.password||n.url.length>2048)fail('Use an HTTPS website address without a username or password.');
 if(!n.message||n.message.length>1200)fail('Enter a website message of 1–1,200 characters.');
 if(typeof n.enabled!=='boolean'||!['daily','weekly'].includes(n.repeat)||!Number.isInteger(n.weekday)||n.weekday<0||n.weekday>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(n.time))fail('Choose a valid repeat interval, day and time.');
 try{new Intl.DateTimeFormat('en-US',{timeZone:n.timezone}).format();}catch{fail('Enter a valid timezone, such as America/New_York.');}
 return n;
}
export function nextWebsitePost(n,after){
 if(!n.enabled)return null;
 const format=new Intl.DateTimeFormat('en-US',{timeZone:n.timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const start=Object.fromEntries(format.formatToParts(after*1000).map(p=>[p.type,p.value]));
 const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 // Calendar time, not a fixed 24-hour interval: respects daylight-saving changes.
 for(let t=Math.floor(after/60)*60+60;t<=after+9*86400;t+=60){
  const parts=Object.fromEntries(format.formatToParts(t*1000).map(p=>[p.type,p.value]));
  if(parts.year===start.year&&parts.month===start.month&&parts.day===start.day&&start.hour+':'+start.minute>=n.time)continue;
  if(parts.hour+':'+parts.minute===n.time&&(n.repeat==='daily'||parts.weekday===days[n.weekday]))return t;
 }
 fail('Unable to calculate the next posting time.');
}
export async function websiteConfig(env){const r=await q(env,'SELECT * FROM website_announcements WHERE id=1').first();if(!r)fail('Website announcement setup is not installed.',503);return {...JSON.parse(r.json),revision:r.revision,next_at:r.next_at};}
export const websiteBody=n=>n.message+'\n\n🌐 '+n.url;
export async function websiteAdmin(request,env,auth,helpers,s,path){
 const {json,safeJson}=helpers,current=await websiteConfig(env);
 if(path==='/website'&&request.method==='GET')return json({success:true,website:current,deliveries:await rows(env,"SELECT id,status,due_at,error FROM bot_jobs WHERE kind IN ('website','website_manual') ORDER BY id DESC LIMIT 10")});
 if(path==='/website'&&request.method==='PUT'){
  const b=await safeJson(request),n=validateWebsite(b);if(b.revision!==current.revision)fail('Website settings changed. Refresh and try again.',409);
  if(n.enabled&&(!s.enabled||!s.group_id))fail('Connect and enable Mr Charm before enabling scheduled announcements.');
  const next=nextWebsitePost(n,now());
  const r=await q(env,'UPDATE website_announcements SET json=?1,revision=revision+1,next_at=?2 WHERE id=1 AND revision=?3',JSON.stringify(n),next,current.revision).run();
  if(!r.meta.changes)fail('Website settings changed. Refresh and try again.',409);
  await q(env,"UPDATE bot_jobs SET status='canceled' WHERE kind='website' AND status='pending'").run();
  await event(env,null,'website_settings_saved',n.enabled?'scheduled':'disabled',auth.user.id);
  return json({success:true,website:await websiteConfig(env)});
 }
 if(path==='/website/send'&&request.method==='POST'){
  const b=await safeJson(request);if(b.confirm!==true||b.revision!==current.revision)fail('Preview the saved message and confirm before sending.',409);
  if(!s.enabled||!s.group_id)fail('Connect and enable Mr Charm first.');
  if(!/^[a-f0-9-]{36}$/i.test(b.request_id||''))fail('Refresh the panel before sending.');
  const duplicate=await q(env,'SELECT id FROM bot_jobs WHERE dedupe_key=?1','website:manual:'+b.request_id).first();
  if(duplicate)return json({success:true,queued:true});
  const recent=await q(env,"SELECT id FROM bot_jobs WHERE kind='website_manual' AND due_at>?1 AND status IN ('pending','sending','sent')",now()-60).first();
  if(recent)fail('A website announcement was just queued or sent. Wait one minute before sending another.',429);
  await q(env,"INSERT OR IGNORE INTO bot_jobs(kind,chat_id,body,due_at,dedupe_key) VALUES('website_manual',?1,?2,?3,?4)",s.group_id,websiteBody(current),now(),'website:manual:'+b.request_id).run();
  await event(env,null,'website_announcement_queued','',auth.user.id);return json({success:true,queued:true});
 }
 return json({success:false,error:'Unknown website action.'},404);
}
export async function queueWebsitePost(env,s){
 const n=await websiteConfig(env),t=now();if(!n.enabled||!s.enabled||!s.group_id||!n.next_at||n.next_at>t)return;
 const slot=n.next_at,next=nextWebsitePost(n,t+60);
 // One unique job per scheduled slot, even if cron invocations overlap.
 await env.DB.batch([
  q(env,"INSERT OR IGNORE INTO bot_jobs(kind,chat_id,body,due_at,dedupe_key) SELECT 'website',?1,?2,?3,?4 FROM website_announcements WHERE id=1 AND revision=?5 AND next_at=?6",s.group_id,websiteBody(n),t,'website:'+n.revision+':'+slot,n.revision,slot),
  q(env,'UPDATE website_announcements SET next_at=?1 WHERE id=1 AND revision=?2 AND next_at=?3',next,n.revision,slot)
 ]);
}
