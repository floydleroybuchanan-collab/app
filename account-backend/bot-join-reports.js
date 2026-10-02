import {q,rows,now,event} from './bot-store.js';
import {telegramFailure} from './bot-delivery.js';

const failure=telegramFailure;
export async function queueJoinReport(env,s,user,joinedAt,outcome,send,telegram){
 const name=[user.first_name,user.last_name].filter(Boolean).join(' ')||'Unknown name';
 const joined=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'full',timeStyle:'long'}).format(new Date(joinedAt*1000));
 const report='New member delivery report\n\nMember: '+name+(user.username?' (@'+user.username+')':'')+'\nTelegram ID: '+user.id+'\nJoined: '+joined+'\nToken assigned: '+outcome.token+'\nWelcome delivered: '+outcome.welcome+'\nAccount setup and registration directions delivered: '+outcome.setup+'\nAccount-linking directions included: '+outcome.setup+'\n\nToken values and passwords are omitted.';
 const payload={userId:String(user.id),joinKey:String(user.id)+':'+joinedAt,report,created:now(),attempts:0};
 const r=await q(env,"INSERT INTO bot_jobs(kind,chat_id,body,due_at) SELECT 'join_report_discovery',?1,?2,?3 WHERE NOT EXISTS(SELECT 1 FROM bot_jobs WHERE kind='join_report_discovery' AND chat_id=?1 AND json_extract(body,'$.joinKey')=?4)",s.group_id,JSON.stringify(payload),now(),payload.joinKey).run();
 if(!r.meta.changes)return;
 await deliverJoinReport(env,{id:r.meta.last_row_id,kind:'join_report_discovery',chat_id:s.group_id,body:JSON.stringify(payload)},send,telegram);
}

export async function deliverJoinReport(env,job,send,telegram){
 const claim=await q(env,"UPDATE bot_jobs SET status='sending',due_at=?1 WHERE id=?2 AND status='pending'",now(),job.id).run();
 if(!claim.meta.changes)return;
 const data=JSON.parse(job.body);
 try{
  if(job.kind==='join_report_discovery'){
   const admins=await telegram(env,'getChatAdministrators',{chat_id:job.chat_id});
   if(!Array.isArray(admins))throw new Error('Invalid administrator list');
   const humans=admins.filter(a=>a.user?.id&&!a.user.is_bot);
   if(!humans.length)throw new Error('No human administrators returned');
   const children=humans.map(a=>q(env,"INSERT INTO bot_jobs(kind,chat_id,body,due_at) VALUES('join_report',?1,?2,?3)",job.chat_id,JSON.stringify({...data,recipient:String(a.user.id)}),now()));
   children.push(q(env,"UPDATE bot_jobs SET status='sent',error='' WHERE id=?1",job.id));
   await env.DB.batch(children);
   for(const child of await rows(env,"SELECT * FROM bot_jobs WHERE kind='join_report' AND status='pending' AND due_at<=?1 ORDER BY id LIMIT 20",now()))await deliverJoinReport(env,child,send,telegram);
   return;
  }
  const live=await telegram(env,'getChatMember',{chat_id:job.chat_id,user_id:Number(data.recipient)});
  if(!['administrator','creator'].includes(live.status)||live.user?.is_bot){
   await q(env,"UPDATE bot_jobs SET status='canceled',error='Recipient is no longer a human administrator.' WHERE id=?1",job.id).run();return;
  }
  const privateEnv={...env,BOT_PUBLIC_HUMOR:false,BOT_INTERACTION:{recipient:data.recipient,generation:crypto.randomUUID()},BOT_GROUP_REPLY:{chat_id:job.chat_id,user_id:data.recipient}};
  await send(privateEnv,data.recipient,data.report);
  await q(env,"UPDATE bot_jobs SET status='sent',error='' WHERE id=?1",job.id).run();
  await event(env,data.userId,'new_member_delivery_report','Delivered to admin '+data.recipient);
 }catch(e){
  data.attempts++;
  const exhausted=data.attempts>=10||now()-data.created>=86400;
  const delay=Math.max(60,Math.min(3600,Number(e.retryAfter)||60*2**Math.min(data.attempts,6)));
  await q(env,"UPDATE bot_jobs SET status=?1,body=?2,due_at=?3,error=?4 WHERE id=?5",exhausted?'failed':'pending',JSON.stringify(data),now()+delay,failure(e),job.id).run();
  await event(env,data.userId,'new_member_admin_report_failed',(data.recipient?'Admin '+data.recipient+': ':'Administrator lookup: ')+failure(e)+(exhausted?'; retries exhausted':'; retry queued'));
 }
}
