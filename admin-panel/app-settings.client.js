async function loadAppSettings() {
 const ticket=generation,section=heading('App controls','Owner controls for RC.7 and newer. These settings do not change account session limits.');
 const data=await api('/admin/app-settings');if(ticket!==generation)return;
 const settings=data.settings;
 const f=form(section,async()=>{
  await api('/admin/app-settings','PUT',{revision:settings.revision,multiview_max:Number(cap.value),provider_limits:Object.fromEntries(Object.entries(limits).map(([id,input])=>[id,Number(input.value)])),update:{version_code:Number(version.value),message:note.value,url:url.value}});
  await loadAppSettings();message('App controls saved. Connected RC.7 apps refresh settings with their account check (normally within five minutes).');
 });
 const cap=select(f,'Maximum multiview panes','multiview_max',[[0,'Disabled'],[1,'1'],[2,'2'],[3,'3'],[4,'4']],settings.multiview_max);
 f.append(el('p','One app session can play several channels. Every pane uses a provider connection. Limits below apply within one device; your provider enforces the total across devices. Separate playlists using the same provider account must share its overall allowance.','help'));
 const limits={};
 for(const [id,label] of [['primary','CharmIPTV'],['secondary','CharmIPTV 2'],['tertiary','CharmIPTV 3'],['quaternary','CharmIPTV 4']]) limits[id]=select(f,label+' provider pane limit',id,[[0,'Unknown / no extra app cap'],[1,'1'],[2,'2'],[3,'3'],[4,'4']],settings.provider_limits[id]);
 f.append(el('h2','Optional update notice'),el('p','Use the Android version code of an available build. Set 0 to turn the notice off. Older apps keep working; this never forces an update.','help'));
 const version=field(f,'New Android version code','version',settings.update.version_code,'number',{min:0,max:2100000000});
 const note=field(f,'Message','update_message',settings.update.message,'text',{maxLength:500});
 const url=field(f,'HTTPS download or release page','update_url',settings.update.url,'url',{maxLength:2048});
 submit(f,'Save app controls');
 section.append(el('h2','Account service errors'),el('p','Caught internal errors for the last seven days. Counts contain no user identities or request addresses. Database failures may prevent counts from being stored; consult Cloudflare Worker metrics and logs as well.','help'));
 if(!data.errors.length)section.append(el('p','No recorded internal errors in the last seven days.'));
 for(const row of data.errors)section.append(el('p',new Date(row.day*86400000).toISOString().slice(0,10)+': '+row.count+' · last '+date(row.last_at)));
 section.append(button('Refresh',()=>loadAppSettings()));
}
