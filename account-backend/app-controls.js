const SOURCE_IDS = ['primary','secondary','tertiary','quaternary'];
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
export function validateControls(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid app settings.');
 if(Object.keys(input).some(k=>!['multiview_max','provider_limits','update','revision'].includes(k))) fail('Unknown app setting.');
 const max=input.multiview_max;
 if(!Number.isInteger(max)||max<0||max>4) fail('Multiview must be between 0 (disabled) and 4 panes.');
 const limits=input.provider_limits;
 if(!limits||Object.keys(limits).some(k=>!SOURCE_IDS.includes(k))) fail('Invalid provider limits.');
 for(const id of SOURCE_IDS) if(!Number.isInteger(limits[id])||limits[id]<0||limits[id]>4) fail('Provider pane limits must be 0 (unknown) through 4.');
 const update=input.update;
 if(!update||Object.keys(update).some(k=>!['version_code','message','url'].includes(k))||!Number.isInteger(update.version_code)||update.version_code<0||update.version_code>2100000000) fail('Invalid update settings.');
 if(typeof update.message!=='string'||update.message.length>500||typeof update.url!=='string'||update.url.length>2048) fail('Update message or link is too long.');
 if(update.url) {
  let parsed;try{parsed=new URL(update.url);}catch{fail('Use a valid HTTPS update link.');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash) fail('Use an HTTPS update link without embedded credentials or fragments.');
 }
 if(update.version_code>0&&(!update.message.trim()||!update.url)) fail('An update notice needs a message and HTTPS download page.');
 return {multiview_max:max,provider_limits:Object.fromEntries(SOURCE_IDS.map(k=>[k,limits[k]])),update:{version_code:update.version_code,message:update.message.trim(),url:update.url.trim()}};
}
export async function appControls(env) {
 const row=await env.DB.prepare('SELECT json,revision FROM app_controls WHERE id=1').first();
 return {...validateControls(JSON.parse(row.json)),revision:row.revision};
}
async function readSettings(request) {
 const reader=request.body?.getReader();if(!reader) fail('A JSON object is required.');
 let length=0;const chunks=[];
 try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>8192){await reader.cancel();fail('App settings are too large.',413);}chunks.push(value);}}
 finally {reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try {return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('A valid JSON object is required.');}
}
export async function appControlsAdmin(request,env,auth,helpers) {
 const {json,audit}=helpers;
 if(!auth.isOwner) fail('Only the owner can manage global app settings.',403);
 if(request.method==='GET') return json({success:true,settings:await appControls(env),errors:(await env.DB.prepare('SELECT day,count,last_at FROM app_service_errors WHERE day>=?1 ORDER BY day DESC LIMIT 7').bind(Math.floor(Date.now()/86400000)-6).all()).results||[]});
 if(request.method!=='PUT') fail('Method not allowed.',405);
 const body=await readSettings(request),settings=validateControls(body);
 if(!Number.isInteger(body.revision)||body.revision<0) fail('Refresh the app settings before saving.');
 const result=await env.DB.prepare('UPDATE app_controls SET json=?1,revision=revision+1,updated_at=?2 WHERE id=1 AND revision=?3').bind(JSON.stringify(settings),Math.floor(Date.now()/1000),body.revision).run();
 if(!result.meta?.changes) fail('These settings changed in another tab. Refresh and try again.',409);
 await audit(env,null,auth.user.id,'app_controls_updated',null);
 return json({success:true,settings:await appControls(env)});
}
export async function recordServiceError(env) {
 const now=Math.floor(Date.now()/1000),day=Math.floor(now/86400);
 try {await env.DB.batch([
  env.DB.prepare('INSERT INTO app_service_errors(day,count,last_at) VALUES(?1,1,?2) ON CONFLICT(day) DO UPDATE SET count=count+1,last_at=excluded.last_at').bind(day,now),
  env.DB.prepare('DELETE FROM app_service_errors WHERE day<?1').bind(day-30)
 ]);} catch { /* The error path must remain usable during a database outage. */ }
}
