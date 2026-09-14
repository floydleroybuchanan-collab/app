import {now,q,rows,fail,event} from './bot-store.js';
import {appControls} from './app-controls.js';

const bounded=(value,min,max,label)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(label+' is outside the allowed range.');return value;};
export function validateAnnouncement(body,t=now()){
 const title=String(body.title||'').trim(),message=String(body.message||'').trim(),url=String(body.url||'').trim();
 if(!title||title.length>100||!message||message.length>1200)fail('Enter a title up to 100 characters and message up to 1,200 characters.');
 if(!['update','general'].includes(body.kind)||!['outdated','all','selected'].includes(body.audience))fail('Choose an announcement type and audience.');
 if(url){let parsed;try{parsed=new URL(url);}catch{fail('Enter a valid HTTPS release link.');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||url.length>2048)fail('Use an HTTPS release link without credentials or fragments.');}
 const version=bounded(body.version_code??0,0,2100000000,'Android version code');
 if(body.kind==='update'&&(!version||!url))fail('Updates need the APK version code and a release link.');
 if(body.kind==='general'&&body.audience==='outdated')fail('Choose everyone or selected accounts for a general announcement.');
 const starts=bounded(body.starts_at??t,0,t+90*86400,'Start time'),expires=bounded(body.expires_at??starts+7*86400,starts+60,starts+90*86400,'Expiration');
 const reminder=bounded(body.reminder_hours??24,1,168,'Reminder hours');
 const users=Array.isArray(body.user_ids)?[...new Set(body.user_ids.map(String))]:[];
 if(users.length>200||users.some(id=>!/^[a-zA-Z0-9_-]{1,100}$/.test(id)))fail('Select up to 200 valid accounts.');
 if(body.audience==='selected'&&!users.length)fail('Select at least one account.');
 if(typeof body.sound!=='boolean')fail('Choose whether to play a chime.');
 return {title,message,url,kind:body.kind,audience:body.audience,version_code:version,starts_at:starts,expires_at:expires,reminder_hours:reminder,sound:body.sound,user_ids:body.audience==='selected'?users:[]};
}
const unpack=row=>({...JSON.parse(row.json),id:row.id,status:row.status,revision:row.revision,created_at:row.created_at,updated_at:row.updated_at});
export async function saveAnnouncement(env,body,actor,id=null,revision=null){
 const data=validateAnnouncement(body),t=now();
 if(data.user_ids.length){const count=await q(env,'SELECT COUNT(*) n FROM users WHERE id IN ('+data.user_ids.map(()=>'?').join(',')+')',...data.user_ids).first();if(count.n!==data.user_ids.length)fail('Some selected accounts are no longer available.');}
 if(id){
  const r=await q(env,"UPDATE app_announcements SET json=?1,starts_at=?2,expires_at=?3,revision=revision+1,updated_at=?4 WHERE id=?5 AND revision=?6 AND status='draft'",JSON.stringify(data),data.starts_at,data.expires_at,t,id,revision).run();
  if(!r.meta.changes)fail('This draft changed or was published. Refresh it first.',409);
 }else{id=crypto.randomUUID();await q(env,'INSERT INTO app_announcements(id,json,starts_at,expires_at,created_by,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)',id,JSON.stringify(data),data.starts_at,data.expires_at,actor,t).run();}
 await event(env,null,'app_announcement_draft_saved',id,actor);
 return unpack(await q(env,'SELECT * FROM app_announcements WHERE id=?1',id).first());
}
export async function publishAnnouncement(env,id,revision,actor){
 const r=await q(env,"UPDATE app_announcements SET status='published',revision=revision+1,updated_at=?1 WHERE id=?2 AND revision=?3 AND status='draft' AND expires_at>?1",now(),id,revision).run();
 if(!r.meta.changes)fail('This draft changed, expired, or was already published. Refresh first.',409);
 await event(env,null,'app_announcement_published',id,actor);
 return unpack(await q(env,'SELECT * FROM app_announcements WHERE id=?1',id).first());
}
export async function cancelAnnouncement(env,id,revision,actor){
 const r=await q(env,"UPDATE app_announcements SET status='canceled',revision=revision+1,updated_at=?1 WHERE id=?2 AND revision=?3 AND status<>'canceled'",now(),id,revision).run();
 if(!r.meta.changes)fail('This announcement changed. Refresh first.',409);
 await event(env,null,'app_announcement_canceled',id,actor);
}
export async function activeAnnouncements(env,userId,version){
 const list=await rows(env,"SELECT * FROM app_announcements WHERE status='published' AND starts_at<=?1 AND expires_at>?1 ORDER BY created_at DESC LIMIT 50",now());
 return list.map(unpack).filter(a=>(a.audience!=='selected'||a.user_ids.includes(userId))&&(a.kind!=='update'||version===null||version<a.version_code)).slice(0,10);
}
export async function legacyAnnouncementUpdate(env,userId){
 const active=await activeAnnouncements(env,userId,null),a=active.find(item=>item.kind==='update');
 return a?{version_code:a.version_code,message:a.message.slice(0,500),url:a.url}:null;
}
export async function announcementAdmin(request,env,auth,helpers){
 if(!auth.isOwner&&!auth.profile.can_manage_announcements)fail('Announcement permission is required.',403);
 const {json,safeJson}=helpers,path=new URL(request.url).pathname,actor=auth.user.id;
 if(path==='/admin/announcements/recipients'&&request.method==='GET'){
  const search=(new URL(request.url).searchParams.get('search')||'').trim().slice(0,100);
  if(search.length<2)return json({success:true,users:[]});
  const users=await rows(env,"SELECT id,username,status FROM users WHERE instr(lower(username),lower(?1))>0 ORDER BY username LIMIT 30",search);
  return json({success:true,users});
 }
 if(path==='/admin/announcements'&&request.method==='GET'){
  const list=await rows(env,'SELECT * FROM app_announcements ORDER BY created_at DESC LIMIT 100');
  const reports=await rows(env,'SELECT announcement_id,COUNT(*) checked,SUM(displayed_at IS NOT NULL) displayed,SUM(dismissed_at IS NOT NULL) dismissed,SUM(opened_at IS NOT NULL) opened FROM app_announcement_receipts GROUP BY announcement_id');
  return json({success:true,announcements:list.map(r=>({...unpack(r),report:reports.find(report=>report.announcement_id===r.id)||{checked:0,displayed:0,dismissed:0,opened:0}}))});
 }
 if(path==='/admin/announcements'&&request.method==='POST')return json({success:true,announcement:await saveAnnouncement(env,await safeJson(request),actor)},201);
 const match=path.match(/^\/admin\/announcements\/([a-f0-9-]{36})(?:\/(publish|test))?$/);
 if(!match)fail('Announcement not found.',404);
 const body=await safeJson(request);
 if(match[2]==='publish'&&request.method==='POST')return json({success:true,announcement:await publishAnnouncement(env,match[1],body.revision,actor)});
 if(match[2]==='test'&&request.method==='POST'){
  const row=await q(env,'SELECT * FROM app_announcements WHERE id=?1',match[1]).first();if(!row)fail('Draft not found.',404);
  // A test is a distinct ten-minute notice addressed only to the requesting panel account.
  const source=unpack(row),test=await saveAnnouncement(env,{...source,title:'TEST · '+source.title.slice(0,90),kind:'general',audience:'selected',user_ids:[actor],starts_at:now(),expires_at:now()+600},actor);
  return json({success:true,announcement:await publishAnnouncement(env,test.id,test.revision,actor)});
 }
 if(request.method==='PUT')return json({success:true,announcement:await saveAnnouncement(env,body,actor,match[1],body.revision)});
 if(request.method==='DELETE'){await cancelAnnouncement(env,match[1],body.revision,actor);return json({success:true});}
 fail('Method not allowed.',405);
}
export async function announcementClient(request,env,auth,helpers){
 const {json,safeJson}=helpers,path=new URL(request.url).pathname;
 if(path==='/announcements'&&request.method==='POST'){
  const body=await safeJson(request),version=bounded(body.version_code,1,2100000000,'Installed version'),list=await activeAnnouncements(env,auth.user.id,version);
  if(list.length)await env.DB.batch(list.map(a=>q(env,`INSERT INTO app_announcement_receipts(announcement_id,user_id,session_id,installed_version,checked_at) VALUES(?1,?2,?3,?4,?5)
   ON CONFLICT(announcement_id,session_id) DO UPDATE SET installed_version=excluded.installed_version,checked_at=excluded.checked_at`,a.id,auth.user.id,auth.session.id,version,now())));
  const legacy=(await appControls(env)).update;
  const output=list.map(({user_ids,created_by,...safe})=>safe);
  if(legacy.version_code>version&&legacy.url&&!list.some(a=>a.kind==='update'&&a.version_code===legacy.version_code))output.push({id:'legacy:'+legacy.version_code,title:'Charming MediaLab update available',message:legacy.message,url:legacy.url,version_code:legacy.version_code,kind:'update',expires_at:now()+86400,reminder_hours:24,sound:false});
  return json({success:true,announcements:output});
 }
 if(path==='/announcements/receipt'&&request.method==='POST'){
  const body=await safeJson(request),column={displayed:'displayed_at',dismissed:'dismissed_at',opened:'opened_at'}[body.event];if(!column)fail('Unknown announcement event.');
  await q(env,'UPDATE app_announcement_receipts SET '+column+'=COALESCE('+column+',?1) WHERE announcement_id=?2 AND user_id=?3 AND session_id=?4',now(),body.id,auth.user.id,auth.session.id).run();
  return json({success:true});
 }
 fail('Method not allowed.',405);
}
