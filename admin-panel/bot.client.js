/* Mr. Charm control center extends the existing authenticated panel. */
const BOT_LABELS={guide:'Charming MediaLab User Guide · full two-part version',rules:'Rules & Information',downloads:'Download message',whats_new:'What’s New',broadcast:'Admin Broadcast',status:'Service Status',welcome:'Member welcome',waiting:'Join-request welcome',acknowledgment:'Public acknowledgment',reminder:'Recurring announcement',about:'About Mr. Charm'};
BOT_LABELS.app_help='Sources, Real-Debrid, Xtream & Multiview Help';
let botTab='Dashboard';
async function loadBot(){
 const section=heading('Mr. Charm Control Center','Manage your Telegram assistant, member links, support and editable content.');
 const tabs=el('div',undefined,'bot-tabs');section.append(tabs);
 for(const name of ['Dashboard','Members','Group Invites','Content','Downloads','Support','Support Admins','Bot Settings','Audit Log'])tabs.append(button(name,()=>{botTab=name;return loadBot();},botTab===name?'primary':''));
 const box=el('div',undefined,'bot-workspace');section.append(box);
 if(botTab==='Content')return botContent(box);
 if(botTab==='Downloads')return botDownloads(box);
 if(botTab==='Bot Settings')return botSettings(box);
 if(botTab==='Members')return botMembers(box);
 if(botTab==='Group Invites')return botGroupInvites(box);
 if(botTab==='Support')return botSupport(box);
 if(botTab==='Support Admins')return botSupportAdmins(box);
 if(botTab==='Audit Log'){const d=await api('/admin/bot/events');return botEventList(box,d.events);}
 const d=await api('/admin/bot/dashboard');
 const stats=el('div',undefined,'stats');box.append(stats);
 for(const [label,n] of [['Telegram members recorded',d.members.n],['Unresolved support tickets',d.tickets.n]]){const card=el('div',undefined,'card stat');card.append(el('strong',String(n)),el('span',label));stats.append(card);}
 box.append(el('h2','Recent deliveries'),el('p','Saving content never sends a broadcast. Queued messages can be canceled before sending.','help'));
 for(const j of d.jobs){const card=el('div',undefined,'card');card.append(el('strong',j.kind+' · '+j.status),el('p',date(j.due_at)),el('p',j.error||j.body.slice(0,150)));if(j.status==='pending')card.append(button('Cancel queued message',async()=>{await api('/admin/bot/jobs/'+j.id,'DELETE');await loadBot();}));box.append(card);}
 if(!d.jobs.length)box.append(el('p','No deliveries yet.'));
 box.append(el('h2','Usage counts'));for(const a of d.analytics)box.append(el('p',a.action.replaceAll('_',' ')+': '+a.n));
}
function botText(parent,label,value){const l=el('label',label),t=el('textarea');t.value=value||'';t.rows=16;l.append(t);parent.append(l);return t;}
async function botGroupInvites(box){
 box.append(el('h2','Personal Telegram group invites'),el('p','Create a separate link for each person, even if they do not have Telegram yet. A human admin verifies the requester and approves them. After they join, Mr. Charm records their identity, revokes the link and continues the existing app-token process.','help'));
 const card=el('div',undefined,'card');box.append(card);
 const label=field(card,'Recipient name or label','groupInviteLabel',''),recipient=field(card,'Telegram user ID (optional; leave blank if unknown)','groupInviteId','','text'),username=field(card,'Username (optional, for your records)','groupInviteUsername','');
 const minutes=field(card,'Link expires after (minutes)','groupInviteMinutes','60','number',{min:1,max:525600});
 const noExpiry=check(card,'No expiration','groupInviteNoExpiry',false);noExpiry.onchange=()=>{minutes.disabled=noExpiry.checked;};
 const approved=check(card,'I authorize an invite for this recipient','groupInviteApproved',false);
 card.append(button('Create personal invite',async()=>{
  if(!minutes.disabled&&!minutes.reportValidity())return;
  await api('/admin/bot/group-invites','POST',{recipient_label:label.value,telegram_id:recipient.value,username:username.value,approved:approved.checked,expires_at:noExpiry.checked?null:Math.floor(Date.now()/1000)+Number(minutes.value)*60});
  await loadBot();message('Invite created. Copy the link from its record and send it to the intended person.');
 },'primary'));
 const search=field(box,'Search recipient label, ID or username','groupInviteSearch',''),results=el('div');box.append(results);let page=1;
 const refresh=async()=>{
  const d=await api('/admin/bot/group-invites?'+new URLSearchParams({search:search.value,page}));results.replaceChildren();
  for(const i of d.invites){
   const item=el('div',undefined,'card');results.append(item);
   item.append(el('h3',i.recipient_label),el('p',(i.username?'@'+i.username+' · ':'')+(i.telegram_id||'Telegram identity awaits human verification')),el('p','Status: '+i.display_status+' · Human approval required'),el('p','Created: '+date(i.created_at)+' · Expires: '+(i.expires_at?date(i.expires_at):'No expiration')),el('p','Requested: '+date(i.request_at)+' · Admitted: '+date(i.used_at)+' · Join recorded: '+date(i.joined_at)),el('p','Joined by: '+(i.used_by||'Not yet')+(i.used_username?' (@'+i.used_username+')':'')),el('p','Link revoked: '+(i.revoked_at?date(i.revoked_at):'Not yet')));
   if(Number(i.requester_count)>1)item.append(el('p','Warning: '+i.requester_count+' different Telegram accounts requested this one link. Verify the intended person before approving anyone.','help'));
   if(i.last_error)item.append(el('p',i.last_error,'help'));
   if(i.invite_link){const link=field(item,'Invite link','link-'+i.id,i.invite_link);link.readOnly=true;item.append(button('Copy link',async()=>{await navigator.clipboard.writeText(i.invite_link);message('Link copied.');}));}
   if(!i.revoked_at&&i.invite_link)item.append(button('Revoke invite',async()=>{if(!confirm('Revoke only this invite for '+i.telegram_id+'? This does not remove someone already admitted.'))return;const r=await api('/admin/bot/group-invites/'+i.id,'DELETE');await refresh();message(r.invite.revoked_at?'Invite revoked.':'Invite blocked locally. Telegram revocation is pending and will retry.');},'danger'));
   item.append(button(i.display_status==='pending'?'Review and approve requester':'View join attempts',async()=>{const r=await api('/admin/bot/group-invites/'+i.id+'/attempts');const body=openDialog('Join requests for '+i.recipient_label,'Verify the requester is the intended person before approving. A forwarded link does not prove identity.');for(const a of r.attempts){body.append(el('p',date(a.requested_at)+' · '+a.telegram_id+(a.username?' (@'+a.username+')':'')+' · '+a.outcome));if(i.display_status==='pending'&&a.outcome==='waiting')body.append(button('Approve '+a.telegram_id,async()=>{if(!confirm('I have verified Telegram ID '+a.telegram_id+' is '+i.recipient_label+'. Approve admission?'))return;await api('/admin/bot/group-invites/'+i.id+'/approve','POST',{telegram_id:a.telegram_id});$('dialog').close();await refresh();},'primary'));}if(!r.attempts.length)body.append(el('p','No requests yet.'));}));
  }
  if(!d.invites.length)results.append(el('p','No matching group invites.'));
  const pager=el('div',undefined,'form-actions');if(page>1)pager.append(button('Previous',()=>{page--;return refresh();}));if(d.invites.length===50)pager.append(button('Next',()=>{page++;return refresh();}));results.append(pager);
 };
 box.insertBefore(button('Search / refresh',()=>{page=1;return refresh();}),results);await refresh();
}
async function botContent(box){
 const [d,configuration]=await Promise.all([api('/admin/bot/content'),api('/admin/bot/settings')]);
 for(const c of d.content){if(c.key==='downloads')continue;
 const card=el('details',undefined,'card bot-editor');card.append(el('summary',BOT_LABELS[c.key]));box.append(card);
 const body=el('div',undefined,'bot-editor-body');card.append(body);
 if(c.key==='reminder'){
 const s=configuration.settings,schedule=el('div',undefined,'card');body.append(schedule);
 const enabled=check(schedule,'Recurring announcement enabled','reminder_enabled',s.reminder_enabled);
 const hours=field(schedule,'Announcement interval (hours)','reminder_hours',s.reminder_hours,'number',{min:1,max:24});
 schedule.append(el('p','Choose 1–24 whole hours. The previous recurring announcement is deleted before the next is posted. The message below must also be enabled and contain text.','help'));
 schedule.append(button('Save announcement schedule',async()=>{
  if(!hours.reportValidity())return;
  await api('/admin/bot/settings','PUT',{...s,reminder_enabled:enabled.checked,reminder_hours:Number(hours.value)});
  await loadBot();message('Announcement schedule saved.');
 },'primary'));
}
 const on=check(body,c.key==='reminder'?'Message enabled':'Enabled','enabled',!!c.enabled),text=botText(body,'Message text',c.body);
 const preview=el('div',undefined,'bot-preview');preview.hidden=true;body.append(preview);
 body.append(el('p','Blank content is saved as disabled. Use {name} in welcome and acknowledgment messages.','help'));
 const actions=el('div',undefined,'form-actions');body.append(actions);
 actions.append(button('Save',async()=>{await api('/admin/bot/content/'+c.key,'PUT',{body:text.value,enabled:on.checked,revision:c.revision});await loadBot();message('Saved.');},'primary'),button('Preview',()=>{preview.replaceChildren();for(const line of text.value.split('\n'))preview.append(el(line.includes('VIOLATION OF ANY OF THESE RULES')?'h2':'div',line));preview.hidden=!preview.hidden;}),button('Clear / leave blank',()=>{text.value='';on.checked=false;message('Cleared in this editor. Press Save to apply.');}),button('History / Restore',()=>botHistory(c)));
 if(c.key==='broadcast')actions.append(button('Send to group',()=>{
 const b=openDialog('Review broadcast','This sends the saved broadcast to your configured Telegram group.');b.append(el('pre',c.body,'bot-preview'));
 b.append(button('Send saved broadcast',async()=>{await api('/admin/bot/broadcast','POST',{revision:c.revision});$('dialog').close();message('Broadcast queued. Check Dashboard for delivery.');},'primary'));
 }));
 }
}
async function botHistory(c){const d=await api('/admin/bot/content/'+c.key+'/history'),body=openDialog('Content history','Restore makes a saved older version current; it does not send messages.');if(!d.history.length)body.append(el('p','No previous saved versions yet.'));
 for(const h of d.history){const item=el('details',undefined,'card');item.append(el('summary','Revision '+h.revision+' · '+date(h.updated_at)),el('pre',h.body,'bot-preview'),button('Restore this version',async()=>{await api('/admin/bot/content/'+c.key,'PUT',{body:h.body,enabled:!!h.enabled,revision:c.revision});$('dialog').close();await loadBot();}));body.append(item);}}
async function botDownloads(box){
 const d=await api('/admin/bot/settings'),s=d.settings,codes=s.download_codes||[{label:'Primary',code:'2977459',enabled:true},{label:'Backup 1',code:'',enabled:false},{label:'Backup 2',code:'',enabled:false}];
 const card=el('div',undefined,'card');box.append(card,el('p','Only enabled codes containing a value are shown. All three may be blank.','help'));
 const inputs=codes.map((c,i)=>{const g=el('div',undefined,'form-grid');card.append(el('h2',i===0?'Primary code':'Alternative code '+i),g);const input={label:field(g,'Label','label'+i,c.label),code:field(g,'Downloader code','code'+i,c.code),enabled:check(g,'Enabled','on'+i,c.enabled)};g.append(button('Clear code',()=>{input.code.value='';input.enabled.checked=false;message('Code cleared in this form. Save downloads to apply.');}));return input;});
 const version=field(card,'App version (optional)','version',s.app_version||''),link=field(card,'Direct download link (optional)','url',s.download_url||'','url');
 card.append(button('Save downloads',async()=>{await api('/admin/bot/settings','PUT',{...s,download_codes:inputs.map(c=>({label:c.label.value,code:c.code.value,enabled:c.enabled.checked})),app_version:version.value,download_url:link.value});await loadBot();message('Download settings saved.');},'primary'));
}
async function botSettings(box){const d=await api('/admin/bot/settings'),s=d.settings,card=el('div',undefined,'card');box.append(card);
 card.append(el('p','Bot credential: '+(d.ready.token?'Saved':'Not saved')+' · Connection secret: '+(d.ready.webhook_secret?'Saved':'Not saved')));
 const username=field(card,'Bot username','bot_username',s.bot_username),group=field(card,'Telegram group numeric ID','group_id',s.group_id);
 if(admin.is_owner){
  const finder=el('div'),status=el('p','Click Find my Telegram group after adding Mr. Charm as an administrator.','help');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const choices=el('div',undefined,'form-actions');
  finder.append(button('Find my Telegram group',async()=>{
   status.textContent='Searching Telegram for your group…';status.classList.remove('error');choices.replaceChildren();
   try{
    const r=await api('/admin/bot/discover-groups');
    if(!r.groups.length){status.textContent=r.message||'No group found yet. In Telegram, make @CharmIPTVAssistantBot a group administrator, then send /help@CharmIPTVAssistantBot in that group and click Find my Telegram group again.';return;}
    status.textContent='Found '+r.groups.length+' group'+(r.groups.length===1?'':'s')+'. Click your Charming MediaLab group below:';
    for(const g of r.groups)choices.append(button(g.title+' ('+g.id+')',()=>{group.value=g.id;status.textContent='Selected '+g.title+'. The numeric ID is filled in. Click Save settings below.';choices.replaceChildren();}));
   }catch(e){status.textContent=e.message;status.classList.add('error');}
  }),status,choices);card.append(finder);
 }

 const switches={};for(const [key,label] of Object.entries({enabled:'Bot enabled',auto_tokens:'Assign one invitation after approval',accounts_enabled:'Account help and token creation enabled',downloads_enabled:'Downloads enabled'}))switches[key]=check(card,label,key,s[key]);
 const unlimited=check(card,'Unlimited access for new bot invitations','unlimited',s.token_days===null);
 const days=field(card,'New account duration (days)','token_days',s.token_days??90,'number',{min:1,max:3650}),connections=field(card,'Simultaneous connections','connections',s.connections,'number',{min:1,max:20}),inviteDays=field(card,'Unused invitation validity (days)','invite_days',s.invite_days,'number',{min:1,max:365});
 card.append(el('p','These access defaults apply to newly issued bot invitations. Existing account time and limits are managed under Users. Turning off token creation still allows lookup of an existing token while account help is enabled.','help'));
 card.append(button('Save settings',async()=>{await api('/admin/bot/settings','PUT',{...s,bot_username:username.value,group_id:group.value,...Object.fromEntries(Object.entries(switches).map(([k,v])=>[k,v.checked])),token_days:unlimited.checked?null:Number(days.value),connections:Number(connections.value),invite_days:Number(inviteDays.value)});await loadBot();message('Settings saved.');},'primary'),button('Check connection',async()=>{const r=await api('/admin/bot/connection');message('@'+r.username+' · '+(r.url?'Connected':'Not connected')+' · Pending: '+r.pending+(r.last_error?' · '+r.last_error:''));}));
 if(admin.is_owner)card.append(button('Connect Telegram',async()=>{await api('/admin/bot/connect','POST',{});message('Telegram connected.');}));
}
async function botMembers(box){const search=field(box,'Search Telegram name, ID, app username or token','botSearch','');const results=el('div');box.append(results);let page=1;
 const refresh=async()=>{const d=await api('/admin/bot/members?'+new URLSearchParams({search:search.value,page}));results.replaceChildren();for(const m of d.members){const card=el('div',undefined,'card');card.append(el('h2',m.name+(m.username?' (@'+m.username+')':'')),el('p','Telegram ID: '+m.telegram_id+' · '+m.status+(m.blocked?' · Bot access blocked':'')),el('p','Account: '+(m.account_username||'Not registered / not linked')+' · Token: '+(m.invite_code||'Not assigned')),el('p','Requested: '+date(m.requested_at)+' · Joined: '+date(m.joined_at)),button('Manage Telegram link',()=>botManageMember(m)));results.append(card);}if(!d.members.length)results.append(el('p','No matching Telegram members.'));
 const pager=el('div',undefined,'form-actions');if(page>1)pager.append(button('Previous',()=>{page--;return refresh();}));if(d.members.length===50)pager.append(button('Next',()=>{page++;return refresh();}));results.append(pager);};
 box.insertBefore(button('Search',()=>{page=1;return refresh();}),results);await refresh();}
function botManageMember(m){const body=openDialog('Manage '+m.name,'Link only a verified Telegram identity to the correct invitation. Unlinking never creates a replacement token.');body.append(el('p','Telegram ID: '+m.telegram_id));
 const change=async(action,extra={})=>{await api('/admin/bot/members/'+m.telegram_id,'PATCH',{action,...extra});$('dialog').close();await loadBot();};
 if(m.invite_id||m.account_id)body.append(button('Unlink Telegram',()=>change('unlink')));else{const code=field(body,'Existing viewer invitation code','invite','');body.append(button('Link invitation / account',()=>change('link',{invite_code:code.value}),'primary'));}
 body.append(button(m.blocked?'Unblock bot access':'Block bot access',()=>change(m.blocked?'unblock':'block')));
 if(m.account_id)body.append(button('Manage app account',async()=>{const r=await api('/admin/users/'+m.account_id);$('dialog').close();editUser(r.user);}));
 if(admin.is_owner||permitted('can_suspend'))for(const [action,label] of [['ban_both','Ban app account and Telegram'],['unban_both','Unban app account and Telegram']])body.append(button(label,()=>{if(confirm(label+' for '+m.name+'? Unbanning allows them to request to join again; it does not restore deleted accounts or expired time.'))return change(action);},'danger'));
 body.append(button('View timeline',async()=>{const d=await api('/admin/bot/members/'+m.telegram_id+'/timeline');const t=openDialog('Member timeline','Recent bot activity for '+m.name);botEventList(t,d.events);}));}
function botEventList(box,events){for(const e of events)box.append(el('p',date(e.created_at)+' · '+e.action.replaceAll('_',' ')+(e.detail?' · '+e.detail:'')+(e.telegram_id?' · '+e.telegram_id:'')));if(!events.length)box.append(el('p','No recorded activity.'));}
async function botSupport(box){const d=await api('/admin/bot/support');for(const t of d.tickets){const card=el('div',undefined,'card');card.append(el('h2','#'+t.id+' · '+(t.name||t.telegram_id)),el('p',date(t.created_at)));let summary;try{summary=JSON.parse(t.summary);}catch{summary={details:t.summary};}for(const [k,v] of Object.entries(summary))card.append(el('p',k+': '+v));const status=select(card,'Ticket status','status', [['open','Open'],['in_progress','In progress'],['closed','Closed']],t.status);card.append(button('Save ticket status',async()=>{await api('/admin/bot/support/'+t.id,'PATCH',{status:status.value});message('Ticket saved.');}));box.append(card);}if(!d.tickets.length)box.append(el('p','No support tickets yet.'));}
async function botSupportAdmins(box){box.append(button('Find human Telegram admins',async()=>{await api('/admin/bot/support-admins/sync','POST',{});await loadBot();},'primary'),el('p','Choose which people appear in Contact an Admin. Bots are excluded.','help'));const d=await api('/admin/bot/support-admins');for(const a of d.admins){const card=el('div',undefined,'card');card.append(el('strong',a.name+(a.username?' (@'+a.username+')':'')));const on=check(card,'Shown as support admin','enabled',!!a.enabled);card.append(button('Save',async()=>{await api('/admin/bot/support-admins/'+a.telegram_id,'PATCH',{enabled:on.checked});message('Support admin saved.');}));box.append(card);}}
