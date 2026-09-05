import test from "node:test";
import assert from "node:assert/strict";
import { fixture, OWNER, PASSWORD, NOW, DAY } from "./fixture.mjs";
import { normalizeAdminProfile } from "../admin-policy.js";

test("owner is pinned, administrator directory excludes viewer accounts and never exposes hashes", async()=>{
 const f=fixture(); f.user("viewer");
 const me=await f.request("/admin/me",{token:f.ownerToken}); assert.equal(me.body.admin.is_owner,true);
 const admins=await f.request("/admin/admins",{token:f.ownerToken}); assert.equal(admins.status,200); assert.equal(admins.body.admins.length,1);
 assert.equal(admins.body.admins[0].id,OWNER); assert.equal(JSON.stringify(admins.body).includes("password_hash"),false);
 const users=await f.request("/admin/users",{token:f.ownerToken}); assert.equal(users.status,200); assert.equal(users.body.users.length,1);
 assert.equal(users.body.users[0].username,"viewer");
 assert.equal((await f.request("/admin/admins",{token:f.token("viewer")})).status,403);
});
test("only owner can create/change staff, and cannot change the owner via these routes",async()=>{
 const f=fixture(), s=await f.staff();
 for(const path of ["/admin/admins","/admin/admins/"+s.id])
  assert.equal((await f.request(path,{method:path.endsWith(s.id)?"PATCH":"POST",token:s.token,body:{owner_password:PASSWORD}})).status,403);
 for(const action of [{method:"DELETE",path:"/admin/users/"+OWNER},{method:"POST",path:"/admin/users/"+OWNER+"/reset-password"},{method:"PATCH",path:"/admin/users/"+s.id}])
  assert.equal((await f.request(action.path,{...action,token:s.token,body:{role:"admin",new_password:PASSWORD}})).status,404);
 assert.equal((await f.request("/admin/admins/"+OWNER,{method:"PATCH",token:f.ownerToken,body:{owner_password:PASSWORD,permissions:{enabled:0}}})).status,403);
 assert.equal((await f.request("/admin/admins",{method:"POST",token:f.ownerToken,body:{owner_password:"wrong"}})).status,403);
 assert.equal((await f.request("/content/access",{token:s.token})).status,403);
 assert.equal((await f.request("/content/access",{token:f.ownerToken})).status,200);
});
test("staff can only see/manage attributed accounts unless owner explicitly grants all-account scope",async()=>{
 const f=fixture(), s=await f.staff("staff",{can_change_time:1,can_change_sessions:1,can_suspend:1});
 const i=await f.invite(s.token); assert.equal(i.status,201);
 const r=await f.redeem(i.body.invite.invite_code,"newviewer"); assert.equal(r.status,201,JSON.stringify(r));
 f.user("unrelated");
 const list=await f.request("/admin/users",{token:s.token});
 assert.equal(list.status,200); assert.equal(list.body.users.length,1); assert.equal(list.body.users[0].created_by_admin_name,"staff");
 assert.equal((await f.request("/admin/users/unrelated",{method:"PATCH",token:s.token,body:{status:"disabled"}})).status,404);
 assert.equal((await f.request("/admin/users/"+r.body.user.id,{method:"PATCH",token:s.token,body:{role:"admin"}})).status,400);
 assert.equal((await f.request("/admin/users?creator=unattributed",{token:s.token})).status,403);
});
test("only owner can grant unlimited; staff cannot exceed duration, session or code validity limits",async()=>{
 const f=fixture(),s=await f.staff();
 for(const terms of [{account_duration_days:null},{account_duration_days:91},{max_sessions:3},{invite_expires_days:null},{invite_expires_days:8}])
  assert.equal((await f.invite(s.token,terms)).status,403);
 const unlimited=await f.invite(f.ownerToken,{account_duration_days:null});
 assert.equal(unlimited.status,201); const r=await f.redeem(unlimited.body.invite.invite_code);
 assert.equal(r.status,201); assert.equal(r.body.user.expires_at,null);
 assert.equal((await f.request("/referrals/invites",{method:"POST",token:r.body.token,body:{}})).status,403);
 assert.equal((await f.request("/referrals",{token:r.body.token})).body.referral.available,0);
});
test("pending invite reservations and permanent creation counts enforce quotas under rapid requests",async()=>{
 const f=fixture(),s=await f.staff("staff",{max_accounts_total:1,max_open_accounts:1,max_pending_invites:1,can_delete_invites:1,can_delete_users:1});
 const results=await Promise.all([f.invite(s.token),f.invite(s.token),f.invite(s.token)]);
 assert.equal(results.filter(x=>x.status===201).length,1);
 const i=results.find(x=>x.status===201).body.invite, r=await f.redeem(i.invite_code,"quotauser");
 assert.equal(r.status,201);
 assert.equal((await f.request("/admin/invites/"+i.id,{method:"DELETE",token:s.token})).status,200);
 assert.equal(f.db.prepare("SELECT admin_user_id FROM admin_user_attribution WHERE user_id=?").get(r.body.user.id).admin_user_id,s.id);
 assert.equal((await f.request("/admin/users/"+r.body.user.id,{method:"DELETE",token:s.token,body:{confirmation:"quotauser"}})).status,200);
 assert.equal((await f.invite(s.token)).status,409);
 assert.equal(f.db.prepare("SELECT accounts_created,accounts_deleted FROM admin_account_stats WHERE admin_user_id=?").get(s.id).accounts_deleted,1);
});
test("disabling staff revokes sessions and stops unused code redemption",async()=>{
 const f=fixture(),s=await f.staff(),i=await f.invite(s.token);
 const update=await f.request("/admin/admins/"+s.id,{method:"PATCH",token:f.ownerToken,body:{owner_password:PASSWORD,permissions:{enabled:0}}});
 assert.equal(update.status,200); assert.equal((await f.request("/admin/me",{token:s.token})).status,401);
 assert.equal((await f.redeem(i.body.invite.invite_code)).status,409);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM users WHERE role='user'").get().n,0);
});
test("a reduced staff time limit prevents redemption of an older longer-duration code",async()=>{
 const f=fixture(),s=await f.staff(),i=await f.invite(s.token,{account_duration_days:90});
 await f.request("/admin/admins/"+s.id,{method:"PATCH",token:f.ownerToken,body:{owner_password:PASSWORD,permissions:{max_duration_days:30}}});
 assert.equal((await f.redeem(i.body.invite.invite_code)).status,409);
});
test("repeated extensions cannot exceed staff remaining-time ceiling; no unlimited conversion",async()=>{
 const f=fixture(),s=await f.staff("staff",{can_change_time:1}),i=await f.invite(s.token),r=await f.redeem(i.body.invite.invite_code);
 const path="/admin/users/"+r.body.user.id;
 assert.equal((await f.request(path,{method:"PATCH",token:s.token,body:{extend_days:40}})).status,200);
 assert.equal((await f.request(path,{method:"PATCH",token:s.token,body:{extend_days:40}})).status,403);
 assert.equal((await f.request(path,{method:"PATCH",token:s.token,body:{expires_at:null}})).status,403);
});
test("referrals inherit remaining expiry, recheck shortened inviter and never restart days or spread unlimited",async()=>{
 const f=fixture(),parent=f.user("parent",{expires_at:NOW()+45*DAY}),token=f.token(parent.id);
 const i=await f.request("/referrals/invites",{method:"POST",token,body:{}});
 assert.equal(i.status,201); assert.ok(i.body.invitation.expires_at<=NOW()+3*DAY);
 const shorter=NOW()+15*DAY; f.db.prepare("UPDATE users SET expires_at=? WHERE id=?").run(shorter,parent.id);
 const r=await f.redeem(i.body.invitation.invite_code,"child"); assert.equal(r.status,201,JSON.stringify(r));
 assert.equal(r.body.user.expires_at,shorter);
 const next=await f.request("/referrals/invites",{method:"POST",token:r.body.token,body:{}});
 const descendant=await f.redeem(next.body.invitation.invite_code,"grandchild"); assert.equal(descendant.body.user.expires_at,shorter);
 const pending=await f.request("/referrals/invites",{method:"POST",token,body:{}});
 f.db.prepare("UPDATE users SET expires_at=NULL WHERE id=?").run(parent.id);
 assert.equal((await f.redeem(pending.body.invitation.invite_code)).status,410);
});
test("duplicate redemption is atomic and does not leave an extra account or double-count",async()=>{
 const f=fixture(),i=await f.invite();
 const results=await Promise.all([f.redeem(i.body.invite.invite_code,"one"),f.redeem(i.body.invite.invite_code,"two")]);
 assert.equal(results.filter(x=>x.status===201).length,1); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM users WHERE role='user'").get().n,1);
 assert.equal(f.db.prepare("SELECT accounts_created FROM admin_account_stats WHERE admin_user_id=?").get(OWNER).accounts_created,1);
});
test("cancellation erases personal data and attribution but retains only anonymous creator totals",async()=>{
 const f=fixture(),i=await f.invite(),r=await f.redeem(i.body.invite.invite_code,"canceluser"),id=r.body.user.id;
 f.db.prepare("INSERT INTO user_preferences(user_id) VALUES(?)").run(id);
 assert.equal((await f.request("/me",{method:"DELETE",token:r.body.token,body:{confirmation:"please cancel me",password:"wrong"}})).status,403);
 assert.equal((await f.request("/me",{method:"DELETE",token:r.body.token,body:{confirmation:"please cancel me",password:PASSWORD}})).status,200);
 for(const table of ["users","admin_user_attribution","sessions","user_preferences","password_reset_tokens"]){
  const col=table==="users"?"id":"user_id"; assert.equal(f.db.prepare("SELECT COUNT(*) n FROM "+table+" WHERE "+col+"=?").get(id).n,0);
 }
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE user_id=?").get(id).n,0);
 assert.equal(f.db.prepare("SELECT accounts_canceled FROM admin_account_stats WHERE admin_user_id=?").get(OWNER).accounts_canceled,1);
 assert.equal((await f.request("/me",{token:r.body.token})).status,401);
});
test("server pagination, literal search and sorting stay bounded and do not include administrators",async()=>{
 const f=fixture(); for(let n=0;n<31;n++) f.user("viewer"+String(n).padStart(2,"0"));
 const first=await f.request("/admin/users?sort=alphabetical&page_size=25",{token:f.ownerToken});
 const second=await f.request("/admin/users?sort=alphabetical&page_size=25&page=2",{token:f.ownerToken});
 assert.equal(first.status,200); assert.equal(first.body.users.length,25); assert.equal(second.body.users.length,6);
 assert.equal(second.body.pagination.total,31); assert.equal(first.body.users[0].username,"viewer00");
 for(const query of ["search=%25","search=%27%20OR%201%3D1--"]) assert.equal((await f.request("/admin/users?"+query,{token:f.ownerToken})).body.users.length,0);
 assert.equal((await f.request("/admin/users?sort=username;DROP",{token:f.ownerToken})).status,400);
 assert.equal((await f.request("/admin/users?page_size=10000",{token:f.ownerToken})).status,400);
 assert.equal((await f.request("/admin/users?status=expiring7",{token:f.ownerToken})).body.users.length,0);
 for(const route of ["/admin/invites","/admin/dashboard","/admin/activity"]) assert.equal((await f.request(route,{token:f.ownerToken})).status,200);
});
test("permission values reject null, unknown privilege fields and misleading booleans",()=>{
 for(const profile of [{is_owner:1},{enabled:null},{can_create_invites:"false"},{max_accounts_total:-1},{max_sessions:null},[]])
  assert.throws(()=>normalizeAdminProfile(profile));
});
