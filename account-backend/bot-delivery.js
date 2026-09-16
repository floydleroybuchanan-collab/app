import {now,q,rows,event} from './bot-store.js';

export const RESPONSE_LIFETIME_SECONDS = 600;
const SEND_METHODS = new Set(['sendMessage','editMessageText','sendRichMessage','sendPhoto','sendDocument','sendVideo','sendAudio','sendAnimation','sendVoice']);

export async function telegramTransport(env,method,body) {
 if(!env.TELEGRAM_BOT_TOKEN)throw Object.assign(new Error('Save TELEGRAM_BOT_TOKEN in Cloudflare first.'),{status:503});
 const response=await (env.TELEGRAM_FETCH||fetch)('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
 });
 const data=await response.json();
 if(!response.ok||!data.ok)throw Object.assign(new Error('Telegram could not complete '+method+' ('+(data.error_code||response.status)+').'),{
  status:502,telegramCode:data.error_code,telegramMethod:method,description:data.description||'',retryAfter:data.parameters?.retry_after
 });
 return data.result;
}

async function removeResponse(env,row) {
 const claimed=await q(env,'UPDATE bot_responses SET lease_until=?1 WHERE response_key=?2 AND generation=?3 AND lease_until<=?4',now()+30,row.response_key,row.generation,now()).run();
 if(!claimed.meta.changes)return;
 try {
  await telegramTransport(env,row.ephemeral?'deleteEphemeralMessage':'deleteMessage',{
   chat_id:row.chat_id,...(row.ephemeral?{receiver_user_id:Number(row.recipient_id),ephemeral_message_id:row.message_id}:{message_id:row.message_id})
  });
  await q(env,'DELETE FROM bot_responses WHERE response_key=?1 AND generation=?2',row.response_key,row.generation).run();
 }catch(e){
  // Deletion is idempotent. An already-expired message needs no further retry.
  if(e.telegramCode===400&&/not found|already deleted|message_id_invalid|message identifier is not specified/i.test(e.description)){
   await q(env,'DELETE FROM bot_responses WHERE response_key=?1 AND generation=?2',row.response_key,row.generation).run();return;
  }
  const delay=Math.max(30,Math.min(3600,Number(e.retryAfter)||30*2**Math.min(row.attempts,6)));
  await q(env,'UPDATE bot_responses SET attempts=attempts+1,due_at=?1,lease_until=0 WHERE response_key=?2 AND generation=?3',now()+delay,row.response_key,row.generation).run();
  await event(env,row.recipient_id,'response_cleanup_retry',e.telegramCode?String(e.telegramCode):'network');
 }
}

export async function rememberResponse(env,method,body,result) {
 if(!SEND_METHODS.has(method))return;
 const ephemeral=Number.isSafeInteger(result?.ephemeral_message_id);
 const messageId=ephemeral?result.ephemeral_message_id:result?.message_id;
 if(!Number.isSafeInteger(messageId)||messageId<=0)return;
 const recipient=String(body.ephemeral_message_parameters?.receiver_user_id||body.chat_id);
 const interaction=env.BOT_INTERACTION;
 const generation=interaction?.recipient===recipient?interaction.generation:crypto.randomUUID();
 const chatId=String(body.chat_id),key=[chatId,recipient,ephemeral?'e':'m',messageId].join(':');
 // Reused ephemeral identifiers replace their old cleanup record, so an old
 // deadline cannot accidentally delete a newer response with the same ID.
 await q(env,`INSERT INTO bot_responses(response_key,recipient_id,generation,chat_id,message_id,ephemeral,created_at,due_at)
  VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(response_key) DO UPDATE SET generation=excluded.generation,
  created_at=excluded.created_at,due_at=excluded.due_at,attempts=0,lease_until=0`,key,recipient,generation,chatId,messageId,ephemeral?1:0,now(),now()+RESPONSE_LIFETIME_SECONDS).run();
 // Keep multipart content from this action together; replace the preceding
 // action only after its successor was delivered successfully.
 for(const previous of await rows(env,'SELECT * FROM bot_responses WHERE recipient_id=?1 AND generation<>?2 ORDER BY created_at LIMIT 40',recipient,generation))await removeResponse(env,previous);
}

export async function cleanExpiredResponses(env) {
 for(const row of await rows(env,'SELECT * FROM bot_responses WHERE due_at<=?1 AND lease_until<=?1 ORDER BY due_at LIMIT 80',now()))await removeResponse(env,row);
 // Telegram cannot delete ordinary messages older than 48 hours. Retain an
 // audit event for failures, but do not retry an impossible operation forever.
 const expired=await rows(env,'SELECT DISTINCT recipient_id FROM bot_responses WHERE created_at<?1',now()-47*3600);
 for(const row of expired)await event(env,row.recipient_id,'response_cleanup_expired','Telegram deletion window exceeded');
 await q(env,'DELETE FROM bot_responses WHERE created_at<?1',now()-47*3600).run();
}
