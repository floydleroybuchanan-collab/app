import {q,rows,content,now} from './bot-store.js';

export async function recurringStatus(env,s,t=now()) {
 const message=await content(env,'reminder');
 const interval=Math.max(1,Math.min(24,Number(s.reminder_hours)||6))*3600;
 const slot=String(Math.floor(t/interval));
 const claimed=await q(env,'SELECT value FROM bot_runtime WHERE key=?1','reminder_slot:'+s.group_id).first();
 const history=await rows(env,"SELECT action,detail,created_at FROM bot_events WHERE action IN ('reminder_sent','reminder_send_failed','reminder_delete_failed') ORDER BY id DESC LIMIT 20");
 const lastSent=await q(env,"SELECT created_at,detail FROM bot_events WHERE action='reminder_sent' ORDER BY id DESC LIMIT 1").first();
 const lastError=await q(env,"SELECT created_at,detail FROM bot_events WHERE action='reminder_send_failed' ORDER BY id DESC LIMIT 1").first();
 const blocked=!s.enabled?'Bot is disabled':!env.TELEGRAM_BOT_TOKEN?'Bot token is missing':!s.group_id?'Telegram group is not configured':!s.reminder_enabled?'Recurring schedule is disabled':!message.enabled?'Announcement message is disabled':!message.body.trim()?'Announcement message is blank':null;
 return {enabled:!blocked,blocked,interval_hours:interval/3600,last_sent:lastSent||null,last_error:lastError||null,
  next_at:blocked?null:(claimed?.value===slot?(Number(slot)+1)*interval:t),due_now:!blocked&&claimed?.value!==slot,
  cleanup_minutes:10,history,checked_at:t};
}
