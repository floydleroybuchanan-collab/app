// Local-only panel fixture. Never deploy this file or test accounts.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fixture, DAY, NOW, OWNER } from "./fixture.mjs";
import worker from "../worker.js";
const port=Number(process.env.PREVIEW_PORT||8877);
const f=fixture();
for(let i=0;i<5;i++)f.db.prepare('INSERT INTO bot_support_admins(telegram_id,name,username,enabled) VALUES(?,?,?,1)').run(String(10001+i),'Test support '+(i+1),i<2?'TestPublic'+i:'');
const staff=await f.staff("testadmin",{can_change_time:1,max_accounts_total:20,max_open_accounts:10,max_pending_invites:5});
for(let n=1;n<=32;n++)f.user("viewer"+String(n).padStart(2,"0"),{expires_at:n===1?null:NOW()+n*DAY});
const invitation=await f.invite(staff.token);
await f.redeem(invitation.body.invite.invite_code,"staffviewer");
const assets={"/app-settings.js":["app-settings.client.js","text/javascript"],"/bot.js":["bot.client.js","text/javascript"],"/":["index.html","text/html"],"/styles.css":["styles.css","text/css"],"/panel.js":["panel.client.js","text/javascript"]};
createServer(async(req,res)=>{
  try{
    if(assets[req.url]){
      const [name,type]=assets[req.url];
      const text=readFileSync(new URL("../../admin-panel/"+name,import.meta.url),"utf8").replace('content="https://charmiptv-account-api.agentleakage.workers.dev"','content="http://127.0.0.1:'+port+'"');
      res.writeHead(200,{"Content-Type":type+"; charset=utf-8","Cache-Control":"no-store"});res.end(text);return;
    }
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const request=new Request("http://127.0.0.1:"+port+req.url,{method:req.method,headers:req.headers,...(["GET","HEAD"].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const response=await worker.fetch(request,f.env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch(e){res.writeHead(500);res.end("Local preview failed");console.error(e);}
}).listen(port,"127.0.0.1",()=>console.log("Local test panel: http://127.0.0.1:"+port+" · owner/testadmin login uses fixture PASSWORD only."));
