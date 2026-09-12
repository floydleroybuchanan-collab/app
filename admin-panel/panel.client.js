"use strict";
const API = document.querySelector('meta[name="api"]').content;
const $ = id => document.getElementById(id);
const FLAGS = {
  can_manage_bot:'Manage Mr. Charm content, settings and all Telegram member links (global access)',
  can_create_invites:"Create invitation codes",can_manage_all:"Access every administrator's viewer accounts (otherwise own accounts only)",
  can_change_time:"Change account timers",can_change_sessions:"Change simultaneous session allowance",
  can_suspend:"Disable / re-enable viewer accounts",can_delete_users:"Permanently delete / expire viewer accounts",
  can_reset_password:"Reset viewer passwords",can_force_logout:"Revoke viewer sessions",
  can_revoke_invites:"Revoke unused codes",can_delete_invites:"Delete invitation history",can_view_audit:"View own activity log",
};
const LIMITS = {
  max_duration_days:["Maximum days remaining / new account duration",1,3650,90],
  max_sessions:["Maximum simultaneous viewer sessions",1,20,2],
  max_accounts_total:["Lifetime direct account creation budget",0,1000000,0],
  max_open_accounts:["Maximum open direct accounts",0,1000000,0],
  max_pending_invites:["Maximum outstanding invitation codes",0,1000,0],
  max_invite_valid_days:["Maximum unused-code validity (days)",1,365,7],
};
let token = sessionStorage.getItem("charm_admin_token") || localStorage.getItem("charm_admin_token") || "";
let admin=null,creators=[],view="dashboard",generation=0,listState={};
const permitted = key => !!admin?.is_owner || admin?.permissions?.[key]===1;
function el(tag,text,className) { const n=document.createElement(tag); if(text!==undefined) n.textContent=text; if(className)n.className=className; return n; }
function button(text,action,className) { const b=el("button",text,className); b.type="button"; b.addEventListener("click",()=>run(action,b)); return b; }
function message(text,error=false) { const target=$("dialog").open?$("dialogError"):$("notice"); target.textContent=text; target.classList.toggle("error",error); }
async function run(action,button) { if(button)button.disabled=true; try{await action();}catch(e){message(e.message,true);}finally{if(button)button.disabled=false;} }
function clearSession() { token="";admin=null;sessionStorage.removeItem("charm_admin_token");localStorage.removeItem("charm_admin_token");$("dialog").close();$("app").hidden=true;$("login").hidden=false;generation++; }
async function api(path,method="GET",body) {
  const response=await fetch(API+path,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await response.json();}catch{throw new Error("The account service is temporarily unavailable.");}
  if(response.status===401 && path!=="/auth/login")clearSession();
  if(!response.ok||data.success!==true)throw new Error(data.error||"Request failed. Please try again.");
  return data;
}
const date = n => n==null?"—":new Date(Number(n)*1000).toLocaleString();
function remaining(n) { if(n==null)return "Unlimited";const seconds=Number(n)-Date.now()/1000;return seconds<=0?"Expired":Math.ceil(seconds/86400)+" days remaining"; }
function badge(text) { return el("span",text,"badge "+text); }
function cell(main,sub) { const n=el("div",main);if(sub)n.append(el("small",sub));return n; }
function heading(title,description) { const section=$("content");section.replaceChildren(el("h1",title),el("p",description,"muted"));return section; }
function field(parent,label,name,value="",type="text",extra={}) {
  const wrapper=el("label",label), input=el("input");input.name=name;input.type=type;input.value=value??"";
  Object.assign(input,extra);wrapper.append(input);parent.append(wrapper);return input;
}
function select(parent,label,name,options,value) {
  const wrapper=el("label",label),input=el("select");input.name=name;
  for(const [v,t] of options){const option=el("option",t);option.value=v;input.append(option);}
  if(value!==undefined)input.value=String(value);wrapper.append(input);parent.append(wrapper);return input;
}
function check(parent,label,name,value=false) { const w=el("label",undefined,"check"),input=el("input");input.type="checkbox";input.name=name;input.checked=!!value;w.append(input,document.createTextNode(label));parent.append(w);return input; }
function form(parent,onSubmit) { const f=el("form");f.addEventListener("submit",e=>{e.preventDefault();run(()=>onSubmit(f),f.querySelector('[type="submit"]'));});parent.append(f);return f; }
function submit(parent,text) { const row=el("div",undefined,"form-actions"),b=el("button",text,"primary");b.type="submit";row.append(b);parent.append(row);return row; }
function openDialog(title,description) { const body=$("dialogBody");body.replaceChildren(el("h2",title),el("p",description,"muted"));$("dialogError").textContent="";$("dialog").showModal();return body; }
async function saved(text) { $("dialog").close();message(text);await loadView(); }
async function copy(text) { try{await navigator.clipboard.writeText(text);message("Invitation code copied.");}catch{message("Copy is unavailable here. Select the displayed code and copy it manually.");} }

async function openApp() {
  const data=await api("/admin/me");admin=data.admin;
  // Retain existing logins on upgrade, then keep this panel session in this tab.
  sessionStorage.setItem("charm_admin_token",token);localStorage.removeItem("charm_admin_token");
  $("identity").textContent=admin.username+(admin.is_owner?" · Owner":" · Administrator");
  $("adminsTab").hidden=!admin.is_owner;
  $("appSettingsTab").hidden=!admin.is_owner;
  document.querySelectorAll("[data-permission]").forEach(n=>n.hidden=!permitted(n.dataset.permission));
  creators=(await api("/admin/creators")).creators;
  $("login").hidden=true;$("app").hidden=false;await navigate("dashboard");
}
async function navigate(next) {
  view=next;listState={page:1,page_size:25,search:"",status:"all",creator:"",sort:"newest"};
  $("notice").textContent="";
  document.querySelectorAll("[data-view]").forEach(n=>n.setAttribute("aria-current",n.dataset.view===view?"page":"false"));
  await loadView();
}
async function loadView() {
  const ticket=++generation;
  if(view==='app-settings'){await loadAppSettings();return;}
  if(view==="bot"){await loadBot();return;}
  if(view==="create"){createInvitation();return;}
  if(view==="dashboard"){
    const section=heading("Overview","Viewer accounts and invitations within your permitted scope.");
    const data=await api("/admin/dashboard");if(ticket!==generation)return;
    const stats=el("div",undefined,"stats");
    for(const [key,label] of Object.entries({total_users:"Current viewer accounts",active_users:"Active",disabled_users:"Disabled",expiring_soon:"Expiring within 14 days",active_sessions:"Active viewer sessions",unused_invites:"Unused valid codes",expired_users:"Expired · tracked",canceled_users:"Canceled · tracked",deleted_users:"Admin-deleted · tracked"})){
      const tile=el("div",undefined,"card stat");tile.append(el("strong",String(data.dashboard[key]||0)),el("span",label));stats.append(tile);
    }
    section.append(stats,el("p","Ended-account totals are anonymous counts. Deleted account details are not retained; older history that was already erased cannot be reconstructed.","help"));
    if(!admin.is_owner){
      const box=el("div",undefined,"card");box.append(el("h2","Your owner-assigned limits"));
      for(const [key,[label]] of Object.entries(LIMITS))box.append(el("p",label+": "+admin.permissions[key]));
      box.append(el("p","Unused valid codes reserve account capacity. Deleting a used code or account does not restore a lifetime creation credit. Contact the owner for a larger budget.","help"));section.append(box);
    }
    return;
  }
  const titles={users:["Users","Manage viewer access, remaining time and the administrator responsible for each account."],invites:["Invitations","Each code is redeemable once. Created and expiration times include the exact time of day."],admins:["Administrators","Only your owner login can create administrators, change their privileges, or disable their access."],activity:["Activity","A scoped record of administrative actions. Deleted viewer identities are not retained."]};
  const section=heading(...titles[view]),toolbar=el("div",undefined,"toolbar");section.append(toolbar);
  if(view==="admins")toolbar.append(button("Add administrator",()=>editAdmin(),"primary"));
  if(view!=="activity"){
    const search=field(toolbar,["invites","users"].includes(view)?"Search account, token or Telegram":"Search","search",listState.search,"search");search.parentElement.classList.add("search");
    let debounce;search.addEventListener("input",()=>{clearTimeout(debounce);debounce=setTimeout(()=>{listState.search=search.value;listState.page=1;run(()=>loadView());},400);});
    const statuses=view==="users"?["all","active","disabled","unlimited","expiring7","expiring14","expiring30"]:view==="admins"?["all","enabled","disabled"]:["all","unused","used","disabled","expired"];
    const status=select(toolbar,"Status","status",statuses.map(x=>[x,({expiring7:"Expiring in 7 days",expiring14:"Expiring in 14 days",expiring30:"Expiring in 30 days"})[x]||x]),listState.status);
    status.addEventListener("change",()=>{listState.status=status.value;listState.page=1;run(()=>loadView());});
  }
  const sorts=view==="users"?["newest","oldest","alphabetical","alphabetical_desc","expires_soon","most_time","last_login"]:view==="invites"?["newest","oldest","expires_soon","duration","creator"]:view==="admins"?["newest","oldest","alphabetical","accounts_created","last_login"]:["newest","oldest"];
  const sort=select(toolbar,"Sort by","sort",sorts.map(x=>[x,x.replaceAll("_"," ")]),listState.sort);
  sort.addEventListener("change",()=>{listState.sort=sort.value;listState.page=1;run(()=>loadView());});
  if(["users","invites"].includes(view)&&(admin.is_owner||permitted("can_manage_all"))){
    const options=[["","All administrators"],...creators.map(c=>[c.id,c.username]),...(view==="users"?[["unattributed","Unknown historical creator"]]:[])];
    const creator=select(toolbar,"Created by","creator",options,listState.creator);creator.addEventListener("change",()=>{listState.creator=creator.value;listState.page=1;run(()=>loadView());});
  }
  const size=select(toolbar,"Per page","page_size",[[25,"25"],[50,"50"],[100,"100"]],listState.page_size);
  size.addEventListener("change",()=>{listState.page_size=Number(size.value);listState.page=1;run(()=>loadView());});
  toolbar.append(button("Refresh",()=>loadView()));
  const loading=el("p","Loading…","muted");section.append(loading);
  const data=await api("/admin/"+view+"?"+new URLSearchParams(listState));if(ticket!==generation)return;
  loading.remove();const rows=data[view],pagination=data.pagination;
  listState.page=pagination.page;
  const columns={
    users:["Account","Status","Account time","Sessions","Created by","Created / last login",""],
    invites:["Code","Status","Used by","Account allowance","Created by","Created","Code expires / redeemed",""],
    admins:["Administrator","Access","Accounts created / active","Ended accounts","Invites / referrals","Last login",""],
    activity:["When","Administrator","Action","Viewer"],
  };
  const wrap=el("div",undefined,"table-wrap"),table=el("table"),head=el("thead"),tr=el("tr");
  columns[view].forEach(text=>tr.append(el("th",text)));head.append(tr);table.append(head);const body=el("tbody");table.append(body);wrap.append(table);section.append(wrap);
  for(const row of rows){
    const tr=el("tr"),values=view==="users"?userRow(row):view==="invites"?inviteRow(row):view==="admins"?adminRow(row):[date(row.created_at),row.admin_name||"—",row.action.replaceAll("_"," "),row.account_name||"—"];
    values.forEach(value=>{const td=el("td");td.append(value instanceof Node?value:document.createTextNode(String(value)));tr.append(td);});body.append(tr);
  }
  if(!rows.length)section.append(el("div","No matching records.","empty"));
  const pager=el("div",undefined,"pagination");
  const prev=button("← Previous",()=>{listState.page--;return loadView();}),next=button("Next →",()=>{listState.page++;return loadView();});
  prev.disabled=pagination.page<=1;next.disabled=pagination.page>=pagination.pages;
  pager.append(prev,el("span","Page "+pagination.page+" of "+pagination.pages+" · "+pagination.total+" records"),next);section.append(pager);
  if(view==="admins")section.append(el("p","Created/active/ended counts refer to direct admin-invite accounts. Referrals are shown separately. Deleted viewers leave anonymous totals only. Historical creator attribution is recovered only where the original invitation record still exists.","help"));
}
function userRow(u) {
  const actions=el("div",undefined,"actions");actions.append(button("Manage",()=>editUser(u)));
  return [cell(u.username,u.email+(u.telegram_id?" · Telegram: "+(u.telegram_username?"@"+u.telegram_username:u.telegram_name)+" · "+u.telegram_id:"")),badge(u.status),cell(remaining(u.expires_at),date(u.expires_at)),String(u.active_sessions)+" / "+u.max_sessions,
    cell(u.created_by_admin_name||"Unknown historical creator",u.origin==="referral"?"Via family / friend":u.origin==="admin_invite"?"Direct admin invite":"No surviving attribution"),cell(date(u.created_at),"Last login: "+date(u.last_login_at)),actions];
}
function inviteRow(i) {
  const actions=el("div",undefined,"actions");actions.append(button("Copy",()=>copy(i.invite_code)),button("Manage",()=>editInvite(i)));
  const usedBy=i.redeemed_by_username?cell(i.redeemed_by_username,i.redeemed_user_status==="disabled"?"Banned":i.redeemed_user_status):cell(i.redeemed_at?"Account no longer available":"Not used");
  return [cell(i.invite_code,i.telegram_id?"Telegram: "+(i.telegram_username?"@"+i.telegram_username:i.telegram_name)+" · "+i.telegram_id:"Manual / Admin"),badge(i.status),usedBy,cell(i.account_duration_days==null?"Unlimited":i.account_duration_days+" days",i.max_sessions+" simultaneous sessions"),i.created_by_admin_name||"—",date(i.created_at),cell(date(i.expires_at),"Redeemed: "+date(i.redeemed_at)),actions];
}
function editInvite(i) {
  const body=openDialog("Manage invitation","Revoking an unused token stops registration. A redeemed token cannot be reused; manage its account to stop access.");
  body.append(el("p",i.invite_code,"code"),el("p","Status: "+i.status),el("p","Created: "+date(i.created_at)),el("p","Redeemed: "+date(i.redeemed_at)),el("p","Used by: "+(i.redeemed_by_username||(i.redeemed_at?"Account no longer available":"Not used"))));
  const actions=el("div",undefined,"form-actions");body.append(actions);
  if(permitted("can_revoke_invites")&&i.status==="unused")actions.append(button("Revoke token",async()=>{
    if(!confirm("Revoke this unused invitation token? It will no longer create an account."))return;
    const result=await api("/admin/invites/"+i.id+"/revoke","POST",{});await saved(result.message);
  },"danger"));
  if(i.redeemed_by_username&&i.redeemed_user_role==="user")actions.append(button("Manage account",async()=>{
    const result=await api("/admin/users/"+encodeURIComponent(i.redeemed_by_user_id));
    $("dialog").close();editUser(result.user);
  },"primary"));
  else if(i.redeemed_user_role==="admin")body.append(el("p","This user is now an administrator. The owner can manage their access under Admins.","help"));
  if(permitted("can_delete_invites"))actions.append(button("Delete invitation history",async()=>{
    if(!confirm("Delete this invitation record? This does not cancel the account and cannot be undone."))return;
    const result=await api("/admin/invites/"+i.id,"DELETE");await saved(result.message);
  },"danger"));
}
function adminRow(a) {
  const actions=el("div",undefined,"actions");if(!a.is_owner)actions.append(button("Permissions",()=>editAdmin(a)),button("Viewing access",()=>editViewing(a)),button("Reset password",()=>resetAdmin(a)));
  return [cell(a.username,a.email),cell(a.is_owner?"Owner":a.enabled?"Panel enabled":"Panel disabled",a.is_owner?"Owner TV access":a.viewer_access?"TV: "+remaining(a.expires_at):"TV: not enabled"),cell(a.accounts_created+" created",a.active_accounts+" active · "+a.disabled_accounts+" disabled"),
    cell(a.accounts_expired+" expired",a.accounts_canceled+" canceled · "+a.accounts_deleted+" deleted"),
    cell(a.pending_invites+" pending · "+a.invites_created+" codes ever",a.referred_accounts+" current referred accounts"),date(a.last_login_at),actions];
}
function createInvitation() {
  const section=heading("Create invitation","Admin-issued access begins when the code is redeemed.");
  if(!permitted("can_create_invites")){section.append(el("p","The owner has not granted invitation creation."));return;}
  const card=el("div",undefined,"card");section.append(card);
  const f=form(card,async()=>{
    const result=await api("/admin/invites","POST",{account_duration_days:unlimited.checked?null:Number(days.value),max_sessions:Number(sessions.value),invite_expires_days:Number(valid.value)});
    const body=openDialog("Invitation ready","Share this code privately with its intended recipient.");
    body.append(el("p",result.invite.invite_code,"code"),el("p","Code expires: "+date(result.invite.expires_at)),el("p","Account: "+(result.invite.account_duration_days==null?"Unlimited · family invites disabled":result.invite.account_duration_days+" days after redemption")));
    body.append(button("Copy invitation code",()=>copy(result.invite.invite_code),"primary"));
  });
  const grid=el("div",undefined,"form-grid");f.append(grid);
  const days=field(grid,"Account duration (days)","days",30,"number",{min:1,max:admin.is_owner?3650:admin.permissions.max_duration_days,required:true});
  if(!admin.is_owner)days.value=Math.min(30,admin.permissions.max_duration_days);
  const sessions=field(grid,"Simultaneous sessions","sessions",1,"number",{min:1,max:admin.is_owner?20:admin.permissions.max_sessions,required:true});
  const valid=field(grid,"Unused code expires after (days)","valid",Math.min(7,admin.is_owner?365:admin.permissions.max_invite_valid_days),"number",{min:1,max:admin.is_owner?365:admin.permissions.max_invite_valid_days,required:true});
  const unlimited=check(f,"Unlimited viewer access · owner only","unlimited");unlimited.parentElement.hidden=!admin.is_owner;
  unlimited.addEventListener("change",()=>{days.disabled=unlimited.checked;});
  f.append(el("p","Unlimited viewer accounts cannot generate family-and-friend invites. Timed users' family invites inherit their remaining expiration date, never a fresh plan duration.","help"));submit(f,"Generate invitation");
}
function editUser(u) {
  const body=openDialog("Manage "+u.username,"Viewer account controls. Changes affect only this account; deleted personal information cannot be restored.");
  if(u.telegram_id)body.append(el("p","Telegram: "+(u.telegram_username?"@"+u.telegram_username:u.telegram_name)+" · ID "+u.telegram_id+" · "+u.telegram_status));
  const f=form(body,async()=>{
    const changes={};
    if(status&&!status.disabled&&status.value!==u.status)changes.status=status.value;
    if(sessions&&!sessions.disabled&&Number(sessions.value)!==u.max_sessions)changes.max_sessions=Number(sessions.value);
    if(unlimited?.checked && u.expires_at!==null)changes.expires_at=null;
    else if(extend&&!extend.disabled&&extend.value)changes.extend_days=Number(extend.value);
    else if(expiry&&!expiry.disabled&&expiry.value!==initialDate)changes.expires_at=expiry.value?Math.floor(new Date(expiry.value).getTime()/1000):null;
    if(!Object.keys(changes).length){message("No account changes selected.");return;}
    const deleting=changes.status==="expired"||(changes.expires_at!=null&&changes.expires_at<=Date.now()/1000);
    if(deleting&&!confirm("This will expire and permanently delete "+u.username+"'s account and personal information. Continue?"))return;
    const result=await api("/admin/users/"+u.id+(deleting?"?confirm_expire=yes":""),"PATCH",changes);await saved(result.message);
  });
  const grid=el("div",undefined,"form-grid");f.append(grid);
  const status=select(grid,"Status","status",[["active","Active"],["disabled","Banned (disabled)"],...(permitted("can_delete_users")?[["expired","Expire and permanently delete"]]:[])],u.status);status.disabled=!permitted("can_suspend")&&!permitted("can_delete_users");
  const sessions=field(grid,"Simultaneous sessions","sessions",u.max_sessions,"number",{min:1,max:admin.is_owner?20:admin.permissions.max_sessions,required:true,disabled:!permitted("can_change_sessions")});
  const timeAllowed=permitted("can_change_time")&&(admin.is_owner||u.expires_at!==null);
  const initialDate=u.expires_at===null?"":new Date(u.expires_at*1000-new Date(u.expires_at*1000).getTimezoneOffset()*60000).toISOString().slice(0,16);
  const expiry=field(grid,"Expiration date (your local time)","expires",initialDate,"datetime-local",{disabled:!timeAllowed});
  const extend=field(grid,"Or add days (leave blank for no extension)","extend","","number",{min:1,max:admin.is_owner?3650:admin.permissions.max_duration_days,disabled:!timeAllowed});
  const unlimited=admin.is_owner?check(f,"Unlimited viewer access · family invites disabled","unlimited",u.expires_at===null):null;
  function toggleTime(){expiry.disabled=!timeAllowed||!!unlimited?.checked;extend.disabled=expiry.disabled;expiry.required=timeAllowed&&!unlimited?.checked&&!extend.value;}
  unlimited?.addEventListener("change",toggleTime);extend.addEventListener("input",toggleTime);toggleTime();
  f.append(el("p","Current access: "+remaining(u.expires_at)+". Use either an expiration date or an extension. Delegated administrators cannot exceed their maximum resulting days remaining.","help"));
  submit(f,"Save account changes");
  const actions=el("div",undefined,"form-actions");body.append(actions);
  if(permitted("can_suspend"))actions.append(button(u.status==="disabled"?"Unban account":"Ban account",async()=>{
    const banning=u.status!=="disabled";
    if(!confirm((banning?"Ban ":"Unban ")+u.username+(banning?"? All current sessions will be revoked and login blocked.":"? They can sign in again while their account time remains valid.")))return;
    await api("/admin/users/"+u.id,"PATCH",{status:banning?"disabled":"active"});
    await saved(banning?"Account banned and all sessions revoked.":"Account unbanned. The user can sign in again.");
  },u.status==="disabled"?"primary":"danger"));
  if(admin.is_owner)actions.append(button("Give this user admin access",()=>{$("dialog").close();editAdmin(undefined,u.username);}));
  if(permitted("can_force_logout"))actions.append(button("Sign out all sessions",async()=>{if(confirm("Sign out every session for "+u.username+"?")){await api("/admin/users/"+u.id+"/logout","POST",{});await saved("All sessions revoked.");}}));
  if(permitted("can_reset_password"))actions.append(button("Reset password",()=>{ $("dialog").close();const target=openDialog("Reset viewer password",u.username+" will be signed out on all sessions.");const rf=form(target,async()=>{await api("/admin/users/"+u.id+"/reset-password","POST",{new_password:password.value});await saved("Password changed.");});const password=field(rf,"New password","password","","password",{required:true,minLength:8,maxLength:256,autocomplete:"new-password"});submit(rf,"Reset password");}));
  if(permitted("can_delete_users"))actions.append(button("Delete account",()=>{$("dialog").close();const target=openDialog("Permanently delete account","This removes "+u.username+"'s personal information and releases their inviter's eligible slot. This cannot be undone.");
    const df=form(target,async()=>{await api("/admin/users/"+u.id,"DELETE",{confirmation:confirmation.value});await saved("Account and personal data deleted.");});const confirmation=field(df,"Type "+u.username+" to confirm","confirmation","","text",{required:true});submit(df,"Permanently delete");},"danger"));
}
function editAdmin(existing,existingUsername="") {
  if(!admin.is_owner)return;
  const body=openDialog(existing?"Permissions · "+existing.username:"Add administrator","Only the owner can manage this area. An existing user can use one login for TV and this panel. Staff cannot add administrators or grant unlimited viewer access.");
  const f=form(body,async()=>{
    const permissions=Object.fromEntries(Object.keys(FLAGS).map(key=>[key,f.elements[key].checked?1:0]));
    for(const key of Object.keys(LIMITS))permissions[key]=Number(f.elements[key].value);
    permissions.enabled=f.elements.enabled.checked?1:0;
    const payload={permissions,owner_password:f.elements.owner_password.value};
    if(!existing){
      if(f.elements.account_mode.value==="existing")payload.existing_username=f.elements.existing_username.value;
      else Object.assign(payload,{username:f.elements.username.value,email:f.elements.email.value,password:f.elements.password.value,viewing_days:Number(f.elements.viewing_days.value)});
    }
    const result=await api("/admin/admins"+(existing?"/"+existing.id:""),existing?"PATCH":"POST",payload);
    creators=(await api("/admin/creators")).creators;await saved(result.message);
  });
  if(!existing){
    const mode=select(f,"Account to use","account_mode",[["existing","Use existing user"],["new","Create new shared login"]],"existing");
    const existingField=field(f,"Existing Charming MediaLab username","existing_username",existingUsername,"text",{required:true,autocomplete:"off"});
    const grid=el("div",undefined,"form-grid");f.append(grid);
    field(grid,"New username","username","","text",{required:true,minLength:3,maxLength:32,pattern:"[a-zA-Z0-9._-]{3,32}",autocomplete:"off"});
    field(grid,"Email","email","","email",{required:true,autocomplete:"off"});
    field(grid,"Initial password for app and panel (12+ characters)","password","","password",{required:true,minLength:12,maxLength:256,autocomplete:"new-password"});
    field(grid,"Initial TV access (days)","viewing_days",30,"number",{required:true,min:1,max:3650});
    const help=el("p","An existing user's username, email, password, remaining TV time and settings are preserved. Existing sessions are signed out once when admin access is granted. Deleted accounts cannot be restored through this option.","help");f.append(help);
    const toggle=()=>{const reuse=mode.value==="existing";existingField.parentElement.hidden=!reuse;existingField.disabled=!reuse;grid.hidden=reuse;grid.querySelectorAll("input").forEach(input=>input.disabled=reuse);};
    mode.addEventListener("change",toggle);toggle();
  }
  check(f,"Panel access enabled","enabled",existing?existing.enabled:1);
  f.append(el("h3","Privileges"));for(const [key,label] of Object.entries(FLAGS))check(f,label,key,existing?.permissions[key]||false);
  f.append(el("h3","Budgets and limits"),el("p","A zero account/code budget permits no creation. Valid unused codes reserve capacity. Open accounts include disabled accounts until expired/deleted. The lifetime budget is spent only when a code is redeemed; deleting history never restores it. Family referrals are tracked separately from direct admin creation.","help"));
  const grid=el("div",undefined,"form-grid");f.append(grid);
  for(const [key,[label,min,max,fallback]] of Object.entries(LIMITS))field(grid,label,key,existing?.permissions[key]??fallback,"number",{min,max,required:true});
  field(f,"Your current owner password to authorize these changes","owner_password","","password",{required:true,autocomplete:"current-password"});
  f.append(el("p","Changing permissions or disabling access revokes this administrator's current sessions. Existing viewer accounts and their expiration dates are unchanged.","help"));submit(f,existing?"Save permissions":"Create administrator");
}
function editViewing(a) {
  if(!admin.is_owner)return;
  const body=openDialog("Viewing access · "+a.username,"Use this same administrator username and password in Charming MediaLab. No invitation or second account is needed. Expired TV time stops viewing, but panel access remains.");
  const f=form(body,async()=>{
    const expiryValue=unlimited.checked?null:Math.floor(new Date(expiry.value).getTime()/1000);
    await api("/admin/admins/"+a.id+"/viewing","PATCH",{owner_password:ownerPassword.value,viewer_access:enabled.checked?1:0,expires_at:expiryValue,max_sessions:Number(sessions.value)});
    await saved("Viewing access saved. The administrator can sign in to the app with their existing login. Panel permissions are unchanged.");
  });
  const enabled=check(f,"Enable TV access with this login","viewer_access",a.viewer_access);
  const initial=a.expires_at==null?Date.now()+30*86400000:a.expires_at*1000;
  const expiry=field(f,"TV expiration (your local time)","expires_at",new Date(initial-new Date(initial).getTimezoneOffset()*60000).toISOString().slice(0,16),"datetime-local",{required:true});
  const unlimited=check(f,"Unlimited TV access · owner grant only; family invites disabled","unlimited",!!a.viewer_access&&a.expires_at==null);
  unlimited.addEventListener("change",()=>{expiry.disabled=unlimited.checked;expiry.required=!unlimited.checked;});expiry.disabled=unlimited.checked;expiry.required=!unlimited.checked;
  const sessions=field(f,"Simultaneous sessions","max_sessions",a.viewer_max_sessions||2,"number",{min:1,max:20,required:true});
  const ownerPassword=field(f,"Your owner password","owner_password","","password",{required:true,autocomplete:"current-password"});
  f.append(el("p","This does not recreate data from a previously deleted viewer account. Viewing changes sign out current sessions; sign in again with the same credentials.","help"));
  submit(f,"Save viewing access");
}
function resetAdmin(a) {
  const body=openDialog("Reset administrator password",a.username+" will be signed out. Your owner password is required.");
  const f=form(body,async()=>{await api("/admin/admins/"+a.id+"/password","POST",{owner_password:ownerPassword.value,new_password:password.value});await saved("Administrator password changed; sessions revoked.");});
  const password=field(f,"New administrator password","new_password","","password",{required:true,minLength:12,maxLength:256,autocomplete:"new-password"});
  const ownerPassword=field(f,"Your owner password","owner_password","","password",{required:true,autocomplete:"current-password"});submit(f,"Reset administrator password");
}
$("closeDialog").addEventListener("click",()=>$("dialog").close());
$("nav").addEventListener("click",e=>{const item=e.target.closest("[data-view]");if(item)run(()=>navigate(item.dataset.view));});
$("logout").addEventListener("click",()=>run(async()=>{try{await api("/auth/logout","POST",{});}finally{clearSession();}}));
$("loginForm").addEventListener("submit",e=>{e.preventDefault();const f=e.target;run(async()=>{try{
  $("loginError").textContent="";const data=await api("/auth/login","POST",{login:f.elements.login.value,password:f.elements.password.value});
  if(data.user.role!=="admin")throw new Error("This login is not an administrator account.");
  token=data.token;await openApp();f.elements.password.value="";
}catch(error){clearSession();$("loginError").textContent=error.message;}},f.querySelector("button"));});
if(token)run(async()=>{try{await openApp();}catch(error){clearSession();$("loginError").textContent=error.message;}});
