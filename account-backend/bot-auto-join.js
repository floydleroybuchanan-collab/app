import {q,now,fail,event,member,content,assignToken} from './bot-store.js';
import {telegram,send,isMember} from './bot-telegram.js';
import {get,lock,unlock,eligible,finishAdmission} from './bot-group-invites.js';
import {queueJoinReport} from './bot-join-reports.js';
import {telegramFailure} from './bot-delivery.js';
const activate=s=>({inline_keyboard:[[{text:'Open Mr Charm privately',url:'https://t.me/'+s.bot_username+'?start=help'}]]});
// Durable join-request progress: private delivery must complete before approval.
export async function handleAutomaticJoinRequest(env, u, s) {
  const j = u.chat_join_request, tid = String(j.from.id), gid = String(j.chat.id);
  if (gid !== s.group_id || j.from.is_bot) return;
  if (!Number.isSafeInteger(j.user_chat_id) || !Number.isSafeInteger(j.date)) {
    await event(env, tid, "join_request_invalid", "Missing temporary private chat ID or request date");
    return;
  }
  await q(env, `INSERT OR IGNORE INTO bot_join_requests(group_id,telegram_id,update_id,requested_at,user_chat_id,invite_link)
    VALUES(?1,?2,?3,?4,?5,?6)`, gid, tid, u.update_id, j.date, String(j.user_chat_id), j.invite_link?.invite_link || null).run();
  const lease = crypto.randomUUID();
  const claimed = await q(env, "UPDATE bot_join_requests SET lease_token=?1,lease_until=?2 WHERE group_id=?3 AND telegram_id=?4 AND lease_until<=?5", lease, now() + 180, gid, tid, now()).run();
  if (!claimed.meta.changes) fail("Join request is already processing", 503);
  let invite = null, inviteLease = null, stage = "prepare";
  const read = () => q(env, "SELECT * FROM bot_join_requests WHERE group_id=?1 AND telegram_id=?2", gid, tid).first();
  const save = async (sql, ...values) => {
    const result = await q(env, sql, ...values).run();
    if (!result.meta.changes) fail("Join request lease changed", 503);
  };
  try {
    let progress = await read();
    if (u.update_id !== progress.update_id) {
      if (j.date < progress.requested_at || u.update_id < progress.update_id) return;
      await save(`UPDATE bot_join_requests SET update_id=?1,requested_at=?2,user_chat_id=?3,invite_link=?4,
        group_invite_id=NULL,token_id=NULL,waiting_sent=0,welcome_sent=0,token_sent=0,approved_at=NULL,state='pending',last_error=NULL
        WHERE group_id=?5 AND telegram_id=?6 AND lease_token=?7`, u.update_id, j.date, String(j.user_chat_id), j.invite_link?.invite_link || null, gid, tid, lease);
      progress = await read();
    }
    if (progress.approved_at || progress.state === "denied") return;
    invite = j.invite_link?.invite_link ? await q(env, "SELECT * FROM bot_group_invites WHERE group_id=?1 AND invite_link=?2", gid, j.invite_link.invite_link).first() : null;
    if (invite) {
      inviteLease = await lock(env, invite.id);
      await q(env, "UPDATE bot_group_invites SET lease_until=?1 WHERE id=?2 AND lease_token=?3", now() + 180, invite.id, inviteLease).run();
      invite = await get(env, invite.id);
      await q(env, `INSERT OR IGNORE INTO bot_group_invite_attempts(invite_id,update_id,telegram_id,username,requested_at,outcome)
        VALUES(?1,?2,?3,?4,?5,'received')`, invite.id, u.update_id, tid, j.from.username || "", j.date).run();
      await save("UPDATE bot_join_requests SET group_invite_id=?1 WHERE group_id=?2 AND telegram_id=?3 AND lease_token=?4", invite.id, gid, tid, lease);
    }
    // Recover an approval whose Telegram response or D1 completion was interrupted.
    if (progress.state === "approving" && progress.waiting_sent && progress.welcome_sent && progress.token_sent) {
      const live = await telegram(env, "getChatMember", { chat_id: gid, user_id: j.from.id });
      if (isMember(live)) {
        await completeAutomaticJoin(env, j, u.update_id, lease, invite, live.status);
        return;
      }
    }
    const invalidLink = !invite && j.invite_link?.name?.startsWith("charm:");
    const invalidInvite = invite && ((invite.telegram_id && invite.telegram_id !== tid) ||
      !["active", "pending", "approving"].includes(invite.status) || (invite.status === "approving" && invite.telegram_id !== tid) ||
      (invite.expires_at !== null && invite.expires_at <= now()));
    if (invalidLink || invalidInvite || !await eligible(env, tid)) {
      stage = "deny";
      await telegram(env, "declineChatJoinRequest", { chat_id: gid, user_id: j.from.id });
      await save("UPDATE bot_join_requests SET state='denied',last_error='Blocked user or invalid invitation' WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease);
      if (invite) await q(env, "UPDATE bot_group_invite_attempts SET outcome='denied',processed_at=?1 WHERE invite_id=?2 AND update_id=?3", now(), invite.id, u.update_id).run();
      await event(env, tid, "join_request_denied", "Blocked user or invalid invitation");
      return;
    }
    await member(env, j.from, "pending");
    await q(env, "UPDATE bot_members SET requested_at=?1 WHERE telegram_id=?2", j.date, tid).run();
    if (invite && invite.status !== "approving") {
      await q(env, "UPDATE bot_group_invites SET status='pending',request_at=COALESCE(request_at,?1) WHERE id=?2", j.date, invite.id).run();
      await q(env, "UPDATE bot_group_invite_attempts SET outcome='waiting' WHERE invite_id=?1 AND update_id=?2", invite.id, u.update_id).run();
    }
    const privateEnv = { ...env, BOT_JOIN_DELIVERY: true, BOT_GROUP_REPLY: undefined, BOT_CALLBACK_MESSAGE: null,
      BOT_INTERACTION: { recipient: String(j.user_chat_id), generation: "join:" + u.update_id } };
    const checkWindow = () => { if (now() >= j.date + 300) fail("Temporary private messaging window expired; a fresh join request is needed", 409); };
    if (!progress.waiting_sent) {
      stage = "request_message";
      checkWindow();
      const c = await content(env, "waiting");
      const body = c.enabled && c.body.trim() ? c.body : "Your Charming MediaLab join request has been received. I am preparing your private account instructions before approving your request.";
      await send(privateEnv, j.user_chat_id, body.replaceAll("{name}", j.from.first_name || "there"), activate(s));
      await save("UPDATE bot_join_requests SET waiting_sent=1 WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease);
    }
    stage = "token";
    const m = await q(env, "SELECT * FROM bot_members WHERE telegram_id=?1", tid).first();
    const inv = await assignToken(env, tid, s, { groupId: gid, updateId: u.update_id, lease });
    if (!inv && !m.account_id) fail("Invitation unavailable; administrator review required (no replacement token created)", 409);
    if (inv && (["disabled", "expired"].includes(inv.status) || inv.status === "unused" && inv.expires_at !== null && inv.expires_at <= now())) fail("Existing invitation is disabled or expired; administrator review required", 409);
    await save("UPDATE bot_join_requests SET token_id=?1 WHERE group_id=?2 AND telegram_id=?3 AND lease_token=?4", inv?.id || null, gid, tid, lease);
    if (!progress.welcome_sent) {
      stage = "welcome_message";
      checkWindow();
      const c = await content(env, "welcome");
      const body = c.enabled && c.body.trim() ? c.body : "Welcome to Charming MediaLab, {name}! Keep your invitation private. After creating your account, link it to Mr. Charm through your app Settings and confirm the link with the bot.";
      await send(privateEnv, j.user_chat_id, body.replaceAll("{name}", j.from.first_name || "there"), activate(s));
      await save("UPDATE bot_join_requests SET welcome_sent=1 WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease);
    }
    if (!progress.token_sent) {
      stage = "token_message";
      checkWindow();
      const body = inv ? "Your Charming MediaLab invitation token:\n" + inv.invite_code + "\n\n" +
        (inv.status === "used" ? "This token has already been used. Sign in with your existing app username and password." : "In the app, choose I Have an Invitation and use this token once to register. Approve the registration with Mr. Charm when prompted.") +
        "\nKeep this token private. After registration, link your account in the app Settings and confirm it with Mr. Charm." :
        "Your Telegram identity is already linked to an app account. Sign in with your existing app username and password, or use Forgot Password in the app. No new invitation is needed.";
      await send(privateEnv, j.user_chat_id, body, activate(s));
      await save("UPDATE bot_join_requests SET token_sent=1 WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease);
    }
    stage = "approval";
    if (!await eligible(env, tid)) fail("Access changed during join request; administrator review required", 409);
    await save(`UPDATE bot_join_requests SET state='approving',last_error=NULL WHERE group_id=?1 AND telegram_id=?2
      AND lease_token=?3 AND lease_until>?4 AND waiting_sent=1 AND welcome_sent=1 AND token_sent=1`, gid, tid, lease, now());
    if (invite) {
      const current = await get(env, invite.id);
      if (current.lease_token !== inviteLease || current.lease_until <= now() || !["active", "pending", "approving"].includes(current.status) || current.expires_at !== null && current.expires_at <= now()) fail("Invitation changed before approval", 409);
      await env.DB.batch([
        q(env, "UPDATE bot_group_invites SET status='approving',approval_mode='automatic',telegram_id=?1,used_username=?2,request_at=?3 WHERE id=?4", tid, j.from.username || "", j.date, invite.id),
        q(env, "UPDATE bot_group_invite_attempts SET outcome='approving' WHERE invite_id=?1 AND update_id=?2", invite.id, u.update_id)
      ]);
      invite = await get(env, invite.id);
    }
    // The group ID and permanent user ID are required here, never user_chat_id.
    const approved = await telegram(env, "approveChatJoinRequest", { chat_id: gid, user_id: j.from.id });
    if (approved !== true) fail("Telegram did not confirm approval", 502);
    stage = "record_approval";
    await completeAutomaticJoin(env, j, u.update_id, lease, invite, "member");
  } catch (e) {
    const detail = JSON.stringify({ stage, code: e.telegramCode || e.status || "service_error", update_id: u.update_id });
    console.error("join_request_failed", detail);
    await q(env, "UPDATE bot_join_requests SET last_error=?1 WHERE group_id=?2 AND telegram_id=?3 AND lease_token=?4", detail, gid, tid, lease).run();
    await event(env, tid, "join_request_failed", detail);
    const recorded=await read();
    await queueJoinReport(env,s,j.from,j.date,{
      token:recorded.token_id?'Yes':'Failed or unavailable',
      welcome:recorded.welcome_sent?'Yes':'Not delivered · '+telegramFailure(e),
      setup:recorded.token_sent?'Yes':'Not delivered · '+telegramFailure(e)
    },send,telegram);
    // Permanent failures leave the request pending without blocking all webhook updates.
    if ([400, 403].includes(e.telegramCode) && stage === "approval") {
      const live = await telegram(env, "getChatMember", { chat_id: gid, user_id: j.from.id });
      if (isMember(live)) await completeAutomaticJoin(env, j, u.update_id, lease, invite, live.status);
      return;
    }
    if ([400, 403].includes(e.telegramCode) || !e.telegramCode && e.status === 409) return;
    throw e;
  } finally {
    if (inviteLease) await unlock(env, invite.id, inviteLease);
    await q(env, "UPDATE bot_join_requests SET lease_token=NULL,lease_until=0 WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease).run();
  }
}
async function completeAutomaticJoin(env, j, updateId, lease, invite, status) {
  const gid = String(j.chat.id), tid = String(j.from.id), t = now();
  await env.DB.batch([
    q(env, "UPDATE bot_members SET status=?1,joined_at=COALESCE(joined_at,?2),updated_at=?2 WHERE telegram_id=?3", status === "restricted" ? "restricted_member" : status, t, tid),
    q(env, "UPDATE bot_join_requests SET state='approved',approved_at=COALESCE(approved_at,?1),last_error=NULL WHERE group_id=?2 AND telegram_id=?3 AND update_id=?4 AND lease_token=?5", t, gid, tid, updateId, lease),
    q(env, "INSERT INTO bot_events(telegram_id,action,detail,created_at) VALUES(?1,'join_auto_approved',?2,?3)", tid, JSON.stringify({ update_id: updateId, group_id: gid }), t)
  ]);
  if (invite) {
    try { await finishAdmission(env, { ...invite, telegram_id: tid }); }
    catch { await event(env, tid, "join_invite_cleanup_pending", invite.id); }
  }
}

