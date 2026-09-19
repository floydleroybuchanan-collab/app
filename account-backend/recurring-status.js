import {q,rows,content,now} from './bot-store.js';
import {nextRecurring,recurringInterval} from './bot-recurring.js';

export async function recurringStatus(env,s,t=now()) {
 const message=await content(env,'reminder');
 const interval=recurringInterval(s),next=await nextRecurring(env,s,t);
 const history=await rows(env,"SELECT action,detail,created_at FROM bot_events WHERE action IN ('reminder_sent','reminder_send_failed','reminder_delete_failed') ORDER BY id DESC LIMIT 20");
 const lastSent=await q(env,"SELECT created_at,detail FROM bot_events WHERE action='reminder_sent' ORDER BY id DESC LIMIT 1").first();
 const lastError=await q(env,"SELECT created_at,detail FROM bot_events WHERE action='reminder_send_failed' ORDER BY id DESC LIMIT 1").first();
 const blocked=!s.enabled?'Bot is disabled':!env.TELEGRAM_BOT_TOKEN?'Bot token is missing':!s.group_id?'Telegram group is not configured':!s.reminder_enabled?'Recurring schedule is disabled':!message.enabled?'Announcement message is disabled':!message.body.trim()?'Announcement message is blank':null;
 return {enabled:!blocked,blocked,interval_hours:interval/3600,last_sent:lastSent||null,last_error:lastError||null,
  next_at:blocked?null:next,due_now:!blocked&&next<=t,
  cleanup_minutes:null,retention:'until_next_recurring',history,checked_at:t};
}
