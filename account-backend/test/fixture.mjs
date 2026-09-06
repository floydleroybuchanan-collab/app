import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash, pbkdf2Sync } from "node:crypto";
import worker from "../worker.js";

export const OWNER = "7e2775af-7a81-4669-a800-9a9c6b7ad2a1";
export const PASSWORD = "Local-testing-only-Password!";
export const NOW = () => Math.floor(Date.now() / 1000);
export const DAY = 86400;
const salt = Buffer.alloc(16, 7);
const passwordHash = ["pbkdf2-sha256", 60000, salt.toString("base64"), pbkdf2Sync(PASSWORD, salt, 60000, 32, "sha256").toString("base64")].join("$");

export function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,",
    "role TEXT NOT NULL DEFAULT 'user' CHECK(role IN('user','admin')),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','disabled','expired')),",
    "max_sessions INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL DEFAULT(unixepoch()),activated_at INTEGER,expires_at INTEGER,last_login_at INTEGER);",
    "CREATE TABLE invites(id TEXT PRIMARY KEY,invite_code TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'unused' CHECK(status IN('unused','used','disabled','expired')),",
    "account_duration_days INTEGER,max_sessions INTEGER NOT NULL DEFAULT 1,created_by_user_id TEXT REFERENCES users(id),created_at INTEGER NOT NULL DEFAULT(unixepoch()),",
    "expires_at INTEGER,redeemed_by_user_id TEXT REFERENCES users(id),redeemed_at INTEGER);",
    "CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,",
    "created_at INTEGER NOT NULL DEFAULT(unixepoch()),last_activity_at INTEGER NOT NULL DEFAULT(unixepoch()),expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);",
    "CREATE TABLE password_reset_tokens(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT UNIQUE,created_at INTEGER,expires_at INTEGER,used INTEGER);",
    "CREATE TABLE user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,preferences_json TEXT DEFAULT '{}',updated_at INTEGER);",
    "CREATE TABLE audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,admin_user_id TEXT,action TEXT NOT NULL,details TEXT,created_at INTEGER);",
  ].join("\n"));
  function user(id, extra = {}) {
    const u = { id, username: id === OWNER ? "owner" : id, email: id+"@example.test", role: "user", status: "active", expires_at: NOW()+90*DAY, max_sessions: 2, created_at: NOW(), ...extra };
    db.prepare("INSERT INTO users(id,username,email,password_hash,role,status,expires_at,max_sessions,created_at,activated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(u.id,u.username,u.email,passwordHash,u.role,u.status,u.expires_at,u.max_sessions,u.created_at,u.created_at);
    return u;
  }
  user(OWNER, { role: "admin", expires_at: null });
  for (const name of ["0002_user_referrals.sql", "0003_owner_admin_controls.sql", "0004_shared_admin_login.sql"])
    db.exec(readFileSync(new URL("../migrations/"+name, import.meta.url),"utf8"));
  function prepare(sql, values=[]) {
    function execute(kind) {
      const st = db.prepare(sql);
      const args = /\?[1-9]/.test(sql) ? [Object.fromEntries(values.map((v,i)=>[String(i+1),v]))] : values;
      return st[kind](...args);
    }
    return {
      bind: (...v) => prepare(sql,v),
      _run() { const r=execute("run"); return { meta:{changes:Number(r.changes)} }; },
      async run() { return this._run(); },
      async all() { return {results:execute("all")}; },
      async first() { return execute("get") || null; },
    };
  }
  const env = { DB: { prepare, async batch(statements) {
    db.exec("BEGIN IMMEDIATE");
    try { const r=statements.map(s=>s._run()); db.exec("COMMIT"); return r; }
    catch(e) { db.exec("ROLLBACK"); throw e; }
  } }, M3U_URL:"http://provider.example.test/one",EPG_URL:"http://provider.example.test/guide",
  M3U_URL_2:"https://provider.example.test/two",EPG_URL_2:"http://provider.example.test/guide2" };
  function token(id) {
    const token=crypto.randomUUID();
    db.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)")
      .run(crypto.randomUUID(),id,createHash("sha256").update(token).digest("hex"),NOW()+DAY);
    return token;
  }
  async function request(path, {method="GET",token:bearer,body}={}) {
    const response=await worker.fetch(new Request("https://test.example"+path,{
      method,headers:{"Content-Type":"application/json",...(bearer?{Authorization:"Bearer "+bearer}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),
    }),env);
    return {status:response.status,body:await response.json()};
  }
  const ownerToken=token(OWNER);
  async function staff(name="staff", permissions={}) {
    const result=await request("/admin/admins",{method:"POST",token:ownerToken,body:{
      username:name,email:name+"@example.test",password:PASSWORD,owner_password:PASSWORD,
      permissions:{can_create_invites:1,max_accounts_total:3,max_open_accounts:3,max_pending_invites:2,...permissions},
    }});
    if(result.status!==201) throw new Error(JSON.stringify(result));
    return {id:result.body.admin.id,token:token(result.body.admin.id)};
  }
  async function invite(bearer=ownerToken,terms={}) {
    return request("/admin/invites",{method:"POST",token:bearer,body:{account_duration_days:30,max_sessions:2,invite_expires_days:3,...terms}});
  }
  async function redeem(code,name=crypto.randomUUID().slice(0,16)) {
    return request("/auth/register",{method:"POST",body:{invite_code:code,username:name,email:name+"@example.test",password:PASSWORD}});
  }
  return {db,env,user,token,request,ownerToken,staff,invite,redeem};
}
