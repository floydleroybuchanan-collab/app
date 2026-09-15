import {q,rows,now,fail} from './bot-store.js';
import {currentTelegramAdmin} from './bot-commands.js';
import {saveAnnouncement,publishAnnouncement} from './announcements.js';
import {telegram,send} from './bot-telegram.js';
const keyboard=items=>({inline_keyboard:items.map(([text,value])=>[{text,callback_data:'announce:'+value}]).concat([[{text:'Cancel · Admin tools',callback_data:'admin'}]])});
async function store(env,id,step,data){await q(env,'INSERT INTO bot_conversations VALUES(?1,?2,?3,?4) ON CONFLICT(telegram_id) DO UPDATE SET state=excluded.state,json=excluded.json,updated_at=excluded.updated_at',id,'announce:'+step,JSON.stringify(data),now()).run();}
export async function botAnnouncementFlow(env,id,text,cmd,s){
 const existing=await q(env,'SELECT * FROM bot_conversations WHERE telegram_id=?1',id).first();
 const draft=existing?.state.startsWith('announce:')?existing:null;
 if(cmd!=='notify_update'&&!cmd.startsWith('announce:')&&!(draft&&text&&!text.startsWith('/')&&!/mr\.?\s*charm/i.test(text)))return false;
 if(!await currentTelegramAdmin(env,id,s,telegram))fail('Only current group admins can create app announcements.',403);
 if(env.BOT_GROUP_REPLY){
  await send(env,id,'Continue privately to compose the update notice. Only you can see the setup.',{inline_keyboard:[[{text:'Open private update editor',url:'https://t.me/'+s.bot_username+'?start=notify_update'}]]});return true;
 }
 if(cmd==='notify_update'){
  await store(env,id,'title',{kind:'update',version_code:0,audience:'outdated',user_ids:[],sound:true,reminder_hours:24});
  await send(env,id,'Update announcement · private admin editor\n\nEnter the title. Example: A new Charming MediaLab update is available.\n\nNothing is sent until you preview and publish.',keyboard([]));return true;
 }
 if(!draft||now()-draft.updated_at>600){await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();fail('This update editor expired. Choose Notify Update to start again.',410);}
 const data=JSON.parse(draft.json),step=draft.state.slice(9),answer=cmd.startsWith('announce:')?cmd.slice(9):text.trim();
 let next,prompt,choices=[];
 if(step==='title'){if(!answer||answer.length>100)fail('Use a title of 1–100 characters.');data.title=answer;next='message';prompt='Enter the message users should see (up to 1,200 characters).';}
 else if(step==='message'){if(!answer||answer.length>1200)fail('Use a message of 1–1,200 characters.');data.message=answer;next='version';prompt='Enter the APK’s Android version code. This is not the GitHub build number. Use the Android version code in your release guide (for example, 21).';}
 else if(step==='version'){const version=Number(answer);if(!Number.isSafeInteger(version)||version<1||version>2100000000)fail('Enter a valid positive Android version code.');data.version_code=version;next='url';prompt='Send the HTTPS link to the Telegram release message or download destination.';}
 else if(step==='url'){let url;try{url=new URL(answer);}catch{fail('Enter a valid HTTPS release link.');}if(url.protocol!=='https:'||url.username||url.password||url.hash||answer.length>2048)fail('Use an HTTPS link without embedded credentials.');data.url=answer;next='audience';prompt='Who should receive the update? Users who already installed this version will not be prompted.';choices=[['Everyone with an older version','outdated'],['Selected app accounts','selected']];}
 else if(step==='audience'){
  if(!['outdated','selected'].includes(answer))fail('Choose an audience button.');data.audience=answer;
  next=answer==='selected'?'users':'start';prompt=answer==='selected'?'Enter the app usernames, separated by commas.':'When should the announcement start?';choices=answer==='selected'?[]:[['Now','now'],['Schedule a time','schedule']];
 }
 else if(step==='users'){
  const names=[...new Set(answer.toLowerCase().split(/[\s,]+/).filter(Boolean))];if(!names.length||names.length>200)fail('Enter up to 200 usernames.');
  const accounts=await rows(env,'SELECT id FROM users WHERE lower(username) IN ('+names.map(()=>'?').join(',')+')',...names);
  if(accounts.length!==names.length)fail('One or more usernames were not found. Check them and try again.');data.user_ids=accounts.map(a=>a.id);next='start';prompt='When should the announcement start?';choices=[['Now','now'],['Schedule a time','schedule']];
 }
 else if(step==='start'){
  if(answer==='schedule'){next='datetime';prompt='Enter a date and time with its timezone, for example 2026-09-20T18:00:00-04:00.';}
  else if(answer==='now'){data.starts_at=now();next='duration';prompt='How long should the announcement remain active?';choices=[['1 day','1'],['3 days','3'],['7 days · recommended','7'],['14 days','14'],['30 days','30']];}
  else fail('Choose Now or Schedule a time.');
 }
 else if(step==='datetime'){
  if(!/(Z|[+-]\d{2}:\d{2})$/.test(answer))fail('Include the timezone offset, such as -04:00.');
  const time=Math.floor(Date.parse(answer)/1000);if(!Number.isSafeInteger(time)||time<now()||time>now()+90*86400)fail('Choose a future time within 90 days.');data.starts_at=time;next='duration';prompt='How long should it remain active?';choices=[['1 day','1'],['7 days · recommended','7'],['14 days','14'],['30 days','30']];
 }
 else if(step==='duration'){
  const days=Number(answer);if(!Number.isInteger(days)||days<1||days>90)fail('Choose 1–90 days.');data.expires_at=data.starts_at+days*86400;next='reminder';prompt='After a user dismisses the popup, when may it remind them?';choices=[['6 hours','6'],['Tomorrow · recommended','24'],['2 days','48'],['7 days','168']];
 }
 else if(step==='reminder'){
  const hours=Number(answer);if(!Number.isInteger(hours)||hours<1||hours>168)fail('Choose 1–168 hours.');data.reminder_hours=hours;next='sound';prompt='Play a soft chime on first display? Playback and the user’s sound preference take priority.';choices=[['Yes · one chime','yes'],['No sound','no']];
 }
 else if(step==='sound'){
  if(!['yes','no'].includes(answer))fail('Choose Yes or No.');data.sound=answer==='yes';
  const saved=await saveAnnouncement(env,data,'telegram:'+id);data.draft_id=saved.id;data.revision=saved.revision;
  next='preview';prompt='PREVIEW · '+data.title+'\n\n'+data.message+'\n\nAPK version code: '+data.version_code+'\nAudience: '+(data.audience==='selected'?data.user_ids.length+' selected accounts':'Everyone running an older version')+'\nStart: '+new Date(data.starts_at*1000).toISOString()+'\nEnd: '+new Date(data.expires_at*1000).toISOString()+'\nReminder: '+data.reminder_hours+' hours\nChime: '+(data.sound?'on':'off')+'\nDestination: '+data.url+'\n\nPublish this announcement?';choices=[['Publish / schedule announcement','publish'],['Keep as draft','draft']];
 }
 else if(step==='preview'){
  if(answer==='publish'){await publishAnnouncement(env,data.draft_id,data.revision,'telegram:'+id);await send(env,id,'Announcement published. Eligible apps will receive it when they next connect, after its start time. No playback is interrupted.');}
  else if(answer==='draft')await send(env,id,'Draft saved. Find it in Updates & Announcements in the panel. Nobody has been notified.');
  else fail('Choose Publish or Keep as draft.');
  await q(env,'DELETE FROM bot_conversations WHERE telegram_id=?1',id).run();return true;
 }
 else return false;
 await store(env,id,next,data);await send(env,id,prompt,keyboard(choices));return true;
}
