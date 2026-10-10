import { readFileSync, writeFileSync } from 'node:fs';

export function patchApi(original, extension) {
  let s = original;
  function replace(from, to, count=1) {
    const found = s.split(from).length - 1;
    if (found !== count) throw new Error(`Anchor mismatch: expected ${count}, found ${found}: ${from.slice(0,100)}`);
    s = s.split(from).join(to);
  }
  replace('var pick =', extension + '\nvar pick =');
  replace('const m = text.match(/^\\s*mr\\.?\\s*charm\\b[\\s,:-]*(.*)$/is);', 'const m = text.match(/^\\s*mr(?:\\.\\s+|\\s+)charm\\b[\\s,:-]*(.*)$/is);');
  replace('/^\\s*mr(?:\\.\\s*|\\s+)charm\\b/i.test(text)', '/^\\s*mr(?:\\.\\s+|\\s+)charm\\b/i.test(text)');
  replace('help|flow_[a-f0-9]{48}|admin_\\w+|manage_\\w+|notify_update|usage|website_release|update_report', 'help|flow_[a-f0-9]{48}');
  replace('key = { "your gay": "you\'re gay", "your stupid": "you\'re stupid", "your an asshole": "you\'re an asshole", "go fuck yoursel": "go fuck yourself" }[key] || key;', 'key = CHARM_BANTER_ALIASES[key] || key;');
  replace('const joke = !cb && banterReply(text);', 'const joke = !cb && !internalStart && cmd === "help" && !exactCommand(text) && banterReply(text);');
  const threat = `    if (!cb && !internalStart && addressed && !exactCommand(text)) {
      const threatKind = credibleCharmThreat(text);
      if (threatKind) {
        await event(env, id, "credible_threat_review", threatKind + ": review original Telegram message " + String(m.message_id));
        return await send(env, id, charmThreatReply(threatKind));
      }
    }
`;
  replace('  try {\n    if (destination)\n      return await handleCommand(env, id, cmd, s);', '  try {\n'+threat+'    if (destination)\n      return await handleCommand(env, id, cmd, s);');
  const userSource = "EXISTS(SELECT 1 FROM bot_invitation_sources bs WHERE bs.account_id=u.id)";
  const inviteSource = "EXISTS(SELECT 1 FROM bot_invitation_sources bs WHERE bs.invite_id=i.id)";
  replace('a.admin_user_id AS created_by_admin_id,a.origin,creator.username AS created_by_admin_name,', `a.admin_user_id AS authorizing_admin_id,CASE WHEN ${userSource} THEN NULL ELSE a.admin_user_id END AS created_by_admin_id,CASE WHEN ${userSource} THEN 'bot_telegram' ELSE a.origin END AS origin,CASE WHEN ${userSource} THEN 'Mr Charm' ELSE creator.username END AS created_by_admin_name,`);
  replace('i.created_by_user_id,creator.username AS created_by_admin_name,redeemer.username', `i.created_by_user_id AS authorizing_admin_id,CASE WHEN ${inviteSource} THEN NULL ELSE i.created_by_user_id END AS created_by_user_id,CASE WHEN ${inviteSource} THEN 'bot_telegram' ELSE 'admin_invite' END AS origin,CASE WHEN ${inviteSource} THEN 'Mr Charm' ELSE creator.username END AS created_by_admin_name,redeemer.username`);
  replace('creatorWhere(url, auth, where, values, "a.admin_user_id");', `creatorWhere(url, auth, where, values, "CASE WHEN ${userSource} THEN 'bot_telegram' ELSE a.admin_user_id END");`);
  replace('creatorWhere(url, auth, where, values, "i.created_by_user_id");', `creatorWhere(url, auth, where, values, "CASE WHEN ${inviteSource} THEN 'bot_telegram' ELSE i.created_by_user_id END");`);
  replace('return json2({ success: true, creators: list });', 'return json2({ success: true, creators: [...list, ...(auth.isOwner || auth.profile.can_manage_all ? [{id:"bot_telegram",username:"Mr Charm"}] : [])] });');
  replace('l.id,l.action,l.created_at,actor.username AS admin_name,target.username AS account_name', "l.id,l.action,l.created_at,CASE WHEN l.action IN ('bot_invitation_source_recorded','bot_account_registered') OR (l.action='invite_created' AND CASE WHEN json_valid(l.details) THEN json_extract(l.details,'$.source') END='bot_telegram') OR (l.action='account_registered' AND EXISTS(SELECT 1 FROM bot_invitation_sources bs WHERE bs.account_id=l.user_id)) THEN 'Mr Charm' ELSE actor.username END AS admin_name,target.username AS account_name");
  replace("a.action,'recorded' source,actor.username admin_name", "a.action,'recorded' source,CASE WHEN a.action IN ('bot_invitation_source_recorded','bot_account_registered') OR (a.action='account_registered' AND EXISTS(SELECT 1 FROM bot_invitation_sources bs WHERE bs.account_id=a.user_id)) THEN 'Mr Charm' ELSE actor.username END admin_name");
  replace('st.accounts_created,st.accounts_expired,st.accounts_canceled,st.accounts_deleted,st.invites_created,st.tracking_started_at,', `MAX(0,st.accounts_created-(SELECT COUNT(*) FROM bot_invitation_sources bs WHERE bs.authorizing_admin_id=u.id AND bs.registered_at IS NOT NULL)) AS accounts_created,
      MAX(0,st.accounts_expired-(SELECT COUNT(*) FROM bot_invitation_sources bs WHERE bs.authorizing_admin_id=u.id AND bs.end_reason='account_expired')) AS accounts_expired,
      MAX(0,st.accounts_canceled-(SELECT COUNT(*) FROM bot_invitation_sources bs WHERE bs.authorizing_admin_id=u.id AND bs.end_reason='user_canceled')) AS accounts_canceled,
      MAX(0,st.accounts_deleted-(SELECT COUNT(*) FROM bot_invitation_sources bs WHERE bs.authorizing_admin_id=u.id AND bs.end_reason='admin_deleted')) AS accounts_deleted,
      MAX(0,st.invites_created-(SELECT COUNT(*) FROM bot_invitation_sources bs WHERE bs.authorizing_admin_id=u.id)) AS invites_created,st.tracking_started_at,`);
  // Only report projections change; permission and quota SQL continues to use the real authorized administrator.
  replace("a.origin='admin_invite' AND v.status=", "a.origin='admin_invite' AND NOT EXISTS(SELECT 1 FROM bot_invitation_sources bs WHERE bs.account_id=v.id) AND v.status=", 2);
  replace("i.created_by_user_id=u.id AND i.status='unused'", "i.created_by_user_id=u.id AND NOT EXISTS(SELECT 1 FROM bot_invitation_sources bs WHERE bs.invite_id=i.id) AND i.status='unused'", 1);
  const helper = `async function invitationCreatorLine(env, inv) {
  if (!inv) return "";
  const source = await q(env,"SELECT creator_label FROM bot_invitation_sources WHERE invite_id=?1",inv.id).first();
  const admin = source ? null : await q(env,"SELECT username FROM users WHERE id=?1",inv.created_by_user_id).first();
  const label = source?.creator_label || admin?.username;
  return label ? "\\nCreated by " + String(label).replace(/[\\r\\n]/g," ") : "";
}
`;
  replace('async function assignToken(', helper+'\nasync function assignToken(');
  // This marker comes only from the verified internal Telegram-admin call, never request headers/body.
  replace('}), env, { ...accountAdminHelpers(), requireUser:', '}), { ...env, BOT_INVITATION_ISSUER: { telegram_id: id } }, { ...accountAdminHelpers(), requireUser:');
  replace('const inserted = await stmt(env, `INSERT INTO invites(id,invite_code,account_duration_days,max_sessions,expires_at,created_by_user_id,created_at,status)\n      SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE ${admission}`, values).run();', `const inviteStatement = stmt(env, \`INSERT INTO invites(id,invite_code,account_duration_days,max_sessions,expires_at,created_by_user_id,created_at,status)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE \${admission}\`, values);
    const inserted = env.BOT_INVITATION_ISSUER ? (await env.DB.batch([
      inviteStatement,
      q(env,"INSERT INTO bot_invitation_sources(invite_id,authorizing_admin_id,issued_at,evidence) SELECT id,created_by_user_id,created_at,'live_token_created' FROM invites WHERE id=?1",id)
    ]))[0] : await inviteStatement.run();`);
  replace('await audit2(env, null, auth.user.id, "invite_created", null);', 'await audit2(env, null, auth.user.id, "invite_created", env.BOT_INVITATION_ISSUER ? JSON.stringify({source:"bot_telegram",creator_label:"Mr Charm",invite_id:id,authorizing_admin_id:auth.user.id}) : null);');
  replace('created_by_admin_name: auth.user.username } }, 201);', 'created_by_admin_name: env.BOT_INVITATION_ISSUER ? "Mr Charm" : auth.user.username, origin: env.BOT_INVITATION_ISSUER ? "bot_telegram" : "admin_invite", authorizing_admin_id: auth.user.id } }, 201);');
  replace('result.invite.invite_code + "\\nShare it privately', 'result.invite.invite_code + "\\nCreated by " + result.invite.created_by_admin_name + "\\nShare it privately');
  replace('inv.invite_code + "\\n\\n"', 'inv.invite_code + await invitationCreatorLine(env, inv) + "\\n\\n"',2);
  replace('invitation2.invite_code + "\\n\\nIn the app', 'invitation2.invite_code + await invitationCreatorLine(env, invitation2) + "\\n\\nIn the app');
  replace('invitation.invite_code + "\\n\\nAccount setup', 'invitation.invite_code + await invitationCreatorLine(env, invitation) + "\\n\\nAccount setup');
  return s;
}

export function patchPanel(s) {
  const from = 'u.origin==="referral"?"Via family / friend":u.origin==="admin_invite"?"Direct admin invite":"No surviving attribution"';
  if(s.split(from).length!==2) throw new Error('Panel source anchor mismatch');
  return s.replace(from,'u.origin==="bot_telegram"?"Telegram bot onboarding":'+from);
}

if (process.argv[2]) {
  const [input,output] = process.argv.slice(2);
  writeFileSync(output,patchApi(readFileSync(input,'utf8'),readFileSync(new URL('./banter-extension.js',import.meta.url),'utf8')));
}
