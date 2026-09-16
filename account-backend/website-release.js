import {q,rows,fail,now,event} from './bot-store.js';
export function validateRelease(b){
 const out={};
 for(const [key,max] of [['version',60],['title',160],['notes',6000]]){if(typeof b[key]!=='string'||!b[key].trim()||b[key].length>max)fail('Enter a valid '+key,400);out[key]=b[key].trim();}
 let url;try{url=new URL(b.download_url);}catch{fail('Enter a valid HTTPS download URL.',400);}
 if(url.protocol!=='https:'||url.username||url.password||url.href.length>2048)fail('Use an HTTPS download URL without credentials.',400);
 out.download_url=url.href;
 if(!Number.isSafeInteger(b.build)||b.build<1||b.build>2147483647)fail('Build must be a positive whole number.',400);
 if(!Number.isSafeInteger(b.size_bytes)||b.size_bytes<1||b.size_bytes>21474836480)fail('Enter the APK file size in bytes.',400);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(b.release_date)||!Number.isFinite(Date.parse(b.release_date))||new Date(b.release_date).toISOString().slice(0,10)!==b.release_date)fail('Enter a valid release date.',400);
 return {...out,build:b.build,size_bytes:b.size_bytes,release_date:b.release_date};
}
export async function releaseConfig(env){const r=await q(env,'SELECT * FROM website_release WHERE id=1').first();return {...JSON.parse(r.json),revision:r.revision,updated_at:r.updated_at};}
export async function releaseAdmin(request,env,auth,{json,safeJson}){
 if(!auth.isOwner&&!auth.profile.can_manage_bot)fail('Website release management requires bot-management permission.',403);
 if(request.method==='GET')return json({success:true,release:await releaseConfig(env),history:await rows(env,'SELECT revision,updated_at FROM website_release_history ORDER BY id DESC LIMIT 10')});
 if(request.method!=='PUT')return json({success:false,error:'Method not allowed'},405);
 const b=await safeJson(request),data=validateRelease(b);
 if(!Number.isInteger(b.revision))fail('Refresh this form before publishing.',409);
 const old=await releaseConfig(env);if(old.revision!==b.revision)fail('Another admin changed this release. Refresh before publishing.',409);
 const results=await env.DB.batch([
  q(env,'INSERT INTO website_release_history(revision,json,updated_at,updated_by) SELECT revision,json,updated_at,updated_by FROM website_release WHERE id=1 AND revision=?1',b.revision),
  q(env,'UPDATE website_release SET json=?1,revision=revision+1,updated_at=?2,updated_by=?3 WHERE id=1 AND revision=?4',JSON.stringify(data),now(),auth.user.id,b.revision)
 ]);
 if(!results[1].meta.changes)fail('Release changed. Refresh before publishing.',409);
 await event(env,null,'website_release_published','Build '+data.build,auth.user.id);
 return json({success:true,release:await releaseConfig(env)});
}
