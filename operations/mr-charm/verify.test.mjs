import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { patchApi, patchPanel } from './patch-live-worker.mjs';

const original = readFileSync(process.env.CHARM_WORKER || new URL('./fixtures/worker-before.mjs',import.meta.url),'utf8');
const schema = readFileSync(process.env.CHARM_SCHEMA || new URL('./fixtures/schema.sql',import.meta.url),'utf8');
const migration = readFileSync(new URL('./20261009_bot_invitation_sources.sql',import.meta.url),'utf8');
const extension = readFileSync(new URL('./banter-extension.js',import.meta.url),'utf8');
const patched = patchApi(original,extension);
const exported = '\nexport {UNKNOWN_REPLIES,TRIGGER_REPLIES,banterReply,credibleCharmThreat,isAddressed,isInternalStart,addressedText,handleUpdate,assignToken,member,invitationCreatorLine,adminApi};';
const mod = await import('data:text/javascript;base64,'+Buffer.from(patched+exported).toString('base64'));
const old = await import('data:text/javascript;base64,'+Buffer.from(original+'\nexport {UNKNOWN_REPLIES,TRIGGER_REPLIES,handleUpdate};').toString('base64'));
const now = () => Math.floor(Date.now()/1000);
const password='Test-only-password!';
const salt=Buffer.alloc(16,7);
const hash=['pbkdf2-sha256',60000,salt.toString('base64'),pbkdf2Sync(password,salt,60000,32,'sha256').toString('base64')].join('$');
const digest=s=>createHash('sha256').update(s).digest('hex');
const config={enabled:true,group_id:'-100123',bot_username:'test_only_bot',auto_tokens:true,accounts_enabled:true,token_days:90,connections:2,invite_days:3,downloads_enabled:true,download_codes:[{label:'App',code:'12345',enabled:true}]};

function fixture({migrate=true}={}) {
 const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON;'+schema);
 db.prepare('INSERT INTO users(id,username,email,password_hash,role,status,expires_at) VALUES(?,?,?,?,?,?,?)').run('owner','saintownz','owner@example.test',hash,'admin','active',null);
 db.exec("INSERT INTO admin_owner VALUES(1,'owner'); INSERT INTO admin_profiles(user_id) VALUES('owner'); INSERT INTO admin_account_stats(admin_user_id) VALUES('owner');");
 db.prepare('INSERT INTO bot_settings VALUES(1,?,1)').run(JSON.stringify(config));
 if(migrate) db.exec(migration);
 const calls=[]; let sequence=100;
 function prepare(sql,values=[]) {
  function execute(kind) {const st=db.prepare(sql);const params=/\?[1-9]/.test(sql)?[Object.fromEntries(values.map((v,i)=>[String(i+1),v??null]))]:values; return st[kind](...params);}
  return {bind:(...v)=>prepare(sql,v),_run(){const r=execute('run');return {meta:{changes:Number(r.changes)}};},async run(){return this._run();},async all(){return {results:execute('all')};},async first(){return execute('get')||null;}};
 }
 const env={DB:{prepare,async batch(statements){db.exec('BEGIN IMMEDIATE');try{const r=statements.map(s=>s._run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},TELEGRAM_BOT_TOKEN:'TEST_ONLY',TELEGRAM_WEBHOOK_SECRET:'TEST_ONLY',TELEGRAM_FETCH:async(url,init)=>{
  const method=url.split('/').at(-1),body=JSON.parse(init.body);calls.push({method,body});
  const result=method==='approveChatJoinRequest'?true:method==='getChatMember'?{status:'member',user:{id:body.user_id,first_name:'Tester'}}:method==='getChatAdministrators'?[]:{message_id:++sequence,ephemeral_message_id:sequence,chat:{id:body.chat_id}};
  return Response.json({ok:true,result});
 }};
 const token='local-owner-session';db.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)').run('owner-session','owner',digest(token),now()+86400);
 async function api(path,{method='GET',body,bearer=token}={}) {const r=await mod.default.fetch(new Request('https://test.example'+path,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:r.status,body:await r.json()};}
 async function message(text,extra={}) {return mod.handleUpdate(env,{update_id:++sequence,message:{message_id:sequence,from:{id:12345,first_name:'Tester'},chat:{id:12345,type:'private'},text,...extra}},config);}
 return {db,env,calls,api,message};
}

test('all pre-existing conversational responses retained; pools deduplicated and varied',()=>{
 for(const r of old.UNKNOWN_REPLIES)assert.ok(mod.UNKNOWN_REPLIES.includes(r));
 for(const [key,list] of Object.entries(old.TRIGGER_REPLIES))for(const r of list)assert.ok(mod.TRIGGER_REPLIES[key].includes(r));
 assert.equal(new Set(mod.UNKNOWN_REPLIES).size,mod.UNKNOWN_REPLIES.length);
 for(const list of Object.values(mod.TRIGGER_REPLIES)){assert.equal(list.length,new Set(list).size);assert.ok(list.length>=3);}
 const sample=new Set(Array.from({length:60},()=>mod.banterReply('MR. CHARM you’re a bitch!!!')));assert.ok(sample.size>1);
});
test('strict address prefix and onboarding-only internal starts',()=>{
 for(const text of ['Mr Charm hi','mr. charm hi','MR CHARM hi','Mr Charm'])assert.ok(mod.isAddressed(text));
 for(const text of ['MrCharm hi','Mr.Charm hi','hey Mr Charm hi','@MrCharm hi','/help','/start usage','/start admin_invite'])assert.equal(mod.isAddressed(text),false);
 assert.equal(mod.isInternalStart('/start help'),true);assert.equal(mod.isInternalStart('/start flow_'+'a'.repeat(48)),true);assert.equal(mod.isInternalStart('/start usage'),false);
 assert.equal(mod.addressedText('MrCharm insult'),null);
});
test('ordinary replies, mentions and slash commands stay silent',async()=>{
 const f=fixture();for(const text of ['fuck you','@MrCharmBot fuck you','/help','/token','/start usage','hey Mr Charm fuck you','MrCharm fuck you'])await f.message(text,{reply_to_message:{from:{is_bot:true}}});
 assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM bot_members').get().n,0);
});
test('addressed insults use phrase pools; unknown requests use preserved fallback',async()=>{
 const f=fixture();await f.message('Mr Charm suck my dick');assert.ok(mod.TRIGGER_REPLIES['suck my dick'].includes(f.calls.find(c=>c.method==='sendMessage').body.text));
 f.calls.length=0;await f.message('Mr. Charm i am a space waffle');assert.ok(mod.UNKNOWN_REPLIES.includes(f.calls.find(c=>c.method==='sendMessage').body.text));
});
test('credible violence and self-harm bypass sarcasm and record review without raw text',async()=>{
 for(const [text,kind] of [["Mr Charm I'm going to shoot @alex tonight",'violence'],["Mr Charm I'm going to kill myself tonight",'self_harm'],['Mr Charm I will kill John','violence']]){
  const f=fixture();await f.message(text);const reply=f.calls.find(c=>c.method==='sendMessage').body.text;assert.match(reply,/immediate danger/);assert.doesNotMatch(reply,/fuck|shit/);
  const event=f.db.prepare("SELECT detail FROM bot_events WHERE action='credible_threat_review'").get();assert.match(event.detail,new RegExp(kind));assert.ok(!event.detail.includes('@alex'));
 }
 assert.equal(mod.credibleCharmThreat("Mr Charm I'm going to slap the shit out of you"),null);
 assert.equal(mod.credibleCharmThreat("Mr Charm Don't make me beat your ass"),null);
});
test('app commands and callbacks retain their existing response bodies',async()=>{
 for(const text of ['Mr Charm Help','Mr Charm Rules','Mr Charm Downloads']){
  const a=fixture(),b=fixture();const update={update_id:1,message:{message_id:1,from:{id:12345,first_name:'Tester'},chat:{id:12345,type:'private'},text}};
  await old.handleUpdate(a.env,structuredClone(update),config);await mod.handleUpdate(b.env,structuredClone(update),config);
  const sent=f=>f.calls.filter(c=>c.method.startsWith('send')).map(c=>c.body.text);assert.deepEqual(sent(a),sent(b));
 }
 const f=fixture();await mod.handleUpdate(f.env,{update_id:99,callback_query:{id:'callback',from:{id:12345,first_name:'Tester'},message:{message_id:10,chat:{id:12345,type:'private'}},data:'help'}},config);
 assert.ok(f.calls.some(c=>c.method==='answerCallbackQuery'));assert.ok(f.calls.some(c=>c.method==='sendMessage'||c.method==='editMessageText'));
});
test('source migration proves bot origin and leaves panel-created Telegram-linked invitations intact',async()=>{
 const f=fixture({migrate:false});await mod.member(f.env,{id:12345,first_name:'Tester'},'member');const inv=await mod.assignToken(f.env,'12345',config);
 f.db.exec("INSERT INTO invites(id,invite_code,created_by_user_id,created_at) VALUES('manual','MANUAL','owner',1); INSERT INTO bot_members(telegram_id,name,updated_at,invite_id) VALUES('98765','Manual linked',1,'manual');");
 f.db.exec(migration);assert.equal(f.db.prepare('SELECT count(*) n FROM bot_invitation_sources').get().n,1);assert.equal(f.db.prepare('SELECT creator_label FROM bot_invitation_sources WHERE invite_id=?').get(inv.id).creator_label,'Mr Charm');
 assert.equal(f.db.prepare("SELECT created_by_user_id FROM invites WHERE id='manual'").get().created_by_user_id,'owner');
 const audits=f.db.prepare('SELECT count(*) n FROM audit_log').get().n;f.db.exec(migration);assert.equal(f.db.prepare('SELECT count(*) n FROM audit_log').get().n,audits);
});
test('new bot issuance is atomic, labelled and does not create an impersonating administrator',async()=>{
 const f=fixture();await mod.member(f.env,{id:12345,first_name:'Tester'},'member');await Promise.all(Array.from({length:4},()=>mod.assignToken(f.env,'12345',config)));
 assert.equal(f.db.prepare('SELECT count(*) n FROM invites').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM bot_invitation_sources').get().n,1);
 const inv=f.db.prepare('SELECT * FROM invites').get();assert.equal(await mod.invitationCreatorLine(f.env,inv),'\nCreated by Mr Charm');assert.equal(inv.created_by_user_id,'owner');
 assert.equal(f.db.prepare("SELECT count(*) n FROM users WHERE role='admin'").get().n,1);
 const list=await f.api('/admin/invites');assert.equal(list.status,200);assert.equal(list.body.invites[0].created_by_admin_name,'Mr Charm');assert.equal(list.body.invites[0].created_by_user_id,null);assert.equal(list.body.invites[0].authorizing_admin_id,'owner');
 const admin=await f.api('/admin/admins');assert.equal(admin.status,200);assert.equal(admin.body.admins[0].invites_created,0);
});
test('bot registration still requires recipient approval; manual panel registration keeps saintownz',async()=>{
 const f=fixture();await mod.member(f.env,{id:12345,first_name:'Tester'},'member');const inv=await mod.assignToken(f.env,'12345',config);
 const body={invite_code:inv.invite_code,username:'botviewer',email:'botviewer@example.test',password};
 assert.equal((await f.api('/auth/register',{method:'POST',body,bearer:''})).status,403);
 const proof='a'.repeat(48);
 f.db.prepare("INSERT INTO account_challenges(id,kind,telegram_id,token_hash,bot_hash,code_hash,payload,status,created_at,expires_at) VALUES('challenge','registration','12345',?,?,?,?,'approved',?,?)").run(digest(proof),digest('bot-proof'),digest('code-proof'),JSON.stringify({invite_id:inv.id,username:body.username,email:body.email}),now(),now()+600);
 const registered=await f.api('/auth/register',{method:'POST',body:{...body,challenge_token:proof},bearer:''});assert.equal(registered.status,201,JSON.stringify(registered.body));
 const user=f.db.prepare('SELECT * FROM bot_invitation_sources').get();assert.equal(user.account_id,registered.body.user.id);
 const manual=await f.api('/admin/invites',{method:'POST',body:{account_duration_days:30,max_sessions:2,invite_expires_days:3}});assert.equal(manual.status,201);
 assert.equal((await f.api('/auth/register',{method:'POST',body:{invite_code:manual.body.invite.invite_code,username:'manualviewer',email:'manualviewer@example.test',password},bearer:''})).status,201);
 const users=await f.api('/admin/users');assert.equal(users.status,200);assert.equal(users.body.users.find(u=>u.username==='botviewer').created_by_admin_name,'Mr Charm');assert.equal(users.body.users.find(u=>u.username==='manualviewer').created_by_admin_name,'saintownz');
 const filtered=await f.api('/admin/users?creator=bot_telegram');assert.equal(filtered.body.users.length,1);
 const human=await f.api('/admin/users?creator=owner');assert.equal(human.body.users.length,1);
 const admins=await f.api('/admin/admins');assert.equal(admins.body.admins[0].accounts_created,1);assert.equal(admins.body.admins[0].invites_created,1);
 const activity=await f.api('/admin/users/'+registered.body.user.id+'/activity');assert.equal(activity.status,200);assert.ok(activity.body.activity.events.some(e=>e.action==='account_registered'&&e.admin_name==='Mr Charm'));
 assert.equal((await f.api('/admin/users',{bearer:'invalid'})).status,401);
});
test('panel projection recognizes explicit bot source',()=>{
 const from='u.origin==="referral"?"Via family / friend":u.origin==="admin_invite"?"Direct admin invite":"No surviving attribution"';
 assert.match(patchPanel(from),/Telegram bot onboarding/);
});
test('automated app-to-Telegram join still sends welcome and labelled token before approval',async()=>{
 const f=fixture();await mod.handleUpdate(f.env,{update_id:777,chat_join_request:{chat:{id:Number(config.group_id)},from:{id:12345,first_name:'New member'},date:now(),user_chat_id:12345}},config);
 const approval=f.calls.findIndex(c=>c.method==='approveChatJoinRequest');assert.ok(approval>=0);
 const token=f.calls.findIndex(c=>c.method==='sendMessage'&&c.body.text.includes('invitation token:'));assert.ok(token>=0&&token<approval);assert.match(f.calls[token].body.text,/Created by Mr Charm/);
 const progress=f.db.prepare('SELECT * FROM bot_join_requests').get();assert.equal(progress.state,'approved');assert.equal(progress.token_sent,1);assert.equal(progress.welcome_sent,1);
});
test('verified Telegram admin issuance records bot origin; external callers cannot forge the source',async()=>{
 const f=fixture();await mod.member(f.env,{id:12345,first_name:'Admin'},'administrator');f.db.exec("UPDATE bot_members SET account_id='owner' WHERE telegram_id='12345'");
 f.env.TELEGRAM_FETCH=async()=>Response.json({ok:true,result:{status:'administrator',user:{id:12345,first_name:'Admin'}}});
 const api=await mod.adminApi(f.env,'12345',config);const r=await api.call('/admin/invites','POST',{account_duration_days:30,max_sessions:2,invite_expires_days:3});
 assert.equal(r.invite.created_by_admin_name,'Mr Charm');assert.equal(f.db.prepare('SELECT count(*) n FROM bot_invitation_sources').get().n,1);
 assert.equal(f.db.prepare('SELECT created_by_user_id FROM invites').get().created_by_user_id,'owner');
 assert.equal((await f.api('/admin/invites',{method:'POST',body:{account_duration_days:30,max_sessions:2,invite_expires_days:3,source:'bot_telegram'}})).status,400);
 const manual=await f.api('/admin/invites',{method:'POST',body:{account_duration_days:30,max_sessions:2,invite_expires_days:3}});assert.equal(manual.body.invite.created_by_admin_name,'saintownz');
 assert.equal(f.db.prepare('SELECT count(*) n FROM bot_invitation_sources').get().n,1);
});
console.log(JSON.stringify({existing_fallbacks:old.UNKNOWN_REPLIES.length,existing_phrase_keys:Object.keys(old.TRIGGER_REPLIES).length,existing_phrase_replies:Object.values(old.TRIGGER_REPLIES).flat().length,final_fallbacks:mod.UNKNOWN_REPLIES.length,final_phrase_keys:Object.keys(mod.TRIGGER_REPLIES).length,final_phrase_replies:Object.values(mod.TRIGGER_REPLIES).flat().length}));
