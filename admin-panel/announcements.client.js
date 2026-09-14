async function loadAnnouncements(){
 const ticket=generation,section=heading('Updates & Announcements','Send an app notice now or schedule it. Users receive it when their app next connects; playback is not interrupted.');
 section.append(button('Create announcement',()=>editAnnouncement(), 'primary'));
 const result=await api('/admin/announcements');if(ticket!==generation)return;
 if(!result.announcements.length)section.append(el('p','No announcements yet. Create one to preview it before publishing.','muted'));
 for(const item of result.announcements){
  const card=el('article',undefined,'announcement-card'),report=item.report;
  card.append(el('h2',item.title),badge(item.status),el('p',item.message),el('p',`${item.kind==='update'?'APK version code '+item.version_code:'General announcement'} · ${item.audience} · ${date(item.starts_at)} → ${date(item.expires_at)}`,'muted'));
  card.append(el('p',`${report.checked} sessions checked in · ${report.displayed} displayed · ${report.dismissed} dismissed · ${report.opened} opened the link`,'muted'));
  const actions=el('div',undefined,'actions');
  if(item.status==='draft'){
   actions.append(button('Edit draft',()=>editAnnouncement(item)),button('Preview & publish',()=>previewAnnouncement(item)));
   actions.append(button('Test on my app account',async()=>{await api('/admin/announcements/'+item.id+'/test','POST',{});message('A ten-minute test notice is available only to your app account. Open the app while signed into that account.');}));
  }
  actions.append(button('Copy into new draft',()=>editAnnouncement({...item,id:null,status:'draft',starts_at:Math.floor(Date.now()/1000),expires_at:Math.floor(Date.now()/1000)+7*86400})));
  if(item.status!=='canceled')actions.append(button('Cancel announcement',async()=>{
   const body=openDialog('Cancel announcement',item.title+' will stop being offered when apps next check in.');
   body.append(button('Confirm cancellation',async()=>{await api('/admin/announcements/'+item.id,'DELETE',{revision:item.revision});await saved('Announcement canceled.');}));
  }));
  card.append(actions);section.append(card);
 }
 section.append(el('p','These are app-session reports, not proof of a completed APK installation. Existing builds use their older, simpler update window.','help'));
}
async function editAnnouncement(item={}){
 const container=openDialog(item.id?'Edit announcement draft':'Create announcement','Save and preview first. Saving a draft does not notify users.');
 const t=Math.floor(Date.now()/1000),localDate=n=>{const d=new Date(n*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 const selected=new Map((item.user_ids||[]).map(id=>[id,id]));
 const f=form(container,async()=>{
  const body={title:title.value,message:messageInput.value,kind:kind.value,version_code:Number(version.value),url:url.value,audience:audience.value,user_ids:[...selected.keys()],starts_at:Math.floor(new Date(start.value).getTime()/1000),expires_at:Math.floor(new Date(end.value).getTime()/1000),reminder_hours:Number(reminder.value),sound:sound.checked,...(item.id?{revision:item.revision}:{})};
  const result=await api('/admin/announcements'+(item.id?'/'+item.id:''),item.id?'PUT':'POST',body);
  $('dialog').close();previewAnnouncement(result.announcement);
 });
 const kind=select(f,'Type','kind',[['update','App update'],['general','General announcement']],item.kind||'update');
 const title=field(f,'Title','title',item.title||'A Charming MediaLab update is available','text',{required:true,maxLength:100});
 const label=el('label','Message'),messageInput=el('textarea');messageInput.value=item.message||'';messageInput.required=true;messageInput.maxLength=1200;messageInput.rows=5;label.append(messageInput);f.append(label);
 const version=field(f,'APK Android version code (not the GitHub build number)','version',item.version_code||19,'number',{min:0,max:2100000000});
 const url=field(f,'Telegram release message or HTTPS download destination','url',item.url||'','url',{maxLength:2048});
 const audience=select(f,'Who should receive it?','audience',[['outdated','Everyone running an older version'],['all','Everyone — general announcements'],['selected','Selected accounts']],item.audience||'outdated');
 const recipientBox=el('div'),chosen=el('div',undefined,'actions'),matches=el('div',undefined,'actions');f.append(recipientBox);
 const search=field(recipientBox,'Find an account by username','recipient_search','');recipientBox.append(matches,chosen);
 const paintSelected=()=>{chosen.replaceChildren();for(const [id,name] of selected)chosen.append(button(name+' · Remove',()=>{selected.delete(id);paintSelected();}));};paintSelected();
 let searchVersion=0,searchTimer;
 search.addEventListener('input',()=>{const version=++searchVersion;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{try{const result=await api('/admin/announcements/recipients?search='+encodeURIComponent(search.value));if(version!==searchVersion||!search.isConnected)return;matches.replaceChildren();for(const user of result.users)matches.append(button(user.username+' · '+user.status,()=>{selected.set(user.id,user.username);paintSelected();}));}catch(error){if(search.isConnected)matches.replaceChildren(el('p',error.message,'error'));}},250);});
 const showRecipients=()=>{recipientBox.hidden=audience.value!=='selected';};audience.addEventListener('change',showRecipients);showRecipients();
 f.append(el('p','General announcements can reach everyone; app updates automatically stop appearing after that version is installed.','help'));
 const start=field(f,'Start (your local time)','starts_at',localDate(item.starts_at||t),'datetime-local',{required:true});
 const end=field(f,'End (your local time)','expires_at',localDate(item.expires_at||t+7*86400),'datetime-local',{required:true});
 const reminder=select(f,'Remind after dismissal','reminder',[[1,'1 hour'],[6,'6 hours'],[12,'12 hours'],[24,'Tomorrow · recommended'],[48,'2 days'],[168,'7 days']],item.reminder_hours||24);
 const sound=check(f,'Play one soft chime on first display (respects the user’s sound preference)', 'sound',item.sound!==false);
 submit(f,'Save draft & preview');
}
function previewAnnouncement(item){
 const container=openDialog('Preview announcement','Review the audience, dates and destination before publishing.');
 const preview=el('article',undefined,'announcement-preview');preview.append(el('small','CHARMING MEDIALAB'),el('h2',item.title),el('p',item.message));
 if(item.url)preview.append(el('p','Get update in Telegram · Installation help · Remind me tomorrow','announcement-preview-actions'));
 container.append(preview,el('p',`${item.audience} · Android version ${item.version_code} · ${date(item.starts_at)} to ${date(item.expires_at)} · reminder ${item.reminder_hours} hours · chime ${item.sound?'on':'off'}`),el('p',item.url||'No external link','muted'));
 const actions=el('div',undefined,'actions');actions.append(button('Edit draft',()=>{$('dialog').close();return editAnnouncement(item);}));
 actions.append(button(item.starts_at>Date.now()/1000?'Schedule announcement':'Publish announcement',async()=>{await api('/admin/announcements/'+item.id+'/publish','POST',{revision:item.revision});await saved('Announcement published. Connected apps will receive it on their next check.');},'primary'));
 container.append(actions);
}
