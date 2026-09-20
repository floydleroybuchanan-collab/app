import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER,NOW,DAY,PASSWORD} from './fixture.mjs';
import {accountAdminHelpers} from '../worker.js';
import {retainExpiredViewer} from '../account-retention.js';
const patch=(f,id,body,token=f.ownerToken)=>f.request('/admin/users/'+id,{method:'PATCH',token,body});
test('expired viewer keeps credentials, preferences and Telegram link, loses access and appears in expired list',async()=>{
 const f=fixture(),u=f.user('retained',{expires_at:NOW()-DAY}),token=f.token(u.id);
 f.db.prepare('INSERT INTO user_preferences(user_id,preferences_json,updated_at) VALUES(?,?,?)').run(u.id,'{"saved":true}',NOW());
 f.db.prepare("INSERT INTO bot_members(telegram_id,name,status,updated_at,account_id) VALUES('12345','Retained','member',?,?)").run(NOW(),u.id);
 const before=f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(u.id).password_hash;
 const r=await f.request('/admin/users?status=expired',{token:f.ownerToken});assert.equal(r.status,200);assert.equal(r.body.users[0].username,u.username);assert.equal(r.body.users[0].status,'expired');
 assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(u.id).password_hash,before);
 assert.equal(f.db.prepare('SELECT account_id FROM bot_members').get().account_id,u.id);
 assert.ok(f.db.prepare('SELECT * FROM user_preferences WHERE user_id=?').get(u.id));
 assert.equal((await f.request('/content/access',{token})).status,401);
 const login=await f.request('/auth/login',{method:'POST',body:{username:u.username,password:PASSWORD}});assert.equal(login.status,403);assert.match(login.body.error,/30 days/);
 const dashboard=await f.request('/admin/dashboard',{token:f.ownerToken});assert.equal(dashboard.body.dashboard.retained_expired_users,1);assert.equal(dashboard.body.dashboard.active_users,0);
});
test('30-day deadline is anchored to expiration; repeat cleanup does not extend it and deadline purges personal data',async()=>{
 const f=fixture(),u=f.user('deadline',{expires_at:NOW()-29*DAY});f.token(u.id);
 await f.request('/health');const original=f.db.prepare('SELECT expires_at FROM users WHERE id=?').get(u.id).expires_at;
 await retainExpiredViewer(f.env,u.id,NOW()+60);assert.equal(f.db.prepare('SELECT expires_at FROM users WHERE id=?').get(u.id).expires_at,original);
 f.db.prepare('UPDATE users SET expires_at=? WHERE id=?').run(NOW()-30*DAY,u.id);
 await f.request('/health');assert.equal(f.db.prepare('SELECT * FROM users WHERE id=?').get(u.id),undefined);assert.equal(f.db.prepare('SELECT * FROM sessions WHERE user_id=?').get(u.id),undefined);
});
test('reactivation retains identity and starts new period now; old sessions stay revoked',async()=>{
 const f=fixture(),u=f.user('returning',{expires_at:NOW()-5*DAY}),old=f.token(u.id);
 const r=await patch(f,u.id,{status:'active',extend_days:20});assert.equal(r.status,200,JSON.stringify(r));assert.match(r.body.message,/reactivated/);
 const row=f.db.prepare('SELECT * FROM users WHERE id=?').get(u.id);assert.equal(row.status,'active');assert.ok(row.expires_at>=NOW()+20*DAY-2);
 assert.equal((await f.request('/me',{token:old})).status,401);
 assert.equal((await f.request('/auth/login',{method:'POST',body:{username:u.username,password:PASSWORD}})).status,200);
 // Simulate a cleanup worker that selected this account before reactivation.
 await accountAdminHelpers().deleteAccountData(f.env,u.id,'account_expired',NOW()-30*DAY);
 assert.ok(f.db.prepare('SELECT * FROM users WHERE id=?').get(u.id));
});
test('manual expiration retains for 30 days, repeated expiration cannot restart the clock, explicit delete remains immediate',async()=>{
 const f=fixture(),u=f.user('manual');
 assert.equal((await patch(f,u.id,{status:'expired'})).status,400);
 const r=await f.request('/admin/users/'+u.id+'?confirm_expire=yes',{method:'PATCH',token:f.ownerToken,body:{status:'expired'}});assert.equal(r.status,200);
 assert.equal(f.db.prepare('SELECT status FROM users WHERE id=?').get(u.id).status,'expired');
 const anchor=NOW()-8*DAY;f.db.prepare('UPDATE users SET expires_at=? WHERE id=?').run(anchor,u.id);
 await f.request('/admin/users/'+u.id+'?confirm_expire=yes',{method:'PATCH',token:f.ownerToken,body:{status:'expired'}});
 assert.equal(f.db.prepare('SELECT expires_at FROM users WHERE id=?').get(u.id).expires_at,anchor);
 assert.equal((await patch(f,u.id,{status:'active'})).status,400);
 assert.equal((await f.request('/admin/users/'+u.id,{method:'DELETE',token:f.ownerToken,body:{confirmation:u.username}})).status,200);
 assert.equal(f.db.prepare('SELECT id FROM users WHERE id=?').get(u.id),undefined);
});
test('staff reactivation respects scope, permissions, duration and account capacity',async()=>{
 const f=fixture(),a=await f.staff('admina',{can_change_time:1,can_suspend:1,max_open_accounts:1}),b=await f.staff('adminb',{can_change_time:1,can_suspend:1});
 const i=await f.invite(a.token),r=await f.redeem(i.body.invite.invite_code,'oldviewer'),id=r.body.user.id;
 f.db.prepare('UPDATE users SET expires_at=? WHERE id=?').run(NOW()-DAY,id);
 assert.equal((await patch(f,id,{extend_days:10},b.token)).status,404);
 f.db.prepare('UPDATE admin_profiles SET can_suspend=0 WHERE user_id=?').run(a.id);
 assert.equal((await patch(f,id,{extend_days:10},a.token)).status,403);
 f.db.prepare('UPDATE admin_profiles SET can_suspend=1 WHERE user_id=?').run(a.id);
 assert.equal((await patch(f,id,{extend_days:100},a.token)).status,403);
 const other=await f.invite(a.token),newUser=await f.redeem(other.body.invite.invite_code,'newviewer');assert.equal(newUser.status,201);
 assert.equal((await patch(f,id,{extend_days:10},a.token)).status,403);
 assert.equal((await patch(f,id,{extend_days:10})).status,200);
});
test('expired administrators are not retained or purged as viewers and unlimited viewers remain active',async()=>{
 const f=fixture(),a=await f.staff('expiredadmin');f.db.prepare('UPDATE users SET expires_at=? WHERE id=?').run(NOW()-40*DAY,a.id);
 f.user('unlimited',{expires_at:null});await f.request('/health');
 assert.ok(f.db.prepare('SELECT id FROM users WHERE id=?').get(a.id));
 assert.equal(f.db.prepare("SELECT status FROM users WHERE username='unlimited'").get().status,'active');
 assert.equal((await f.request('/admin/me',{token:a.token})).status,200);
});
