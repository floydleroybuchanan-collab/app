async function botRelease(box){
 const {release:r}=await api('/admin/bot/release');
 box.append(el('h2','Website app release'),el('p','Publish the website download destination and release details together. This does not send a Telegram announcement or an in-app update alert.','help'));
 const card=el('div',undefined,'card');box.append(card);
 const url=field(card,'HTTPS download URL','releaseUrl',r.download_url,'url');
 const code=field(card,'Downloader code (optional)','releaseDownloader',r.downloader_code||'');
 code.inputMode='numeric';code.maxLength=12;
 card.append(el('p','Change either field independently. Leave the code blank to hide the TV Downloader option.','help'));
 const version=field(card,'Version','releaseVersion',r.version);
 const build=field(card,'Build number','releaseBuild',r.build,'number');
 const dateInput=field(card,'Release date','releaseDate',r.release_date,'date');
 const size=field(card,'APK size in bytes','releaseSize',r.size_bytes,'number');
 const title=field(card,'Update title','releaseTitle',r.title);
 const notes=botText(card,'Release notes',r.notes);
 card.append(button('Preview release',()=>{
  const data={revision:r.revision,download_url:url.value.trim(),downloader_code:code.value.trim(),version:version.value.trim(),build:Number(build.value),release_date:dateInput.value,size_bytes:Number(size.value),title:title.value.trim(),notes:notes.value.trim()};
  if(data.downloader_code&&!/^\d{1,12}$/.test(data.downloader_code)){message('Enter digits only for the Downloader code, or leave it blank.');return;}
  let link;try{link=new URL(data.download_url);}catch{message('Enter a valid HTTPS URL.');return;}
  if(link.protocol!=='https:'||link.username||link.password||!data.version||!data.title||!data.notes||!Number.isSafeInteger(data.build)||data.build<1||!Number.isSafeInteger(data.size_bytes)||data.size_bytes<1||!data.release_date){message('Complete all fields with a valid version, date, build, size and HTTPS link.');return;}
  const content=openDialog('Preview website release','Review the exact details before publishing.');
  content.append(el('h3',data.title),el('p',data.version+' · Build '+data.build),el('p',data.release_date+' · '+(data.size_bytes/1000000).toFixed(1)+' MB'),el('p',data.download_url),el('p','Downloader code: '+(data.downloader_code||'Hidden')),el('pre',data.notes));
  const publish=button('Publish website update',async()=>{publish.disabled=true;try{await api('/admin/bot/release','PUT',data);$('dialog').close();await loadBot();message('Website release published. The website refreshes the published details when opened.');}catch(error){publish.disabled=false;throw error;}},'primary');content.append(publish);
 },'primary'));
}
async function botUsage(box,period='30'){
 const {usage:u}=await api('/admin/bot/usage?period='+period);
 box.replaceChildren(el('h2','App usage'));
 const periods=el('div',undefined,'actions');for(const [value,label] of [['1','Today (UTC)'],['7','7 days'],['30','30 days'],['all','All time']])periods.append(button(label,()=>botUsage(box,value),period===value?'primary':''));box.append(periods);
 box.append(el('p','Measured activity from supported builds only. Heartbeats expire after two minutes. Watch time excludes paused playback and idle menus. Least-used rankings exclude accounts with no measured playback. App visits are returns after a two-minute gap, not password logins.','help'));
 box.append(el('p',`Online: ${u.online_users} · IPTV: ${u.iptv_users} · VOD: ${u.vod_users}`),el('p',`Active accounts: ${u.accounts.active_accounts} · Linked: ${u.accounts.linked_accounts} · Unlinked: ${u.accounts.unlinked_accounts}`),el('p','Tracking started: '+date(u.tracking_started_at)));
 box.append(el('h3','Online now'));if(!u.online.length)box.append(el('p','No recent activity reported.'));
 for(const row of u.online)box.append(el('p',row.username+' · '+row.mode.toUpperCase()+' · '+(row.playing?'Playing':'Browsing')+' · Build '+row.build));
 for(const [key,label] of [['most','Top 10 watch time'],['least','Lowest 10 watch time'],['visits','Most app visits'],['signins','Most app sign-ins']]){
  box.append(el('h3',label));if(!u[key].length)box.append(el('p','No measured playback yet.'));
  u[key].forEach((x,i)=>box.append(el('p',`${i+1}. ${x.username} · ${(x.watch_seconds/3600).toFixed(1)} h watched · IPTV ${(x.iptv_seconds/3600).toFixed(1)} h · VOD ${(x.vod_seconds/3600).toFixed(1)} h · ${x.visits} visits · ${x.signins} sign-ins`)));
 }
}
