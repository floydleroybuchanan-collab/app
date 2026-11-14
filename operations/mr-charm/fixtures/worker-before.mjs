var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var PREFIX = "[[CHARM_RICH_V1]]";
var escape = /* @__PURE__ */ __name2((s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"), "escape");
var decode = /* @__PURE__ */ __name2((s) => s.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (m, k) => {
  const map = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  if (map[k])
    return map[k];
  const n = k.startsWith("#x") ? parseInt(k.slice(2), 16) : Number(k.slice(1));
  return n > 0 && n <= 1114111 ? String.fromCodePoint(n) : "";
}), "decode");
var tags = /* @__PURE__ */ new Set(["p", "br", "b", "i", "u", "s", "mark", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a"]);
var isRich = /* @__PURE__ */ __name2((s) => typeof s === "string" && s.startsWith(PREFIX), "isRich");
function readRich(value) {
  if (typeof value !== "string")
    throw Object.assign(Error("Message must be text."), { status: 400 });
  if (!isRich(value))
    return { html: escape(value).replaceAll("\n", "<br>"), text: value };
  if (value.length > 2e5)
    throw Object.assign(Error("Formatted message is too large."), { status: 400 });
  const source = value.slice(PREFIX.length), stack = [], lists = [];
  let html = "", text = "", count = 0;
  const bad = /* @__PURE__ */ __name2(() => {
    throw Object.assign(Error("Unsupported message formatting. Clear formatting and try again."), { status: 400 });
  }, "bad");
  for (const token of source.match(/<[^>]*>|[^<]+|</g) || []) {
    if (!token.startsWith("<")) {
      const t = decode(token);
      html += escape(t);
      text += t;
      continue;
    }
    const m = token.match(/^<(\/)?([a-z0-9]+)(?: href="([^"]*)")?\s*(\/?)>$/);
    if (!m || !tags.has(m[2]) || ++count > 2e3)
      bad();
    const [, closing, tag, href] = m;
    if (closing) {
      if (href || stack.pop() !== tag)
        bad();
      html += "</" + tag + ">";
      if (["p", "h1", "h2", "h3", "blockquote", "li"].includes(tag))
        text += "\n";
      if (tag === "ol" || tag === "ul")
        lists.pop();
      continue;
    }
    if (tag === "a") {
      let u;
      try {
        u = new URL(decode(href || ""));
      } catch {
        bad();
      }
      if (!["https:", "http:", "mailto:"].includes(u.protocol) || u.username || u.password)
        bad();
      html += '<a href="' + escape(u.href) + '">';
    } else {
      if (href)
        bad();
      html += "<" + tag + ">";
    }
    if (tag === "br")
      text += "\n";
    else {
      stack.push(tag);
      if (stack.length > 16)
        bad();
    }
    if (["p", "h1", "h2", "h3", "blockquote"].includes(tag) && text && !text.endsWith("\n"))
      text += "\n";
    if (tag === "ul" || tag === "ol")
      lists.push({ tag, n: 0 });
    if (tag === "li") {
      const l = lists.at(-1);
      text += "\n" + (l?.tag === "ol" ? ++l.n + ". " : "\u2022 ");
    }
  }
  if (stack.length)
    bad();
  return { html, text: text.replace(/\n{3,}/g, "\n\n").trim() };
}
__name(readRich, "readRich");
__name2(readRich, "readRich");
var richPlain = /* @__PURE__ */ __name2((s) => readRich(s).text, "richPlain");
var richLength = /* @__PURE__ */ __name2((s) => richPlain(s).length, "richLength");
var richAppend = /* @__PURE__ */ __name2((s, suffix) => isRich(s) ? PREFIX + readRich(s).html + "<p>" + escape(suffix) + "</p>" : s + suffix, "richAppend");
var EXPIRED_RETENTION_SECONDS = 30 * 86400;
function expiredViewer(user, at = Math.floor(Date.now() / 1e3)) {
  return user.role === "user" && (user.status === "expired" || user.expires_at !== null && Number(user.expires_at) <= at);
}
__name(expiredViewer, "expiredViewer");
__name2(expiredViewer, "expiredViewer");
function deletionDue(user, at = Math.floor(Date.now() / 1e3)) {
  return expiredViewer(user, at) && user.expires_at !== null && Number(user.expires_at) + EXPIRED_RETENTION_SECONDS <= at;
}
__name(deletionDue, "deletionDue");
__name2(deletionDue, "deletionDue");
async function retainExpiredViewer(env, id, at = Math.floor(Date.now() / 1e3)) {
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET status='expired',expires_at=CASE WHEN expires_at IS NULL OR expires_at>?2 THEN ?2 ELSE expires_at END WHERE id=?1 AND role='user' AND (status='expired' OR expires_at<=?2)").bind(id, at),
    env.DB.prepare("UPDATE sessions SET revoked=1 WHERE user_id=?1 AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND role='user' AND status='expired' AND expires_at<=?2)").bind(id, at)
  ]);
}
__name(retainExpiredViewer, "retainExpiredViewer");
__name2(retainExpiredViewer, "retainExpiredViewer");
var ADMIN_DESCRIPTIONS = { "search_user": "Find accounts by app username, Telegram name or Telegram ID.", "userinfo": "Review a user\u2019s account details and verified Telegram link.", "user_status": "Check whether a user can sign in and when their account expires.", "link_account": "Attach a Telegram identity to an app account after confirmation.", "relink_account": "Replace an account\u2019s Telegram link after confirming the new identity.", "unlink_account": "Remove an account\u2019s Telegram recovery link after confirmation.", "reset_user_password": "Start verified recovery; the user enters the new password in the app.", "signout_user": "Sign the selected user out of every active app session after confirmation.", "disable_account": "Stop a user from accessing the app until the account is enabled again.", "enable_account": "Re-enable a disabled app account after confirmation.", "ban_user": "Block app access and ban the linked identity from the Telegram room.", "unban_user": "Remove the app and Telegram ban after confirmation.", "delete_account": "Permanently delete the selected app account after confirmation.", "extend_user": "Add a chosen number of days to an account\u2019s access period.", "set_expiration": "Choose the exact date when an account\u2019s access ends.", "set_limit": "Set how many simultaneous app logins the account allows.", "user_sessions": "See the selected user\u2019s active logins and login allowance.", "revoke_sessions": "Invalidate all active sessions for the selected account.", "invite_info": "Check an app invitation\u2019s status, expiration and assigned access.", "cancel_invite": "Cancel an unused app registration invitation after confirmation.", "create_app_invite": "Create an app registration invitation with access days and a login limit.", "recent_users": "List recently created accounts within your permitted account scope.", "recent_links": "Review accounts recently connected to Telegram identities.", "user_audit": "Review recorded administrative changes for the selected account.", "bot_status": "Check the bot\u2019s saved configuration and enabled services.", "bot_stats": "View account totals within your permitted account scope." };
var ACCOUNT_COMMANDS = [
  ["my_account", "my account", "My Account", "See your app username, account details and verified Telegram link."],
  ["account_status", "account status", "Account status", "Check whether your account is active and when access expires."],
  ["my_sessions", "sessions", "My Sessions", "See your active app logins and how many simultaneous logins are allowed."],
  ["sign_out_all", "sign out all", "Sign Out All", "Sign out all your app sessions after confirming; sign in again on your devices."],
  ["my_security", "security", "My Security", "Review your Telegram recovery link and recent password-reset status."],
  ["unlink_my_account", "unlink my account", "Unlink My Account", "Remove your Telegram recovery link after confirmation; this affects password recovery."],
  ["invite_status", "invite status", "Invitation Status", "Check whether your app invitation is available, used or expired."]
].map(([command, phrase, label, description]) => ({ id: command, command, phrase, label, description }));
var ADMIN_ACCOUNT_COMMANDS = [
  ["search_user", "search user", "<username, Telegram name or ID>", "Search Users"],
  ["userinfo", "userinfo", "<identifier, or reply to a member>", "User Information"],
  ["user_status", "account status", "<username>", "User Account Status"],
  ["link_account", "link account", "<username> <Telegram ID>", "Link Account"],
  ["relink_account", "relink account", "<username> <Telegram ID>", "Relink Account"],
  ["unlink_account", "unlink account", "<username>", "Unlink Account"],
  ["reset_user_password", "reset password", "<username>", "Verified Password Recovery"],
  ["signout_user", "signout user", "<username>", "Sign Out User"],
  ["disable_account", "disable account", "<username>", "Disable Account"],
  ["enable_account", "enable account", "<username>", "Enable Account"],
  ["ban_user", "ban user", "<username>", "Ban App & Telegram Access"],
  ["unban_user", "unban user", "<username>", "Unban App & Telegram Access"],
  ["delete_account", "delete account", "<username>", "Delete Account"],
  ["extend_user", "extend", "<username> <days>", "Extend Account"],
  ["set_expiration", "set expiration", "<username> <YYYY-MM-DD>", "Set Expiration"],
  ["set_limit", "set limit", "<username> <count>", "Set Login Limit"],
  ["user_sessions", "sessions", "<username>", "User Sessions"],
  ["revoke_sessions", "revoke sessions", "<username>", "Revoke Sessions"],
  ["invite_info", "invite info", "<code>", "Invitation Information"],
  ["cancel_invite", "cancel invite", "<code>", "Cancel App Invitation"],
  ["create_app_invite", "create invite", "<days> <login limit>", "Create App Invitation"],
  ["recent_users", "recent users", "", "Recent Users"],
  ["recent_links", "recent links", "", "Recent Telegram Links"],
  ["user_audit", "audit", "<username>", "Account Audit"],
  ["bot_status", "bot status", "", "Bot Status"],
  ["bot_stats", "stats", "", "Account Statistics"]
].map(([command, phrase, usage, label]) => ({ id: "manage_" + command, command, phrase, usage, label, description: ADMIN_DESCRIPTIONS[command], admin: true }));
var COMMANDS = [
  { id: "admin_kick", command: "kick", phrase: "Kick", label: "\u{1F462} Kick member", description: "Remove a group member by replying to their message or supplying their Telegram username or ID", admin: true },
  { id: "admin_mute", command: "mute", phrase: "Mute", label: "\u{1F507} Timed mute", description: "Stop a group member from posting for a specified number of minutes", admin: true },
  { id: "linking:user", command: "account_linking", phrase: "Account Linking", label: "\u{1F517} Account Linking Steps", description: "Step-by-step instructions for linking your own app account to Telegram" },
  { id: "linking:admin", command: "admin_account_linking", phrase: "Admin Account Linking", label: "\u{1F6E1} Admin Account Linking Steps", description: "Private administrator instructions for app and web-panel account linking", admin: true },
  { id: "update_report", command: "update_report", phrase: "Update Report", label: "\u{1F4C4} Update & Link Report", description: "Download a private text file of accounts, reported app versions and Telegram links", admin: true },
  { id: "usage", command: "usage", phrase: "Usage", label: "\u{1F4CA} App Usage", description: "See online viewers, Telegram links and watch-time rankings privately", admin: true },
  { id: "website_release", command: "website_release", phrase: "Website Release", label: "\u{1F310} Website Release", description: "View the published app release and open the release editor", admin: true },
  { id: "website", command: "website", label: "\u{1F310} Website", description: "Open the official website for downloads, installation and account help" },
  ...ACCOUNT_COMMANDS,
  ...ADMIN_ACCOUNT_COMMANDS,
  { id: "user_commands", command: "user_commands", label: "\u{1F464} User Commands", description: "Choose a category to find your account and app commands" },
  { id: "help", command: "help", label: "\u{1F49C} User Commands", description: "Open your private help menu" },
  { id: "guide", command: "guide", label: "\u{1F4D6} User Guide", description: "Read the app guide" },
  { id: "downloads", command: "downloads", label: "\u{1F4E5} Download / update app", description: "Get the latest app and installation help" },
  { id: "account", command: "account", label: "\u{1F511} My Account", description: "Account status and login help" },
  { id: "request_access", command: "request_access", label: "Request App Access", description: "Pair an app access request or apply to join" },
  { id: "confirm_registration", command: "confirm_registration", label: "Confirm Registration", description: "Confirm your app registration request" },
  { id: "forgot_password", command: "forgot_password", label: "Forgot Password", description: "Approve an app password reset" },
  { id: "link_telegram", command: "link_telegram", label: "Link Telegram / recovery", description: "Verify your existing app account link" },
  { id: "token", command: "token", label: "\u{1F39F} My app invitation", description: "View your own registration invitation" },
  { id: "troubleshooting", command: "troubleshooting", label: "\u{1F6E0} Troubleshooting", description: "Get private troubleshooting help" },
  { id: "rules", command: "rules", label: "\u{1F4DC} Rules & information", description: "Read community rules" },
  { id: "contact", command: "contact", label: "\u{1F464} Contact an Admin", description: "Get support privately" },
  { id: "about", command: "about", label: "\u2753 About Mr. Charm", description: "Learn about the assistant" },
  { id: "app_help", command: "sources", label: "\u25B6 Sources & MultiView help", description: "Sources, playback and MultiView help", content: true },
  { id: "whats_new", command: "whats_new", label: "\u2728 What\u2019s new", description: "Read release notes", content: true },
  { id: "status", command: "status", label: "Service status", description: "View service status", content: true },
  { id: "admin", command: "admin", label: "\u{1F6E1} Admin Commands", description: "Open authorized admin tools", admin: true },
  { id: "notify_update", command: "notify_update", label: "\u{1F4E3} Notify Update", description: "Privately compose an app update announcement", admin: true },
  { id: "admin_invite", command: "invite", label: "Create personal room invitation", description: "Create a personal join-request invitation", admin: true },
  { id: "admin_invites", command: "invites", label: "Recent room invitations", description: "Review recent room invitations", admin: true },
  { id: "admin_revoke", command: "revoke", label: "Revoke room invitation", description: "Revoke an unused room invitation", admin: true }
];
var PHRASES = { my_sessions: "My Sessions", my_security: "My Security", manage_userinfo: "User Information", manage_user_status: "User Account Status", manage_user_sessions: "User Sessions", manage_signout_user: "Sign Out User", manage_extend_user: "Extend Account", manage_set_limit: "Set Login Limit", manage_bot_stats: "Account Statistics", manage_user_audit: "Account Audit", confirm_registration: "Confirm Registration", help: "Help", guide: "User Guide", downloads: "Download App", account: "Account Help", request_access: "Request App Access", forgot_password: "Forgot Password", link_telegram: "Link My Account", token: "My App Invitation", troubleshooting: "Troubleshooting", rules: "Rules", contact: "Contact Admin", about: "About", app_help: "Playback Help", whats_new: "Whats New", status: "Service Status", admin: "Admin Commands", notify_update: "Notify Update", admin_invite: "Invite", admin_invites: "Invites", admin_revoke: "Revoke" };
var titleCase = /* @__PURE__ */ __name2((value) => value.replace(/\b[a-z]/g, (c) => c.toUpperCase()), "titleCase");
var BUTTON_LABELS = { "help": "\u{1F3E0} Main menu", "user_commands": "\u{1F464} User Commands", "guide": "\u{1F4D6} Charming MediaLab User Guide", "downloads": "\u{1F4E5} Download Charming MediaLab", "account": "\u{1F511} Account Help", "rules": "\u{1F4DC} Rules & Information", "app_help": "\u25B6 Sources & MultiView Help", "whats_new": "\u2728 What\u2019s New", "status": "\u{1F4E1} Service Status", "request_access": "\u{1F39F} Request App Access", "confirm_registration": "\u2705 Confirm Registration", "forgot_password": "\u{1F510} Forgot Password", "link_telegram": "\u{1F517} Link My Account", "admin_invite": "\u{1F39F} Create room invitation", "admin_invites": "\u{1F4CB} Recent room invitations", "admin_revoke": "\u{1F6AB} Revoke room invitation" };
var COMMAND_ICONS = { "my_account": "\u{1F464}", "account_status": "\u{1F4C5}", "my_sessions": "\u{1F4F1}", "sign_out_all": "\u{1F6AA}", "my_security": "\u{1F510}", "unlink_my_account": "\u{1F513}", "invite_status": "\u{1F39F}", "search_user": "\u{1F50E}", "userinfo": "\u{1F464}", "user_status": "\u{1F4C5}", "link_account": "\u{1F517}", "relink_account": "\u{1F504}", "unlink_account": "\u{1F513}", "reset_user_password": "\u{1F510}", "signout_user": "\u{1F6AA}", "disable_account": "\u23F8", "enable_account": "\u2705", "ban_user": "\u26D4", "unban_user": "\u2705", "delete_account": "\u{1F5D1}", "extend_user": "\u{1F4C5}", "set_expiration": "\u{1F4C6}", "set_limit": "\u{1F522}", "user_sessions": "\u{1F4F1}", "revoke_sessions": "\u{1F6AA}", "invite_info": "\u{1F39F}", "cancel_invite": "\u{1F6AB}", "create_app_invite": "\u{1F39F}", "recent_users": "\u{1F465}", "recent_links": "\u{1F517}", "user_audit": "\u{1F4CB}", "bot_status": "\u{1F4E1}", "bot_stats": "\u{1F4CA}" };
var BOT_COMMANDS = COMMANDS.map((c) => ({ ...c, buttonLabel: BUTTON_LABELS[c.id] || (/^[^\p{L}\p{N}]/u.test(c.label) ? c.label : (COMMAND_ICONS[c.command] || (c.admin ? "\u{1F6E1}" : "\u{1F464}")) + " " + c.label), phrase: PHRASES[c.id] || titleCase(c.phrase || c.command.replaceAll("_", " ")), label: "Mr Charm " + (PHRASES[c.id] || titleCase(c.phrase || c.command.replaceAll("_", " "))) }));
function commandText(value) {
  if (typeof value !== "string")
    return value;
  return value.replace(/\bMr\. Charm\b/g, "Mr Charm").replace(/(^|[\s(])\/([a-z_]+)(?:@\w+)?\b/gi, (whole, prefix, name) => {
    const c = BOT_COMMANDS.find((c2) => c2.command === name.toLowerCase());
    return c ? prefix + c.label : whole;
  });
}
__name(commandText, "commandText");
__name2(commandText, "commandText");
function commandButtons(markup2) {
  if (!markup2?.inline_keyboard)
    return markup2;
  return { ...markup2, inline_keyboard: markup2.inline_keyboard.map((row) => row.map((b) => ({ ...b, text: buttonText(b) }))) };
}
__name(commandButtons, "commandButtons");
__name2(commandButtons, "commandButtons");
function buttonText(button) {
  const original = commandText(button.text || "");
  if (original.startsWith("\u21A9"))
    return original;
  if (/^(?:back|cancel)\b/i.test(original))
    return "\u21A9 " + original;
  const command = BOT_COMMANDS.find((c) => c.id === button.callback_data);
  if (command)
    return command.buttonLabel;
  if (/^[^\p{L}\p{N}]/u.test(original))
    return original;
  const icon = /^(?:yes|confirm|approve|enable)\b/i.test(original) ? "\u2705" : /^(?:no|delete|revoke|disable)\b/i.test(original) ? "\u26D4" : button.url ? "\u2197" : button.callback_data?.startsWith("issue:") ? "\u{1F6E0}" : button.callback_data?.startsWith("answer:") ? "\u{1F4FA}" : "\u203A";
  return icon + " " + original;
}
__name(buttonText, "buttonText");
__name2(buttonText, "buttonText");
function brandText(value) {
  if (typeof value !== "string")
    return value;
  return commandText(value).replace(
    /https?:\/\/[^\s<>]+|@[a-z0-9_]+|\bcharm\s*iptv\b/gi,
    (text) => /^https?:|^@/i.test(text) ? text : "Charming MediaLab"
  );
}
__name(brandText, "brandText");
__name2(brandText, "brandText");
function brandedContent(row) {
  return row ? { ...row, body: brandText(row.body) } : row;
}
__name(brandedContent, "brandedContent");
__name2(brandedContent, "brandedContent");
function brandedTelegramBody(body) {
  const next = { ...body };
  for (const [field, entities] of [["text", "entities"], ["caption", "caption_entities"]]) {
    if (typeof next[field] !== "string")
      continue;
    const value = brandText(next[field]);
    if (value !== next[field])
      delete next[entities];
    next[field] = value;
  }
  if (next.rich_message?.html)
    next.rich_message = { ...next.rich_message, html: brandText(next.rich_message.html) };
  if (next.reply_markup) {
    next.reply_markup = { ...next.reply_markup };
    for (const key of ["inline_keyboard", "keyboard"])
      if (Array.isArray(next.reply_markup[key]))
        next.reply_markup[key] = next.reply_markup[key].map((row) => row.map((button) => typeof button === "string" ? brandText(button) : { ...button, text: brandText(button.text) }));
  }
  return next;
}
__name(brandedTelegramBody, "brandedTelegramBody");
__name2(brandedTelegramBody, "brandedTelegramBody");
var GUIDE = `\u{1F49C} YOUR Charming MediaLab GUIDE
PART 1 OF 2 \u2014 WATCHING & PERSONALIZING

Charming MediaLab combines live television, programme guides, on-demand entertainment, and personalized channel management.

Use the supplied playlists, your own compatible sources, or both.

\u{1F3AE} GETTING AROUND

\u2022 Use the arrows to move the highlight, OK/Select to choose, and Back to return.

\u2022 On screens with the left-hand icon bar, move to the page\u2019s left edge and press Left to enter it. Use Up/Down to choose an icon, then OK to open that area.

\u2022 Press Left while on the icon bar to expand the main menu. Press Right to return to the page.

\u2022 TV Guide uses a playlist-and-groups drawer instead of a permanent icon bar. Move left beyond the guide\u2019s navigation boundary to open it. Left from that drawer opens the main menu.

\u2022 Hold OK on supported channels or programmes to open Quick Actions.

\u{1F4FA} LIVE TV & TV GUIDE

Live TV lets you browse and watch channels.

TV Guide shows available schedules, descriptions, and a live preview. Expand a playlist in its drawer, then choose a channel group to narrow your selection.

A channel can still play when its listing says \u201CNo information.\u201D The stream and its programme schedule are separate.

First-time guide loading can take longer than loading channels. Programme accuracy depends on the guide provider.

\u{1F3AC} FIND SOMETHING TO WATCH

\u2022 Video OnDemand \u2014 Browse its available movies and series.

\u2022 Favorites \u2014 Use Quick Actions to add a channel. Open Favorites for quick access and organize saved channels into folders.

\u2022 Search \u2014 Find channels or programmes by name, then play a channel or open its guide listing.

\u2022 My Reminders \u2014 Select a future programme, open its actions, and choose Set reminder. Review or cancel alerts under My Reminders. Allow notifications when requested.

Reminders are alerts, not recordings.

\u{1F4C2} PLAYLISTS & PROGRAMME GUIDES

A playlist supplies channels. An EPG supplies their schedules.

To add your own playlist:

1. Open Settings \u2192 Playlists.
2. Choose Add M3U playlist.
3. Enter a name and playlist address.
4. Select Validate playlist.
5. Review the results and choose Save validated playlist.

You can also choose a local M3U/USB file where your device supports file selection.

Enable or disable supplied and personal playlists individually. Disabling retains their saved setup.

Each playlist has its own guide associations and update options. HTTP and HTTPS addresses are supported.

Open Settings \u2192 EPG to manage guide feeds. Custom EPG & channel assignments helps connect channels to the correct listings.

Refresh the playlist for channel-list changes, or refresh EPG for schedule updates. Automatic refresh options are available.

Only use authorized sources. Keep private playlist addresses confidential.

\u{1F3A8} MAKE IT FEEL LIKE YOUR APP

\u2022 General \u2014 Choose your startup screen, guide layout, logos, channel numbers, and clock format.

\u2022 Appearance \u2014 Adjust guide density and screen fit. Show or hide the icon bar, with a timeout of 1\u20139 minutes or Never Leaves.

\u2022 Channels \u2014 Hide channels, change their order, assign custom numbers, and manage custom groups.

\u2022 Remote Control \u2014 Customize supported playback shortcuts.

\u2022 Parental \u2014 Set a PIN and lock selected groups. Use Lock session now to require the PIN again.

\u27A1\uFE0F Continue with Part 2 for playback, accounts, invitations, and support.

\u{1F49C} YOUR Charming MediaLab GUIDE
PART 2 OF 2 \u2014 PLAYBACK, ACCOUNTS & HELP

\u{1F39B}\uFE0F PLAYBACK OPTIONS

\u2022 Player controls \u2014 Browse channels, return to the guide, pause/resume, stop, or open Quick Actions.

\u2022 Restart channel \u2014 Reloads a stuck stream. It does not restart the programme from the beginning.

\u2022 Audio/CC \u2014 Choose available audio and subtitle tracks. Preferred languages can be set under Settings \u2192 Player. The stream must supply those tracks.

\u2022 Buffer size \u2014 Small favors faster starts; larger buffers allow more buffering room. A larger buffer cannot fix every connection or provider issue.

\u2022 Sleep timer \u2014 Set a playback timer under Settings \u2192 Player.

\u2022 Guide preview \u2014 Mute or hide it through Player or Appearance settings.

\u{1F464} UNDERSTANDING YOUR ACCOUNT

Settings \u2192 Account shows your expiration date, remaining time, and simultaneous-session limit.

Timed access runs continuously\u2014not only while you watch. Warnings appear during the final 14 days.

Contact an administrator before expiration to arrange an extension. Expired regular accounts are removed.

Keep your login private. Signing in beyond your session limit signs out the oldest session.

Signing out does not cancel your account or pause its timer.

\u{1F39F}\uFE0F FAMILY & FRIEND INVITATIONS

Eligible timed accounts begin with two invitation opportunities.

Your allowance refills up to two every six months from account creation. Unused opportunities never stack above two.

Generate codes under Settings \u2192 Invites. Creating a code reserves an opportunity. If unused after three days, the code expires and that opportunity returns.

You can have up to six active invited accounts. When one expires or is canceled, its position is released and an opportunity returns\u2014without exceeding the two-opportunity allowance.

Invited users receive access only up to your permitted expiration date, not a fresh full term.

Unlimited accounts cannot generate family-and-friend invitations.

\u{1F4CA} READING YOUR INVITES PAGE

\u2022 Code opportunities available \u2014 How many new codes you can generate now.

\u2022 Active invited accounts \u2014 How many of your six positions have active accounts.

\u2022 Family positions available \u2014 Remaining capacity within the six-position limit.

\u2022 Active unused codes \u2014 Codes generated but not yet redeemed.

\u2022 Used this 6-month period \u2014 Invitation usage recorded for the current cycle.

\u2022 Renews \u2014 Your invitation allowance refill date. This does NOT extend your account.

Individual entries show statuses and relevant dates or remaining time. Ended entries can be deleted from your history.

Your invitation list is private to your account. Invitees are identified by invitation number rather than their personal account details.

\u{1F4BE} BACKUPS & TROUBLESHOOTING

Settings \u2192 Backup & Restore offers setup and favorites-only backups.

Keep complete backups private: they can contain source addresses and provider credentials. A backup does not extend or restore an expired account.

Settings \u2192 Health provides playback information and diagnostic tools. EPG settings also show guide-update and source health.

When reporting a problem, include:

\u2022 Device model.
\u2022 App build.
\u2022 Affected channel.
\u2022 What happened and when.

Never post passwords or private source addresses.

Community help:
Settings \u2192 About \u2192 Open Charming MediaLab Telegram

\u26A0\uFE0F SIGNING OUT OR CANCELING

Sign Out leaves your account intact.

To permanently cancel:

1. Open Settings \u2192 Account.
2. Select Cancel Account.
3. Read the warning.
4. Enter your current password.
5. Type: please cancel me
6. Select Cancel My Account Forever.

Cancellation deletes your account and ends access. It cannot be undone. Returning requires a new invitation.

\u{1F49C} Enjoy exploring Charming MediaLab, and welcome to the community!`;
var RULES = "# Charming MediaLab Group Rules & Information\n\nWelcome to the official Charming MediaLab private group.\n\nThis group is intended for Charming MediaLab users, testers, support, updates, and community discussion. By remaining in the group, you agree to follow the rules below.\n\n## 1. Respect Everyone\n\nTreat members, testers, and Admins with respect.\n\nHarassment, threats, bullying, personal attacks, excessive arguing, or intentionally creating problems in the group will not be tolerated.\n\nDisagreements are fine. Disrespect is not.\n\n## 2. Do Not Share Your Charming MediaLab Token\n\nYour Charming MediaLab token is assigned to your account.\n\nDo not post your token publicly in the group or give it to another person.\n\nIf you need to retrieve your token, ask Mr. Charm in the group:\n\n**Mr. Charm Token**\n\nor use the **My Token** option in Mr. Charm's Account Help menu.\n\n## 3. Do Not Share Private Group Information\n\nThis is a private Charming MediaLab group.\n\nDo not publicly repost private group messages, account information, download information, testing information, invite links, or other member-only information without permission from an Admin.\n\n## 4. Do Not Share Group Invite Links\n\nDo not distribute the group's private invitation link unless an Admin has specifically authorized you to do so.\n\nPeople who want access should go through the normal join-request and approval process.\n\n## 5. One Account Per Authorized User\n\nDo not create or attempt to obtain multiple Charming MediaLab accounts or tokens unless an Admin has approved it.\n\nAttempting to bypass account limits may result in suspension or removal.\n\n## 6. Follow Your Account Limits\n\nYour Charming MediaLab account may have a limit on simultaneous devices or connections.\n\nPlease stay within the limits assigned to your account.\n\nIf you need additional access, contact an Admin or use the options provided through Mr. Charm if available.\n\n## 7. Do Not Sell or Redistribute Your Account\n\nCharming MediaLab accounts, tokens, invitations, and access provided to you are for your authorized use.\n\nDo not sell, trade, redistribute, or advertise your Charming MediaLab access to other people without permission.\n\n## 8. Keep Personal Account Information Private\n\nDo not post passwords, tokens, personal contact information, or other sensitive information in the public group.\n\nIf an Admin needs account information from you, handle it privately.\n\n## 9. Use Mr. Charm Before Requesting Routine Support\n\nMr. Charm is the Charming MediaLab Assistant and can help with many common questions and tasks.\n\nType:\n\n**Mr. Charm Help**\n\nto view everything Mr. Charm can currently help you with.\n\nExamples may include:\n\n**Charming MediaLab User Guide**\n\n**Download Charming MediaLab**\n\n**Account Help**\n\n**My Token**\n\n**Troubleshooting**\n\n**Rules & Information**\n\n**What's New**\n\n**Contact an Admin**\n\nUsing Mr. Charm first helps Admins concentrate on problems that require direct assistance.\n\n## 10. Give Admins Time to Respond\n\nAdmins may be helping several users at the same time.\n\nIf you have recently joined or requested help, please allow reasonable time for someone to respond.\n\nRepeatedly tagging or messaging multiple Admins for the same issue may slow support down rather than speed it up.\n\n## 11. No Spam or Unrelated Advertising\n\nDo not spam the group.\n\nDo not post unrelated advertisements, referral links, promotions, repetitive messages, or links to unrelated services without Admin permission.\n\n## 12. Keep Support Conversations Useful\n\nWhen reporting a problem, provide enough information for someone to help you.\n\nUseful information may include:\n\n- What you were trying to do\n- What happened\n- Your device type\n- Whether the problem affects one channel or multiple channels\n- Any error message you received\n\nNever post your token or password publicly.\n\n## 13. Testing Feedback Is Welcome\n\nIf you are participating in testing, clear and detailed feedback is encouraged.\n\nPlease explain what happened, what you expected to happen, and whether you were able to reproduce the problem.\n\n## 14. Admin Decisions\n\nAdmins may warn, mute, temporarily restrict, suspend, ban, or remove accounts when necessary to protect the group or enforce these rules.\n\nSerious violations may result in immediate removal.\n\nIf you believe an action was taken in error, contact an Admin privately and respectfully.\n\n## 15. Rules May Be Updated\n\nThese rules may be updated as Charming MediaLab and Mr. Charm continue to develop.\n\nThe current version available through **Mr. Charm Rules** should always be considered the active version.\n\n# Mr. Charm\n\nMr. Charm is your Charming MediaLab Assistant.\n\nYou do not need to use traditional slash commands.\n\nSimply type something such as:\n\n**Mr. Charm Help**\n\n**Mr. Charm Guide**\n\n**Mr. Charm Token**\n\n**Mr. Charm Download**\n\nMr. Charm shows your help menu and personal replies inside the group, visible only to you. Type Mr. Charm Help again if a reply disappears. Never type your token or password into the group.\n\nThank you for being part of Charming MediaLab and helping us keep the community organized, respectful, and useful.\n\nVIOLATION OF ANY OF THESE RULES IS A LIFETIME BAN FROM THE Charming MediaLab APP AND THE TELEGRAM GROUP.";
var DEFAULT_CONTENT = {
  app_help: { body: "Charming MediaLab playback help\n\nLive TV playlists: Settings \u2192 Playlists lists supplied and personal sources. Enable each source you want. In the TV Guide, choose All Playlists to combine them, or select one playlist. Check the visible filter if channels seem missing. Advanced contains guide associations and refresh schedules.\n\nMultiview: Open a live channel and select Multiview. Press OK on a screen for Change channel, Add another channel, Listen, Audio, Captions, Enlarge, Swap, Retry or Close. Change channel opens a searchable side picker with playlist, group, favorites and recent filters. Back dismisses a menu or returns an enlarged screen to the grid. Settings \u2192 Player includes automatic layout, audio following focus, labels and remembering the last arrangement. Up to four streams; provider and device limits still apply.\n\nVOD Sources: Select Sources while playing to switch at any time. Filter by Direct/Real-Debrid, resolution, or Ready in your cloud. Hold OK or long press for full release details. Ready describes cloud availability, not guaranteed device compatibility. Quick Play remains available; Choose Source First is optional in VOD Settings.\n\nReal-Debrid: VOD Settings \u2192 Sources & Real-Debrid offers a device-code connection: enter the displayed code at real-debrid.com/device and approve it in your browser. Manual API-token connection remains available. Never share your token or password with the bot or admins. Reconnect expired logins; select an expired playback source again or try an alternative.\n\nBackups: Settings \u2192 Backup & Restore offers basic Live TV settings and favorites without credentials, or a password-encrypted Live TV backup including playlists and provider credentials. VOD history/preferences, app sign-in and Real-Debrid login are excluded. Keep the backup password separately; it cannot be recovered. Restart after restoring.\n\nHelp: Settings \u2192 Help & Health links to playlist, guide, VOD and account checks. You can preview and share a private numeric Live TV support report. It excludes account details, channel names, passwords, tokens and stream URLs.\n\nFormats: Media3 is the default; optional Nova playback is available for VOD. HEVC, AV1, HDR and 4K depend on the device and source. A reported decoder does not verify every profile or bitrate.", enabled: 1 },
  rules: { body: RULES, enabled: 1 },
  guide: { body: GUIDE, enabled: 1 },
  whats_new: { body: "", enabled: 0 },
  broadcast: { body: "", enabled: 0 },
  downloads: { body: "Download Charming MediaLab\nOpen the Downloader app on your device and enter:\n\nPrimary Downloader Code: 2977459\n\nFollow the download and installation prompts. This code downloads the app; it is separate from your personal invitation token.", enabled: 1 },
  status: { body: "", enabled: 0 },
  welcome: { body: "Hello, {name}! I\u2019m Mr. Charm \u2014 Your Charming MediaLab Assistant. How can I help you today? Type Mr. Charm Help anytime. Tap Help below to see your personal menu right here in the group. Only you can see your menu and personal replies.", enabled: 1 },
  waiting: { body: "Thank You for Choosing Charming MediaLab! Your request to join has been received. Our Admins may be helping other users and will be with you momentarily. Once approved, use Mr. Charm Token to retrieve your assigned invitation. If you need help after 30 minutes, contact a support Admin. After approval, type Mr. Charm Help in the group to see your personal menu there. The private chat below is optional.", enabled: 1 },
  acknowledgment: { body: "Sure, let me get right on that, {name}! \u{1F916}", enabled: 1 },
  reminder: { body: "Hello! I\u2019m Mr. Charm, your favorite Charming MediaLab Assistant. I\u2019m here to assist you with your Charming MediaLab tasks. Type Mr. Charm Help to get started. \u{1F916}", enabled: 1 },
  about: { body: "I\u2019m Mr. Charm \u2014 Your Charming MediaLab Assistant. I can help with your user guide, downloads, account information and troubleshooting. Human Admins make approval and moderation decisions.", enabled: 1 }
};
var now = /* @__PURE__ */ __name2(() => Math.floor(Date.now() / 1e3), "now");
var q = /* @__PURE__ */ __name2((env, sql, ...v) => v.length ? env.DB.prepare(sql).bind(...v) : env.DB.prepare(sql), "q");
var rows = /* @__PURE__ */ __name2(async (env, sql, ...v) => (await q(env, sql, ...v).all()).results || [], "rows");
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
__name(fail, "fail");
__name2(fail, "fail");
async function settings(env) {
  const r = await q(env, "SELECT * FROM bot_settings WHERE id=1").first();
  const s = JSON.parse(r.json);
  return { ...s, app_version: brandText(s.app_version), download_codes: s.download_codes?.map((c) => ({ ...c, label: brandText(c.label) })), revision: r.revision };
}
__name(settings, "settings");
__name2(settings, "settings");
async function content(env, key) {
  return brandedContent(await q(env, "SELECT * FROM bot_content WHERE key=?1", key).first() || { key, ...DEFAULT_CONTENT[key], revision: 0 });
}
__name(content, "content");
__name2(content, "content");
async function event(env, id, action, detail = "", admin = null) {
  await q(env, "INSERT INTO bot_events(telegram_id,action,detail,admin_id,created_at) VALUES(?1,?2,?3,?4,?5)", id, action, detail, admin, now()).run();
}
__name(event, "event");
__name2(event, "event");
async function member(env, user, status = null, date2 = now()) {
  await q(env, `INSERT INTO bot_members(telegram_id,name,username,status,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name,username=excluded.username,status=CASE WHEN ?6 IS NULL THEN bot_members.status ELSE excluded.status END,updated_at=MAX(bot_members.updated_at,excluded.updated_at)`, String(user.id), [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 200), String(user.username || ""), status || "unknown", date2, status).run();
}
__name(member, "member");
__name2(member, "member");
async function assignToken(env, id, s, join = null) {
  const m = await q(env, "SELECT * FROM bot_members WHERE telegram_id=?1", id).first();
  const pendingJoin = join && m?.status === "pending" && await q(env, "SELECT 1 AS ok FROM bot_join_requests WHERE group_id=?1 AND telegram_id=?2 AND update_id=?3 AND lease_token=?4 AND lease_until>?5 AND approved_at IS NULL", join.groupId, id, join.updateId, join.lease, now()).first();
  if (!m || m.blocked || !["member", "administrator", "creator", "restricted_member"].includes(m.status) && !pendingJoin)
    return null;
  if (m.invite_id)
    return q(env, "SELECT * FROM invites WHERE id=?1", m.invite_id).first();
  if (m.ever_assigned || m.account_id || !s.auto_tokens || !s.accounts_enabled)
    return null;
  const owner = await q(env, "SELECT user_id FROM admin_owner").first();
  if (!owner)
    return null;
  const iid = crypto.randomUUID(), code = "CHM-" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase(), t = now();
  await env.DB.batch([
    q(env, `INSERT INTO invites(id,invite_code,account_duration_days,max_sessions,created_by_user_id,created_at,expires_at) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM bot_members WHERE telegram_id=?8 AND ever_assigned=0 AND invite_id IS NULL AND account_id IS NULL AND blocked=0 AND (status IN('member','administrator','creator','restricted_member') OR (status='pending' AND ?9=1)))`, iid, code, s.token_days, s.connections, owner.user_id, t, t + s.invite_days * 86400, id, pendingJoin ? 1 : 0),
    q(env, `UPDATE bot_members SET invite_id=?1,ever_assigned=1 WHERE telegram_id=?2 AND ever_assigned=0 AND EXISTS(SELECT 1 FROM invites WHERE id=?1)`, iid, id),
    q(env, `INSERT INTO bot_events(telegram_id,action,created_at) SELECT ?1,'token_created',?2 WHERE EXISTS(SELECT 1 FROM bot_members WHERE telegram_id=?1 AND invite_id=?3)`, id, t, iid)
  ]);
  return q(env, "SELECT i.* FROM invites i JOIN bot_members m ON m.invite_id=i.id WHERE m.telegram_id=?1", id).first();
}
__name(assignToken, "assignToken");
__name2(assignToken, "assignToken");
function validateRelease(b) {
  const out = {};
  for (const [key, max] of [["version", 60], ["title", 160], ["notes", 6e3]]) {
    if (typeof b[key] !== "string" || !b[key].trim() || (key === "notes" ? richLength(b[key]) : b[key].length) > max)
      fail("Enter a valid " + key, 400);
    out[key] = b[key].trim();
  }
  let url;
  try {
    url = new URL(b.download_url);
  } catch {
    fail("Enter a valid HTTPS download URL.", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2048)
    fail("Use an HTTPS download URL without credentials.", 400);
  out.download_url = url.href;
  const code = b.downloader_code === void 0 ? "" : b.downloader_code;
  if (typeof code !== "string" || code.trim() !== "" && !/^\d{1,12}$/.test(code.trim()))
    fail("Downloader code must contain only digits, or be blank.", 400);
  out.downloader_code = code.trim();
  if (!Number.isSafeInteger(b.build) || b.build < 1 || b.build > 2147483647)
    fail("Build must be a positive whole number.", 400);
  if (!Number.isSafeInteger(b.size_bytes) || b.size_bytes < 1 || b.size_bytes > 21474836480)
    fail("Enter the APK file size in bytes.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.release_date) || !Number.isFinite(Date.parse(b.release_date)) || new Date(b.release_date).toISOString().slice(0, 10) !== b.release_date)
    fail("Enter a valid release date.", 400);
  return { ...out, build: b.build, size_bytes: b.size_bytes, release_date: b.release_date };
}
__name(validateRelease, "validateRelease");
__name2(validateRelease, "validateRelease");
async function releaseConfig(env) {
  const r = await q(env, "SELECT * FROM website_release WHERE id=1").first();
  return { ...JSON.parse(r.json), revision: r.revision, updated_at: r.updated_at };
}
__name(releaseConfig, "releaseConfig");
__name2(releaseConfig, "releaseConfig");
async function releaseAdmin(request, env, auth, { json: json2, safeJson: safeJson2 }) {
  if (!auth.isOwner && !auth.profile.can_manage_bot)
    fail("Website release management requires bot-management permission.", 403);
  if (request.method === "GET")
    return json2({ success: true, release: await releaseConfig(env), history: await rows(env, "SELECT revision,updated_at FROM website_release_history ORDER BY id DESC LIMIT 10") });
  if (request.method !== "PUT")
    return json2({ success: false, error: "Method not allowed" }, 405);
  const b = await safeJson2(request);
  if (!Number.isInteger(b.revision))
    fail("Refresh this form before publishing.", 409);
  const old = await releaseConfig(env);
  if (old.revision !== b.revision)
    fail("Another admin changed this release. Refresh before publishing.", 409);
  const data = validateRelease({ ...b, downloader_code: b.downloader_code === void 0 ? old.downloader_code || "" : b.downloader_code });
  const results = await env.DB.batch([
    q(env, "INSERT INTO website_release_history(revision,json,updated_at,updated_by) SELECT revision,json,updated_at,updated_by FROM website_release WHERE id=1 AND revision=?1", b.revision),
    q(env, "UPDATE website_release SET json=?1,revision=revision+1,updated_at=?2,updated_by=?3 WHERE id=1 AND revision=?4", JSON.stringify(data), now(), auth.user.id, b.revision)
  ]);
  if (!results[1].meta.changes)
    fail("Release changed. Refresh before publishing.", 409);
  await event(env, null, "website_release_published", "Build " + data.build, auth.user.id);
  return json2({ success: true, release: await releaseConfig(env) });
}
__name(releaseAdmin, "releaseAdmin");
__name2(releaseAdmin, "releaseAdmin");
function usageInput(b) {
  if (!["iptv", "vod", "idle"].includes(b.mode) || typeof b.playing !== "boolean" || !Number.isSafeInteger(b.sequence) || b.sequence < 0 || !Number.isInteger(b.build) || b.build < 1)
    fail("Invalid activity update.", 400);
  if (b.mode === "idle" && b.playing)
    fail("Idle activity cannot be playing.", 400);
  return b;
}
__name(usageInput, "usageInput");
__name2(usageInput, "usageInput");
async function usageHeartbeat(request, env, auth, { json: json2, safeJson: safeJson2 }) {
  const b = usageInput(await safeJson2(request)), t = now(), day = Math.floor(t / 86400) * 86400;
  const valid = "sequence < ?3 AND last_seen >= ?4 AND last_seen < ?5";
  await env.DB.batch([
    ...[day - 86400, day].map((bucket) => q(env, `INSERT INTO app_usage_daily(user_id,day,iptv_seconds,vod_seconds,foreground_seconds)
   SELECT user_id,?2,CASE WHEN mode='iptv' AND playing=1 THEN MIN(?5,?2+86400)-MAX(last_seen,?2) ELSE 0 END,
   CASE WHEN mode='vod' AND playing=1 THEN MIN(?5,?2+86400)-MAX(last_seen,?2) ELSE 0 END,
   CASE WHEN mode<>'idle' THEN MIN(?5,?2+86400)-MAX(last_seen,?2) ELSE 0 END
   FROM app_presence WHERE session_id=?1 AND ${valid} AND last_seen<?2+86400 AND ?5>?2
   ON CONFLICT(user_id,day) DO UPDATE SET iptv_seconds=iptv_seconds+excluded.iptv_seconds,vod_seconds=vod_seconds+excluded.vod_seconds,foreground_seconds=foreground_seconds+excluded.foreground_seconds`, auth.session.id, bucket, b.sequence, t - 90, t)),
    q(env, `INSERT INTO app_usage_daily(user_id,day,visits) SELECT ?1,?2,1 WHERE ?3<>'idle' AND NOT EXISTS(SELECT 1 FROM app_presence WHERE session_id=?4 AND (last_seen>=?5 OR sequence>=?6))
   ON CONFLICT(user_id,day) DO UPDATE SET visits=visits+1`, auth.user.id, day, b.mode, auth.session.id, t - 120, b.sequence),
    q(env, `INSERT INTO app_usage_daily(user_id,day,signins) SELECT ?1,?2,1 WHERE NOT EXISTS(SELECT 1 FROM app_presence WHERE session_id=?3) ON CONFLICT(user_id,day) DO UPDATE SET signins=signins+1`, auth.user.id, day, auth.session.id),
    q(env, `INSERT INTO app_presence(session_id,user_id,sequence,mode,playing,last_seen,started_at,build) VALUES(?1,?2,?3,?4,?5,?6,?6,?7)
   ON CONFLICT(session_id) DO UPDATE SET sequence=excluded.sequence,mode=excluded.mode,playing=excluded.playing,last_seen=excluded.last_seen,
   started_at=CASE WHEN app_presence.last_seen<excluded.last_seen-120 OR app_presence.playing=0 AND excluded.playing=1 THEN excluded.last_seen ELSE app_presence.started_at END,build=excluded.build
   WHERE excluded.sequence>app_presence.sequence`, auth.session.id, auth.user.id, b.sequence, b.mode, b.playing ? 1 : 0, t, b.build)
  ]);
  return json2({ success: true, server_time: t });
}
__name(usageHeartbeat, "usageHeartbeat");
__name2(usageHeartbeat, "usageHeartbeat");
async function usageReport(env, auth, period = "30") {
  if (!auth.isOwner && !auth.profile.can_manage_bot)
    fail("Usage reports require bot-management permission.", 403);
  if (!["1", "7", "30", "all"].includes(period))
    fail("Choose Today, 7 days, 30 days or All time.", 400);
  const t = now(), since = period === "all" ? 0 : Math.floor(t / 86400) * 86400 - (Number(period) - 1) * 86400;
  const scoped = auth.isOwner || auth.profile.can_manage_all;
  const scope2 = scoped ? "1=1" : "EXISTS(SELECT 1 FROM admin_user_attribution a WHERE a.user_id=u.id AND a.admin_user_id=?2)";
  const values = scoped ? [t] : [t, auth.user.id];
  const accounts = await q(env, `SELECT COUNT(*) active_accounts,SUM(CASE WHEN EXISTS(SELECT 1 FROM bot_members m WHERE m.account_id=u.id AND m.blocked=0) THEN 1 ELSE 0 END) linked_accounts FROM users u WHERE u.status='active' AND (u.expires_at IS NULL OR u.expires_at>?1) AND ${scope2}`, ...values).first();
  const online = await rows(env, `SELECT u.id,u.username,p.mode,MAX(p.playing) playing,MIN(p.started_at) started_at,MAX(p.build) build FROM app_presence p JOIN users u ON u.id=p.user_id JOIN sessions s ON s.id=p.session_id WHERE p.last_seen>?1-120 AND p.mode<>'idle' AND s.revoked=0 AND s.expires_at>?1 AND u.status='active' AND (u.expires_at IS NULL OR u.expires_at>?1) AND ${scope2} GROUP BY u.id,p.mode ORDER BY started_at,u.id`, ...values);
  const rankValues = scoped ? [since] : [since, auth.user.id];
  const rankBase = `SELECT u.id,u.username,SUM(d.iptv_seconds) iptv_seconds,SUM(d.vod_seconds) vod_seconds,SUM(d.iptv_seconds+d.vod_seconds) watch_seconds,SUM(d.foreground_seconds) foreground_seconds,SUM(d.visits) visits,SUM(d.signins) signins FROM app_usage_daily d JOIN users u ON u.id=d.user_id WHERE d.day>=?1 AND ${scope2} GROUP BY u.id HAVING SUM(d.iptv_seconds+d.vod_seconds)>0`;
  const most = await rows(env, rankBase + " ORDER BY watch_seconds DESC,u.id LIMIT 10", ...rankValues);
  const least = await rows(env, rankBase + " ORDER BY watch_seconds ASC,u.id LIMIT 10", ...rankValues);
  const visits = await rows(env, rankBase + " ORDER BY visits DESC,u.id LIMIT 10", ...rankValues);
  const signins = await rows(env, rankBase.replace("HAVING SUM(d.iptv_seconds+d.vod_seconds)>0", "HAVING SUM(d.signins)>0") + " ORDER BY signins DESC,u.id LIMIT 10", ...rankValues);
  return { period, tracking_started_at: (await q(env, "SELECT started_at FROM app_usage_metadata WHERE id=1").first()).started_at, accounts: { ...accounts, linked_accounts: accounts.linked_accounts || 0, unlinked_accounts: accounts.active_accounts - (accounts.linked_accounts || 0) }, online, online_users: new Set(online.map((x) => x.id)).size, iptv_users: new Set(online.filter((x) => x.mode === "iptv").map((x) => x.id)).size, vod_users: new Set(online.filter((x) => x.mode === "vod").map((x) => x.id)).size, most, least, visits, signins };
}
__name(usageReport, "usageReport");
__name2(usageReport, "usageReport");
var DAY = 86400;
var ADMIN_FLAGS = [
  "can_create_invites",
  "can_manage_all",
  "can_change_time",
  "can_change_sessions",
  "can_suspend",
  "can_delete_users",
  "can_reset_password",
  "can_force_logout",
  "can_revoke_invites",
  "can_delete_invites",
  "can_view_audit",
  "can_manage_bot",
  "can_manage_announcements"
];
var ADMIN_LIMITS = {
  max_duration_days: [1, 3650, 90],
  max_sessions: [1, 20, 2],
  max_accounts_total: [0, 1e6, 0],
  max_open_accounts: [0, 1e6, 0],
  max_pending_invites: [0, 1e3, 0],
  max_invite_valid_days: [1, 365, 7]
};
function policyError(message, status = 403) {
  return Object.assign(new Error(message), { status });
}
__name(policyError, "policyError");
__name2(policyError, "policyError");
function integer(value, min, max, label) {
  if (value === null || typeof value === "boolean" || value === "" || !["number", "string"].includes(typeof value))
    throw policyError(`${label} must be a whole number.`, 400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw policyError(`${label} must be between ${min} and ${max}.`, 400);
  return parsed;
}
__name(integer, "integer");
__name2(integer, "integer");
function normalizeAdminProfile(input, previous = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw policyError("Permissions must be an object.", 400);
  const allowed = /* @__PURE__ */ new Set([...ADMIN_FLAGS, ...Object.keys(ADMIN_LIMITS), "enabled"]);
  for (const key of Object.keys(input))
    if (!allowed.has(key))
      throw policyError(`Unknown permission: ${key}`, 400);
  const result = {};
  for (const key of [...ADMIN_FLAGS, "enabled"]) {
    const value = Object.hasOwn(input, key) ? input[key] : previous[key] ?? (key === "enabled" ? 1 : 0);
    if (![true, false, 0, 1].includes(value))
      throw policyError(`${key} must be on or off.`, 400);
    result[key] = value ? 1 : 0;
  }
  for (const [key, [min, max, fallback]] of Object.entries(ADMIN_LIMITS))
    result[key] = integer(Object.hasOwn(input, key) ? input[key] : previous[key] ?? fallback, min, max, key);
  return result;
}
__name(normalizeAdminProfile, "normalizeAdminProfile");
__name2(normalizeAdminProfile, "normalizeAdminProfile");
function demandPermission(auth, permission) {
  if (!auth.isOwner && auth.profile?.[permission] !== 1)
    throw policyError("Your owner has not granted this permission.");
}
__name(demandPermission, "demandPermission");
__name2(demandPermission, "demandPermission");
function invitationTerms(body, auth) {
  demandPermission(auth, "can_create_invites");
  const duration = body.account_duration_days === null ? null : integer(body.account_duration_days ?? 30, 1, 3650, "Account days");
  const sessions = integer(body.max_sessions ?? 1, 1, 20, "Simultaneous sessions");
  const validDays = body.invite_expires_days === null ? null : integer(body.invite_expires_days ?? 7, 1, 365, "Code validity days");
  if (!auth.isOwner) {
    if (duration === null)
      throw policyError("Only the owner can grant unlimited accounts.");
    if (duration > auth.profile.max_duration_days)
      throw policyError("Account duration exceeds your owner-assigned limit.");
    if (sessions > auth.profile.max_sessions)
      throw policyError("Session allowance exceeds your owner-assigned limit.");
    if (validDays === null || validDays > auth.profile.max_invite_valid_days)
      throw policyError("Code validity exceeds your owner-assigned limit.");
  }
  return { duration, sessions, validDays };
}
__name(invitationTerms, "invitationTerms");
__name2(invitationTerms, "invitationTerms");
function referralAccess(invitation, inviter, now2) {
  if (!inviter || inviter.role === "admin" && !inviter.viewer_access || inviter.status !== "active")
    throw policyError("The inviting account is not available.", 410);
  const current = inviter.expires_at == null ? null : Number(inviter.expires_at);
  const grant = invitation.grant_expires_at == null ? null : Number(invitation.grant_expires_at);
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(grant) || current <= now2 || grant <= now2)
    throw policyError("This invitation requires valid, timed access from the inviting account.", 410);
  return { expiresAt: Math.min(current, grant), maxSessions: Math.max(1, Math.min(Number(inviter.max_sessions), Number(invitation.max_sessions))) };
}
__name(referralAccess, "referralAccess");
__name2(referralAccess, "referralAccess");
function listingOptions(url, sorts) {
  const page = integer(url.searchParams.get("page") ?? 1, 1, 1e6, "Page");
  const pageSize = integer(url.searchParams.get("page_size") ?? 25, 1, 100, "Page size");
  const sort = url.searchParams.get("sort") || "newest";
  if (!Object.hasOwn(sorts, sort))
    throw policyError("Invalid sort order.", 400);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
  return { page, pageSize, offset: (page - 1) * pageSize, orderBy: sorts[sort], search, pattern: `%${search.replace(/[\\%_]/g, "\\$&")}%` };
}
__name(listingOptions, "listingOptions");
__name2(listingOptions, "listingOptions");
var TELEGRAM_LINK_STEPS = [
  "Existing accounts, including accounts created before Mr Charm: complete these steps only if no verified account link is shown. Saving a Telegram contact in the web panel is not account verification.",
  "1. Open the Charming MediaLab Android app on a TV or Android phone and sign in to your existing account. Do not create a second account or request a new invitation.",
  "2. Inside the app, open Settings \u2192 Account \u2192 Link Telegram / Account Recovery. This is the Android app\u2019s Settings, not the web panel.",
  "3. Enter your current app password inside the app. Scan the displayed QR with your phone, or privately send Mr Charm Link My Account followed by the request code shown in the app.",
  "4. In Telegram, use the identity you want linked and approve only the request you just started. Return to the app and check that verification completed. Requests expire after ten minutes.",
  "If you cannot sign in or a different Telegram identity is already linked, ask an authorized admin for verified account recovery. Never send your password to the bot."
];
var ADMIN_LINK_STEPS = [
  "For your own admin access, use your existing app/panel administrator login in the Android app and follow the steps above. A Telegram group-admin badge or saved contact alone does not enable account-management commands.",
  "To help another user: send them the steps above so they can verify their own account. If your own admin identity is already verified and you have account-recovery permission, Link Account can instead link their exact app username to their permanent numeric Telegram ID after you verify ownership and confirm the action. Use Relink Account only when replacing an existing identity after verification.",
  "A Telegram username change does not require relinking: verified links use the permanent Telegram ID. Accounts that already show a verified link do not need these steps again."
];
var telegramLinkHelp = /* @__PURE__ */ __name2((admin = false) => [...TELEGRAM_LINK_STEPS, ...admin ? ADMIN_LINK_STEPS : []].join("\n\n"), "telegramLinkHelp");
function telegramUsername(value) {
  if (typeof value !== "string")
    fail("Enter a Telegram username, with or without @.", 400);
  const name = value.trim().replace(/^@/, "");
  if (name && !/^[a-zA-Z0-9_]{1,32}$/.test(name))
    fail("Use the Telegram @username, not an email, phone number or display name.", 400);
  return name;
}
__name(telegramUsername, "telegramUsername");
__name2(telegramUsername, "telegramUsername");
async function accountContact(env, userId, lookupUsername) {
  const saved = await q(env, "SELECT username,telegram_id,updated_at FROM account_telegram_contacts WHERE user_id=?1", userId).first();
  const linked = await q(env, "SELECT telegram_id,username,name FROM bot_members WHERE account_id=?1", userId).first();
  const contact2 = saved || { username: "", telegram_id: null };
  const matches = await rows(env, `SELECT telegram_id,name,username,status FROM bot_members
  WHERE telegram_id=?1 OR telegram_id=?2 OR (?3<>'' AND lower(username)=lower(?3)) ORDER BY telegram_id LIMIT 10`, contact2.telegram_id, linked?.telegram_id || null, lookupUsername === void 0 ? contact2.username : telegramUsername(lookupUsername));
  return { contact: contact2, linked: linked || null, matches, link_instructions: [...TELEGRAM_LINK_STEPS, ...ADMIN_LINK_STEPS] };
}
__name(accountContact, "accountContact");
__name2(accountContact, "accountContact");
async function saveAccountContact(env, userId, body) {
  const username = telegramUsername(body.username);
  const id = body.telegram_id == null || body.telegram_id === "" ? null : String(body.telegram_id).trim();
  if (id && !/^[1-9]\d{4,19}$/.test(id))
    fail("Use the numeric Telegram ID from a recorded member.", 400);
  if (id) {
    const person = await q(env, "SELECT telegram_id FROM bot_members WHERE telegram_id=?1 UNION SELECT telegram_id FROM bot_support_admins WHERE telegram_id=?1", id).first();
    if (!person)
      fail("Mr. Charm has not recorded that Telegram ID yet. Save the username alone or select a recorded member.", 400);
    const linked = await q(env, "SELECT account_id FROM bot_members WHERE telegram_id=?1 AND account_id IS NOT NULL", id).first();
    if (linked && linked.account_id !== userId)
      fail("This Telegram member is already verified against a different account.", 409);
  }
  const existingLink = await q(env, "SELECT telegram_id FROM bot_members WHERE account_id=?1", userId).first();
  if (id && existingLink && existingLink.telegram_id !== id)
    fail("This account already has a different verified Telegram identity. Review its member link first.", 409);
  try {
    if (!username && !id)
      await q(env, "DELETE FROM account_telegram_contacts WHERE user_id=?1", userId).run();
    else
      await q(env, `INSERT INTO account_telegram_contacts(user_id,username,telegram_id,updated_at) VALUES(?1,?2,?3,?4)
   ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,telegram_id=excluded.telegram_id,updated_at=excluded.updated_at`, userId, username, id, now()).run();
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(e.message))
      fail("That Telegram username or ID is already assigned in the contact directory.", 409);
    throw e;
  }
  return accountContact(env, userId);
}
__name(saveAccountContact, "saveAccountContact");
__name2(saveAccountContact, "saveAccountContact");
async function supportContacts(env, live) {
  const configured = await rows(env, "SELECT * FROM bot_support_admins");
  const accounts = await rows(env, `SELECT c.telegram_id,c.username FROM account_telegram_contacts c
  JOIN users u ON u.id=c.user_id JOIN admin_profiles p ON p.user_id=u.id WHERE u.role='admin' AND p.enabled=1 AND c.telegram_id IS NOT NULL`);
  return live.filter((a) => !a.user.is_bot && (!configured.length || configured.some((p) => p.telegram_id === String(a.user.id) && p.enabled === 1))).map((a) => {
    const id = String(a.user.id), record = configured.find((p) => p.telegram_id === id), account2 = accounts.find((p) => p.telegram_id === id);
    return { id, name: [a.user.first_name, a.user.last_name].filter(Boolean).join(" ") || record?.name || "Admin", username: a.user.username || record?.contact_username || account2?.username || "" };
  });
}
__name(supportContacts, "supportContacts");
__name2(supportContacts, "supportContacts");
var recurringInterval = /* @__PURE__ */ __name2((s) => Math.max(1, Math.min(24, Number(s.reminder_hours) || 6)) * 3600, "recurringInterval");
async function nextRecurring(env, s, t = now()) {
  const saved = await q(env, "SELECT value FROM bot_runtime WHERE key=?1", "reminder_next:" + s.group_id).first();
  if (saved)
    return Number(saved.value);
  const interval = recurringInterval(s), slot = Math.floor(t / interval);
  const legacy = await q(env, "SELECT value FROM bot_runtime WHERE key=?1", "reminder_slot:" + s.group_id).first();
  return legacy?.value === String(slot) ? (slot + 1) * interval : t;
}
__name(nextRecurring, "nextRecurring");
__name2(nextRecurring, "nextRecurring");
async function restartRecurring(env, s, t = now()) {
  await q(env, "INSERT INTO bot_runtime VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", "reminder_next:" + s.group_id, String(t + recurringInterval(s))).run();
}
__name(restartRecurring, "restartRecurring");
__name2(restartRecurring, "restartRecurring");
async function runRecurring(env, s, send2, remove, { force = false } = {}) {
  const c = await content(env, "reminder");
  if (!s.enabled || !s.reminder_enabled || !s.group_id || !c.enabled || !c.body.trim()) {
    if (force)
      fail("Enable the bot, recurring schedule and saved announcement message first.");
    return false;
  }
  if (!force && await nextRecurring(env, s) > now())
    return false;
  const key = "reminder_lock:" + s.group_id, lease = String(now() + 120) + ":" + crypto.randomUUID();
  const claimed = await q(env, "INSERT INTO bot_runtime VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<=?3", key, lease, now()).run();
  if (!claimed.meta.changes) {
    if (force)
      fail("An announcement is already being sent. Refresh shortly.", 409);
    return false;
  }
  try {
    if (!force && await nextRecurring(env, s) > now())
      return false;
    await replaceRecurring(env, s.group_id, c.body, send2, remove);
    await restartRecurring(env, s);
    return true;
  } catch (e) {
    await event(env, null, "reminder_send_failed", e.message);
    if (force)
      throw e;
    return false;
  } finally {
    await q(env, "DELETE FROM bot_runtime WHERE key=?1 AND value=?2", key, lease).run();
  }
}
__name(runRecurring, "runRecurring");
__name2(runRecurring, "runRecurring");
function recurringIds(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((n) => Number.isSafeInteger(n) && n > 0);
  } catch {
    return [];
  }
}
__name(recurringIds, "recurringIds");
__name2(recurringIds, "recurringIds");
async function currentRecurring(env, chatId, messageId) {
  const row = await q(env, "SELECT value FROM bot_runtime WHERE key=?1", "reminder_message:" + chatId).first();
  return recurringIds(row?.value).includes(Number(messageId));
}
__name(currentRecurring, "currentRecurring");
__name2(currentRecurring, "currentRecurring");
async function replaceRecurring(env, chatId, text, send2, remove) {
  const key = "reminder_message:" + chatId;
  const previous = recurringIds((await q(env, "SELECT value FROM bot_runtime WHERE key=?1", key).first())?.value);
  for (const id of previous) {
    await q(env, "DELETE FROM bot_responses WHERE chat_id=?1 AND message_id=?2 AND ephemeral=0", String(chatId), id).run();
    await q(env, "UPDATE bot_jobs SET status='canceled' WHERE kind='delete' AND status='pending' AND chat_id=?1 AND message_id=?2", String(chatId), id).run();
  }
  const delivery = { chatId: String(chatId), ids: [] };
  try {
    await send2({ ...env, BOT_RECURRING: delivery }, chatId, text);
    if (!delivery.ids.length)
      throw new Error("Telegram did not return an announcement message ID.");
    await q(env, "INSERT INTO bot_runtime VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(delivery.ids)).run();
  } catch (e) {
    for (const id of delivery.ids)
      try {
        await remove(env, "deleteMessage", { chat_id: chatId, message_id: id });
      } catch {
      }
    throw e;
  }
  await event(env, null, "reminder_sent", "Recurring announcement delivered; retained until manually deleted.");
}
__name(replaceRecurring, "replaceRecurring");
__name2(replaceRecurring, "replaceRecurring");
async function recurringStatus(env, s, t = now()) {
  const message = await content(env, "reminder");
  const interval = recurringInterval(s), next = await nextRecurring(env, s, t);
  const history = await rows(env, "SELECT action,detail,created_at FROM bot_events WHERE action IN ('reminder_sent','reminder_send_failed','reminder_delete_failed') ORDER BY id DESC LIMIT 20");
  const lastSent = await q(env, "SELECT created_at,detail FROM bot_events WHERE action='reminder_sent' ORDER BY id DESC LIMIT 1").first();
  const lastError = await q(env, "SELECT created_at,detail FROM bot_events WHERE action='reminder_send_failed' ORDER BY id DESC LIMIT 1").first();
  const blocked = !s.enabled ? "Bot is disabled" : !env.TELEGRAM_BOT_TOKEN ? "Bot token is missing" : !s.group_id ? "Telegram group is not configured" : !s.reminder_enabled ? "Recurring schedule is disabled" : !message.enabled ? "Announcement message is disabled" : !message.body.trim() ? "Announcement message is blank" : null;
  return {
    enabled: !blocked,
    blocked,
    interval_hours: interval / 3600,
    last_sent: lastSent || null,
    last_error: lastError || null,
    next_at: blocked ? null : next,
    due_now: !blocked && next <= t,
    cleanup_minutes: null,
    retention: "until_manual_deletion",
    history,
    checked_at: t
  };
}
__name(recurringStatus, "recurringStatus");
__name2(recurringStatus, "recurringStatus");
function validateWebsite(input) {
  const n = { url: String(input.url || "").trim(), message: String(input.message || "").trim(), enabled: input.enabled, timezone: String(input.timezone || ""), time: String(input.time || ""), repeat: input.repeat, weekday: Number(input.weekday) };
  let u;
  try {
    u = new URL(n.url);
  } catch {
    fail("Enter a valid HTTPS website address.");
  }
  if (u.protocol !== "https:" || u.username || u.password || n.url.length > 2048)
    fail("Use an HTTPS website address without a username or password.");
  if (!n.message || richLength(n.message) > 3500)
    fail("Enter a website message of 1\u20133,500 characters.");
  if (richLength(n.message) + n.url.length + 5 > 4096)
    fail("The message and website address together must fit within 4,096 characters.");
  if (typeof n.enabled !== "boolean" || !["daily", "weekly"].includes(n.repeat) || !Number.isInteger(n.weekday) || n.weekday < 0 || n.weekday > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(n.time))
    fail("Choose a valid repeat interval, day and time.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: n.timezone }).format();
  } catch {
    fail("Enter a valid timezone, such as America/New_York.");
  }
  return n;
}
__name(validateWebsite, "validateWebsite");
__name2(validateWebsite, "validateWebsite");
function nextWebsitePost(n, after) {
  if (!n.enabled)
    return null;
  const format = new Intl.DateTimeFormat("en-US", { timeZone: n.timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const start = Object.fromEntries(format.formatToParts(after * 1e3).map((p) => [p.type, p.value]));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let t = Math.floor(after / 60) * 60 + 60; t <= after + 9 * 86400; t += 60) {
    const parts = Object.fromEntries(format.formatToParts(t * 1e3).map((p) => [p.type, p.value]));
    if (parts.year === start.year && parts.month === start.month && parts.day === start.day && start.hour + ":" + start.minute >= n.time)
      continue;
    if (parts.hour + ":" + parts.minute === n.time && (n.repeat === "daily" || parts.weekday === days[n.weekday]))
      return t;
  }
  fail("Unable to calculate the next posting time.");
}
__name(nextWebsitePost, "nextWebsitePost");
__name2(nextWebsitePost, "nextWebsitePost");
async function websiteConfig(env) {
  const r = await q(env, "SELECT * FROM website_announcements WHERE id=1").first();
  if (!r)
    fail("Website announcement setup is not installed.", 503);
  return { ...JSON.parse(r.json), revision: r.revision, next_at: r.next_at };
}
__name(websiteConfig, "websiteConfig");
__name2(websiteConfig, "websiteConfig");
var websiteBody = /* @__PURE__ */ __name2((n) => richAppend(n.message, "\n\n\u{1F310} " + n.url), "websiteBody");
async function websiteAdmin(request, env, auth, helpers, s, path) {
  const { json: json2, safeJson: safeJson2 } = helpers, current = await websiteConfig(env);
  if (path === "/website" && request.method === "GET")
    return json2({ success: true, website: current, deliveries: await rows(env, "SELECT id,status,due_at,error FROM bot_jobs WHERE kind IN ('website','website_manual') ORDER BY id DESC LIMIT 10") });
  if (path === "/website" && request.method === "PUT") {
    const b = await safeJson2(request), n = validateWebsite(b);
    if (b.revision !== current.revision)
      fail("Website settings changed. Refresh and try again.", 409);
    if (n.enabled && (!s.enabled || !s.group_id))
      fail("Connect and enable Mr Charm before enabling scheduled announcements.");
    const next = nextWebsitePost(n, now());
    const r = await q(env, "UPDATE website_announcements SET json=?1,revision=revision+1,next_at=?2 WHERE id=1 AND revision=?3", JSON.stringify(n), next, current.revision).run();
    if (!r.meta.changes)
      fail("Website settings changed. Refresh and try again.", 409);
    await q(env, "UPDATE bot_jobs SET status='canceled' WHERE kind='website' AND status='pending'").run();
    await event(env, null, "website_settings_saved", n.enabled ? "scheduled" : "disabled", auth.user.id);
    return json2({ success: true, website: await websiteConfig(env) });
  }
  if (path === "/website/send" && request.method === "POST") {
    const b = await safeJson2(request);
    if (b.confirm !== true || b.revision !== current.revision)
      fail("Preview the saved message and confirm before sending.", 409);
    if (!s.enabled || !s.group_id)
      fail("Connect and enable Mr Charm first.");
    if (!/^[a-f0-9-]{36}$/i.test(b.request_id || ""))
      fail("Refresh the panel before sending.");
    const duplicate = await q(env, "SELECT id FROM bot_jobs WHERE dedupe_key=?1", "website:manual:" + b.request_id).first();
    if (duplicate)
      return json2({ success: true, queued: true });
    const recent = await q(env, "SELECT id FROM bot_jobs WHERE kind='website_manual' AND due_at>?1 AND status IN ('pending','sending','sent')", now() - 60).first();
    if (recent)
      fail("A website announcement was just queued or sent. Wait one minute before sending another.", 429);
    await q(env, "INSERT OR IGNORE INTO bot_jobs(kind,chat_id,body,due_at,dedupe_key) VALUES('website_manual',?1,?2,?3,?4)", s.group_id, websiteBody(current), now(), "website:manual:" + b.request_id).run();
    await event(env, null, "website_announcement_queued", "", auth.user.id);
    return json2({ success: true, queued: true });
  }
  return json2({ success: false, error: "Unknown website action." }, 404);
}
__name(websiteAdmin, "websiteAdmin");
__name2(websiteAdmin, "websiteAdmin");
async function queueWebsitePost(env, s) {
  const n = await websiteConfig(env), t = now();
  if (!n.enabled || !s.enabled || !s.group_id || !n.next_at || n.next_at > t)
    return;
  const slot = n.next_at, next = nextWebsitePost(n, t + 60);
  await env.DB.batch([
    q(env, "INSERT OR IGNORE INTO bot_jobs(kind,chat_id,body,due_at,dedupe_key) SELECT 'website',?1,?2,?3,?4 FROM website_announcements WHERE id=1 AND revision=?5 AND next_at=?6", s.group_id, websiteBody(n), t, "website:" + n.revision + ":" + slot, n.revision, slot),
    q(env, "UPDATE website_announcements SET next_at=?1 WHERE id=1 AND revision=?2 AND next_at=?3", next, n.revision, slot)
  ]);
}
__name(queueWebsitePost, "queueWebsitePost");
__name2(queueWebsitePost, "queueWebsitePost");
var get = /* @__PURE__ */ __name2((env, id) => q(env, "SELECT * FROM bot_group_invites WHERE id=?1", id).first(), "get");
var identity = /* @__PURE__ */ __name2((value) => {
  const id = String(value ?? "").trim();
  if (!/^[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))
    fail("Enter a valid numeric Telegram user ID.");
  return id;
}, "identity");
async function eligible(env, id) {
  const m = await q(env, `SELECT m.blocked,u.status,u.expires_at FROM bot_members m LEFT JOIN users u ON u.id=m.account_id WHERE m.telegram_id=?1`, id).first();
  return !m || !m.blocked && (!m.status || m.status === "active" && (m.expires_at === null || m.expires_at > now()));
}
__name(eligible, "eligible");
__name2(eligible, "eligible");
async function lock(env, id) {
  const token = crypto.randomUUID();
  const r = await q(env, "UPDATE bot_group_invites SET lease_token=?1,lease_until=?2 WHERE id=?3 AND lease_until<=?4", token, now() + 90, id, now()).run();
  if (!r.meta.changes)
    fail("This invite is being processed. Refresh and retry shortly.", 409);
  return token;
}
__name(lock, "lock");
__name2(lock, "lock");
var unlock = /* @__PURE__ */ __name2((env, id, token) => q(env, "UPDATE bot_group_invites SET lease_token=NULL,lease_until=0 WHERE id=?1 AND lease_token=?2", id, token).run(), "unlock");
async function alertAdmins(env, s, invite, requester) {
  const configured = await rows(env, "SELECT telegram_id FROM bot_support_admins WHERE enabled=1");
  let administrators = [];
  try {
    administrators = await telegram(env, "getChatAdministrators", { chat_id: s.group_id });
  } catch {
    await event(env, null, "group_invite_alert_lookup_failed", invite.id);
    return;
  }
  const permitted = administrators.filter((a) => !a.user.is_bot && (!configured.length || configured.some((p) => p.telegram_id === String(a.user.id))));
  const started = await rows(env, `SELECT telegram_id FROM bot_members WHERE dm_started=1 AND telegram_id IN (${permitted.map(() => "?").join(",") || "''"})`, ...permitted.map((a) => String(a.user.id)));
  const text = "Charming MediaLab invite request waiting for approval\n\nRecipient: " + invite.recipient_label + "\nRequester: " + requester.telegram_id + (requester.username ? " (@" + requester.username + ")" : "") + "\n\nOpen Mr. Charm \u2192 Group Invites in the panel to verify and approve or revoke it.";
  for (const admin of started) {
    try {
      await telegram(env, "sendMessage", { chat_id: Number(admin.telegram_id), text });
      await event(env, requester.telegram_id, "group_invite_admin_alerted", invite.id, admin.telegram_id);
    } catch {
      await event(env, requester.telegram_id, "group_invite_admin_alert_failed", invite.id, admin.telegram_id);
    }
  }
}
__name(alertAdmins, "alertAdmins");
__name2(alertAdmins, "alertAdmins");
async function revokeLink(env, invite) {
  if (!invite.invite_link)
    return;
  try {
    if (!invite.revoked_at) {
      await telegram(env, "revokeChatInviteLink", { chat_id: invite.group_id, invite_link: invite.invite_link });
      await q(env, "UPDATE bot_group_invites SET revoked_at=?1,last_error=NULL WHERE id=?2", now(), invite.id).run();
    }
    const waiting = await rows(env, "SELECT DISTINCT telegram_id FROM bot_group_invite_attempts WHERE invite_id=?1 AND outcome IN ('waiting','received','approving')", invite.id);
    for (const requester of waiting) {
      await telegram(env, "declineChatJoinRequest", { chat_id: invite.group_id, user_id: Number(requester.telegram_id) });
      await q(env, "UPDATE bot_group_invite_attempts SET outcome='denied',processed_at=?1 WHERE invite_id=?2 AND telegram_id=?3 AND outcome IN ('waiting','received','approving')", now(), invite.id, requester.telegram_id).run();
    }
    await q(env, "UPDATE bot_group_invites SET last_error=NULL WHERE id=?1", invite.id).run();
  } catch (e) {
    await q(env, "UPDATE bot_group_invites SET last_error=?1 WHERE id=?2", "Link revocation or pending-request rejection needs retry. Check bot Invite Users permission.", invite.id).run();
    throw e;
  }
}
__name(revokeLink, "revokeLink");
__name2(revokeLink, "revokeLink");
async function createGroupInvite(env, s, body, admin, requestKey = null) {
  if (!s.enabled || !s.group_id)
    fail("Enable and connect the bot before creating group invites.");
  if (body.approved !== true)
    fail("Approve the recipient before creating their group invite.");
  const tid = body.telegram_id === void 0 || body.telegram_id === null || String(body.telegram_id).trim() === "" ? null : identity(body.telegram_id), username = String(body.username || "").trim().replace(/^@/, "");
  const label = String(body.recipient_label || "New member").trim();
  if (!label || label.length > 100)
    fail("Use a recipient label of 1\u2013100 characters.");
  if (username && !/^[a-zA-Z0-9_]{1,32}$/.test(username))
    fail("Enter a Telegram username without spaces, or leave it blank.");
  const expires = body.expires_at ?? null;
  if (expires !== null && (!Number.isSafeInteger(expires) || expires < now() + 60 || expires > now() + 365 * 86400))
    fail("Expiration must be at least one minute and no more than one year from now.");
  if (tid && !await eligible(env, tid))
    fail("This member is blocked or their linked app account is inactive.", 409);
  if (requestKey) {
    const existing = await q(env, "SELECT * FROM bot_group_invites WHERE request_key=?1", requestKey).first();
    if (existing) {
      if (existing.invite_link)
        return existing;
      fail("This command already started creating an invite. Check Group Invites before requesting another.", 409);
    }
  }
  const id = crypto.randomUUID(), token = crypto.randomUUID();
  const inserted = await q(env, `INSERT OR IGNORE INTO bot_group_invites(id,group_id,telegram_id,username,created_by,created_at,expires_at,status,lease_token,lease_until,approval_mode,recipient_label,request_key) VALUES(?1,?2,?3,?4,?5,?6,?7,'creating',?8,?9,'manual',?10,?11)`, id, s.group_id, tid, username, admin, now(), expires, token, now() + 90, label, requestKey).run();
  if (!inserted.meta.changes)
    fail("This user already has an active or processing invite. View or revoke it before creating another.", 409);
  try {
    const link = await telegram(env, "createChatInviteLink", { chat_id: s.group_id, name: "charm:" + id.slice(0, 26), creates_join_request: true, ...expires === null ? {} : { expire_date: expires } });
    if (!link.invite_link || !link.creates_join_request)
      throw new Error("Telegram did not return a join-request link.");
    await q(env, "UPDATE bot_group_invites SET invite_link=?1,status='active' WHERE id=?2", link.invite_link, id).run();
    await event(env, tid, "group_invite_created", id, admin);
    return await get(env, id);
  } catch (e) {
    await q(env, "UPDATE bot_group_invites SET status=CASE WHEN invite_link IS NULL THEN 'failed' ELSE status END,last_error='Creation interrupted. Refresh before retrying.' WHERE id=?1", id).run();
    throw e;
  } finally {
    await unlock(env, id, token);
  }
}
__name(createGroupInvite, "createGroupInvite");
__name2(createGroupInvite, "createGroupInvite");
async function revokeGroupInvite(env, id, admin) {
  if (!await get(env, id))
    fail("Invite not found.", 404);
  const token = await lock(env, id);
  try {
    const invite = await get(env, id);
    if (!invite)
      fail("Invite not found.", 404);
    if (invite.status === "creating")
      fail("Creation is still processing. Refresh shortly.", 409);
    if (invite.status === "approving") {
      const live = await telegram(env, "getChatMember", { chat_id: invite.group_id, user_id: Number(invite.telegram_id) });
      if (isMember(live)) {
        try {
          await finishAdmission(env, invite);
        } catch {
        }
        return await get(env, id);
      }
    }
    await q(env, "UPDATE bot_group_invites SET status=CASE WHEN status IN ('used','expired','failed') THEN status ELSE 'revoked' END WHERE id=?1", id).run();
    await event(env, invite.telegram_id, "group_invite_revoked", id, admin);
    try {
      await revokeLink(env, await get(env, id));
    } catch {
    }
    return await get(env, id);
  } finally {
    await unlock(env, id, token);
  }
}
__name(revokeGroupInvite, "revokeGroupInvite");
__name2(revokeGroupInvite, "revokeGroupInvite");
async function finishAdmission(env, invite) {
  await q(env, "UPDATE bot_group_invites SET status='used',used_at=COALESCE(used_at,?1),used_by=telegram_id,last_error=NULL WHERE id=?2", now(), invite.id).run();
  await q(env, "UPDATE bot_group_invite_attempts SET outcome='approved',processed_at=?1 WHERE invite_id=?2 AND telegram_id=?3 AND outcome='approving'", now(), invite.id, invite.telegram_id).run();
  await revokeLink(env, await get(env, invite.id));
}
__name(finishAdmission, "finishAdmission");
__name2(finishAdmission, "finishAdmission");
async function resumeAdmission(env, invite, allowApproval = true) {
  const live = await telegram(env, "getChatMember", { chat_id: invite.group_id, user_id: Number(invite.telegram_id) });
  if (isMember(live)) {
    await finishAdmission(env, invite);
    return;
  }
  if (!await eligible(env, invite.telegram_id) || invite.expires_at !== null && invite.expires_at <= now()) {
    await q(env, "UPDATE bot_group_invites SET status=?1 WHERE id=?2", invite.expires_at !== null && invite.expires_at <= now() ? "expired" : "revoked", invite.id).run();
    await telegram(env, "declineChatJoinRequest", { chat_id: invite.group_id, user_id: Number(invite.telegram_id) });
    await q(env, "UPDATE bot_group_invite_attempts SET outcome='denied',processed_at=?1 WHERE invite_id=?2 AND outcome='approving'", now(), invite.id).run();
    await revokeLink(env, await get(env, invite.id));
    return;
  }
  if (!allowApproval)
    return;
  await telegram(env, "approveChatJoinRequest", { chat_id: invite.group_id, user_id: Number(invite.telegram_id) });
  await finishAdmission(env, invite);
}
__name(resumeAdmission, "resumeAdmission");
__name2(resumeAdmission, "resumeAdmission");
async function handleGroupJoinRequest(env, u, s) {
  const j = u.chat_join_request, link = j.invite_link?.invite_link;
  const invite = link ? await q(env, "SELECT * FROM bot_group_invites WHERE group_id=?1 AND invite_link=?2", s.group_id, link).first() : null;
  if (!invite) {
    if (j.invite_link?.name?.startsWith("charm:")) {
      await telegram(env, "declineChatJoinRequest", { chat_id: s.group_id, user_id: j.from.id });
      return true;
    }
    return false;
  }
  const tid = String(j.from.id), uid = u.update_id;
  if (!Number.isSafeInteger(uid))
    fail("Missing Telegram update ID.");
  await q(env, `INSERT OR IGNORE INTO bot_group_invite_attempts(invite_id,update_id,telegram_id,username,requested_at,outcome) VALUES(?1,?2,?3,?4,?5,'received')`, invite.id, uid, tid, j.from.username || "", j.date).run();
  const attempt = await q(env, "SELECT * FROM bot_group_invite_attempts WHERE invite_id=?1 AND update_id=?2", invite.id, uid).first();
  if (["approved", "denied"].includes(attempt.outcome))
    return true;
  const token = await lock(env, invite.id);
  try {
    const current = await get(env, invite.id);
    if (tid === current.telegram_id && current.status === "approving") {
      await resumeAdmission(env, current);
      return true;
    }
    const allowed = (!current.telegram_id || tid === current.telegram_id) && ["active", "pending"].includes(current.status) && (current.expires_at === null || current.expires_at > now()) && await eligible(env, tid);
    if (!allowed) {
      await telegram(env, "declineChatJoinRequest", { chat_id: s.group_id, user_id: j.from.id });
      await q(env, "UPDATE bot_group_invite_attempts SET outcome='denied',processed_at=?1 WHERE id=?2", now(), attempt.id).run();
      await event(env, tid, "group_invite_denied", invite.id);
      return true;
    }
    await env.DB.batch([
      q(env, "UPDATE bot_group_invites SET status='pending',request_at=COALESCE(request_at,?1) WHERE id=?2", j.date, invite.id),
      q(env, "UPDATE bot_group_invite_attempts SET outcome='waiting',processed_at=?1 WHERE id=?2", now(), attempt.id)
    ]);
    await event(env, tid, "group_invite_awaiting_admin", invite.id);
    await alertAdmins(env, s, current, { telegram_id: tid, username: j.from.username || "" });
    return false;
  } finally {
    await unlock(env, invite.id, token);
  }
}
__name(handleGroupJoinRequest, "handleGroupJoinRequest");
__name2(handleGroupJoinRequest, "handleGroupJoinRequest");
async function approveGroupInvite(env, s, id, admin, recipient) {
  if (!s.enabled)
    fail("Enable the bot before approving a group invite.");
  if (!await get(env, id))
    fail("Invite not found.", 404);
  const token = await lock(env, id);
  try {
    const invite = await get(env, id);
    if (invite.group_id !== s.group_id || !["pending", "approving"].includes(invite.status))
      fail("This invite has no pending join request.", 409);
    const tid = identity(recipient || invite.telegram_id);
    if (invite.telegram_id && invite.telegram_id !== tid)
      fail("This link belongs to a different Telegram user.", 409);
    const attempt = await q(env, "SELECT * FROM bot_group_invite_attempts WHERE invite_id=?1 AND telegram_id=?2 AND outcome IN ('waiting','approving') ORDER BY id DESC LIMIT 1", id, tid).first();
    if (!attempt)
      fail("Select a recorded pending requester for this link.", 409);
    if (invite.expires_at !== null && invite.expires_at <= now() || !await eligible(env, tid))
      fail("This invite has expired or the recipient is blocked.", 409);
    await env.DB.batch([
      q(env, "UPDATE bot_group_invites SET status='approving',telegram_id=?2,used_username=?3,request_at=?4 WHERE id=?1", id, tid, attempt.username, attempt.requested_at),
      q(env, "UPDATE bot_group_invite_attempts SET outcome='approving' WHERE invite_id=?1 AND telegram_id=?2 AND outcome='waiting'", id, tid)
    ]);
    await event(env, tid, "group_invite_admin_approved", id, admin);
    await resumeAdmission(env, await get(env, id));
    return await get(env, id);
  } finally {
    await unlock(env, id, token);
  }
}
__name(approveGroupInvite, "approveGroupInvite");
__name2(approveGroupInvite, "approveGroupInvite");
async function recordGroupAdmission(env, j) {
  if (!isMember(j.new_chat_member) || isMember(j.old_chat_member))
    return;
  const tid = String(j.new_chat_member.user.id);
  let matched = await rows(env, `SELECT * FROM bot_group_invites WHERE group_id=?1 AND ((invite_link=?3 AND (telegram_id IS NULL OR telegram_id=?2)) OR (telegram_id=?2 AND status IN ('approving','used') AND request_at<=?4 AND joined_at IS NULL))`, String(j.chat.id), tid, j.invite_link?.invite_link || "", j.date);
  if (!matched.length && !j.invite_link && j.via_join_request) {
    const candidates = await rows(env, `SELECT DISTINCT i.* FROM bot_group_invites i JOIN bot_group_invite_attempts a ON a.invite_id=i.id WHERE i.group_id=?1 AND i.status='pending' AND a.telegram_id=?2 AND a.outcome='waiting' AND a.requested_at<=?3`, String(j.chat.id), tid, j.date);
    if (candidates.length === 1)
      matched = candidates;
    else if (candidates.length > 1)
      await event(env, tid, "group_invite_join_ambiguous", "Telegram omitted the invite link; review pending invites.");
  }
  for (const invite of matched) {
    await env.DB.batch([
      q(env, `UPDATE bot_group_invites SET telegram_id=?2,username=?3,joined_at=COALESCE(joined_at,?1),used_at=COALESCE(used_at,?1),used_by=?2,used_username=?3,status='used' WHERE id=?4`, j.date, tid, j.new_chat_member.user.username || "", invite.id),
      q(env, "UPDATE bot_group_invite_attempts SET outcome='approved',processed_at=?1 WHERE invite_id=?2 AND telegram_id=?3 AND outcome IN ('waiting','approving')", now(), invite.id, tid)
    ]);
    await revokeLink(env, await get(env, invite.id));
  }
}
__name(recordGroupAdmission, "recordGroupAdmission");
__name2(recordGroupAdmission, "recordGroupAdmission");
async function maintainGroupInvites(env, allowApproval = true) {
  await q(env, "UPDATE bot_group_invites SET status='expired' WHERE status IN ('active','pending') AND expires_at<=?1 AND lease_until<=?1", now()).run();
  await q(env, "UPDATE bot_group_invites SET status='failed',last_error='Creation interrupted; no link was delivered.' WHERE status='creating' AND lease_until<=?1", now()).run();
  const pending = await rows(env, `SELECT * FROM bot_group_invites WHERE lease_until<=?1 AND (status='approving' OR (status IN ('used','revoked','expired') AND invite_link IS NOT NULL AND revoked_at IS NULL))
  UNION SELECT i.* FROM bot_group_invite_attempts a JOIN bot_group_invites i ON i.id=a.invite_id
  WHERE a.outcome IN ('waiting','received','approving') AND i.lease_until<=?1 AND i.status IN ('used','revoked','expired') AND i.invite_link IS NOT NULL
  ORDER BY last_attempt_at,created_at LIMIT 30`, now());
  for (const invite of pending) {
    let token;
    try {
      token = await lock(env, invite.id);
      await q(env, "UPDATE bot_group_invites SET last_attempt_at=?1 WHERE id=?2", now(), invite.id).run();
      const current = await get(env, invite.id);
      if (current.status === "approving")
        await resumeAdmission(env, current, allowApproval);
      else
        await revokeLink(env, current);
    } catch {
      await q(env, "UPDATE bot_group_invites SET last_error='Telegram action pending. Check connection and Invite Users permission; automatic retry scheduled.' WHERE id=?1", invite.id).run();
    } finally {
      if (token)
        await unlock(env, invite.id, token);
    }
  }
}
__name(maintainGroupInvites, "maintainGroupInvites");
__name2(maintainGroupInvites, "maintainGroupInvites");
var RESPONSE_LIFETIME_SECONDS = 600;
var SEND_METHODS = /* @__PURE__ */ new Set(["sendMessage", "editMessageText", "sendRichMessage", "sendPhoto", "sendDocument", "sendVideo", "sendAudio", "sendAnimation", "sendVoice"]);
async function permanentAdminAnnouncement(env, chatId, messageId) {
  if (!String(chatId).startsWith("-"))
    return false;
  if (await currentRecurring(env, chatId, messageId))
    return true;
  return !!await q(env, "SELECT 1 AS protected FROM bot_jobs WHERE kind='broadcast' AND chat_id=?1 AND message_id=?2 LIMIT 1", String(chatId), Number(messageId)).first();
}
__name(permanentAdminAnnouncement, "permanentAdminAnnouncement");
__name2(permanentAdminAnnouncement, "permanentAdminAnnouncement");
function telegramFailure(e) {
  const code = e.telegramCode, description = String(e.description || "").toLowerCase();
  const reason = code === 429 ? "rate limited" : code === 401 ? "bot credential rejected" : code === 403 ? "bot blocked or access denied" : /not enough rights|administrator|chat_admin_required/.test(description) ? "bot permission missing" : /user not found|participant|member/.test(description) ? "recipient unavailable" : /parse|entity|format/.test(description) ? "message formatting rejected" : /chat not found/.test(description) ? "chat unavailable" : code >= 500 ? "Telegram service error" : /timeout|abort/i.test(e.name || "") ? "request timed out" : code ? "request rejected" : "network or delivery error";
  return (e.telegramMethod ? e.telegramMethod + " \xB7 " : "") + (code ? "Telegram " + code + " \xB7 " : "") + reason;
}
__name(telegramFailure, "telegramFailure");
__name2(telegramFailure, "telegramFailure");
async function telegramTransport(env, method, body) {
  if (!env.TELEGRAM_BOT_TOKEN)
    throw Object.assign(new Error("Save TELEGRAM_BOT_TOKEN in Cloudflare first."), { status: 503 });
  const response = await (env.TELEGRAM_FETCH || fetch)("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15e3)
  });
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw Object.assign(new Error("Telegram could not complete " + method + " (" + (data.error_code || response.status) + ")."), {
      status: 502,
      telegramCode: data.error_code,
      telegramMethod: method,
      description: data.description || "",
      retryAfter: data.parameters?.retry_after
    });
  return data.result;
}
__name(telegramTransport, "telegramTransport");
__name2(telegramTransport, "telegramTransport");
async function removeResponse(env, row) {
  if (row.attempts > 0 && row.due_at > now())
    return;
  if (!row.ephemeral && await permanentAdminAnnouncement(env, row.chat_id, row.message_id)) {
    await q(env, "DELETE FROM bot_responses WHERE response_key=?1 AND generation=?2", row.response_key, row.generation).run();
    return;
  }
  const claimed = await q(env, "UPDATE bot_responses SET lease_until=?1 WHERE response_key=?2 AND generation=?3 AND lease_until<=?4", now() + 30, row.response_key, row.generation, now()).run();
  if (!claimed.meta.changes)
    return;
  try {
    await telegramTransport(env, row.ephemeral ? "deleteEphemeralMessage" : "deleteMessage", {
      chat_id: row.chat_id,
      ...row.ephemeral ? { receiver_user_id: Number(row.recipient_id), ephemeral_message_id: row.message_id } : { message_id: row.message_id }
    });
    await q(env, "DELETE FROM bot_responses WHERE response_key=?1 AND generation=?2", row.response_key, row.generation).run();
  } catch (e) {
    if (e.telegramCode === 400 && /not found|already deleted|message_id_invalid|message identifier is not specified/i.test(e.description)) {
      await q(env, "DELETE FROM bot_responses WHERE response_key=?1 AND generation=?2", row.response_key, row.generation).run();
      return;
    }
    const delay = Math.max(30, Math.min(3600, Number(e.retryAfter) || 30 * 2 ** Math.min(row.attempts, 6)));
    await q(env, "UPDATE bot_responses SET attempts=attempts+1,due_at=?1,lease_until=0 WHERE response_key=?2 AND generation=?3", now() + delay, row.response_key, row.generation).run();
    await event(env, row.recipient_id, "response_cleanup_retry", telegramFailure(e));
  }
}
__name(removeResponse, "removeResponse");
__name2(removeResponse, "removeResponse");
async function rememberResponse(env, method, body, result) {
  if (env.BOT_JOIN_DELIVERY || env.BOT_PERSISTENT_ANNOUNCEMENT)
    return;
  if (!SEND_METHODS.has(method))
    return;
  const ephemeral = Number.isSafeInteger(result?.ephemeral_message_id);
  const messageId = ephemeral ? result.ephemeral_message_id : result?.message_id;
  if (!Number.isSafeInteger(messageId) || messageId <= 0)
    return;
  if (!ephemeral && env.BOT_RECURRING?.chatId === String(body.chat_id)) {
    env.BOT_RECURRING.ids.push(messageId);
    return;
  }
  const recipient = String(body.ephemeral_message_parameters?.receiver_user_id || body.chat_id);
  const interaction = env.BOT_INTERACTION;
  const generation = interaction?.recipient === recipient ? interaction.generation : crypto.randomUUID();
  const chatId = String(body.chat_id), key = [chatId, recipient, ephemeral ? "e" : "m", messageId].join(":");
  await q(env, `INSERT INTO bot_responses(response_key,recipient_id,generation,chat_id,message_id,ephemeral,created_at,due_at)
  VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(response_key) DO UPDATE SET generation=excluded.generation,
  created_at=excluded.created_at,due_at=excluded.due_at,attempts=0,lease_until=0`, key, recipient, generation, chatId, messageId, ephemeral ? 1 : 0, now(), !ephemeral && !chatId.startsWith("-") ? 0 : now() + RESPONSE_LIFETIME_SECONDS).run();
  if (ephemeral || !chatId.startsWith("-"))
    for (const previous of await rows(env, "SELECT * FROM bot_responses WHERE recipient_id=?1 AND generation<>?2 AND chat_id=?3 ORDER BY created_at LIMIT 40", recipient, generation, chatId))
      await removeResponse(env, previous);
}
__name(rememberResponse, "rememberResponse");
__name2(rememberResponse, "rememberResponse");
async function cleanExpiredResponses(env) {
  for (const row of await rows(env, "SELECT * FROM bot_responses WHERE chat_id GLOB '-*' AND due_at<=?1 AND lease_until<=?1 ORDER BY due_at LIMIT 80", now()))
    await removeResponse(env, row);
  const expired = await rows(env, "SELECT DISTINCT recipient_id FROM bot_responses WHERE chat_id GLOB '-*' AND created_at<?1", now() - 47 * 3600);
  for (const row of expired)
    await event(env, row.recipient_id, "response_cleanup_expired", "Telegram deletion window exceeded");
  await q(env, "DELETE FROM bot_responses WHERE chat_id GLOB '-*' AND created_at<?1", now() - 47 * 3600).run();
}
__name(cleanExpiredResponses, "cleanExpiredResponses");
__name2(cleanExpiredResponses, "cleanExpiredResponses");
var failure = telegramFailure;
async function queueJoinReport(env, s, user, joinedAt, outcome, send2, telegram2) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unknown name";
  const joined = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" }).format(new Date(joinedAt * 1e3));
  const report2 = "New member delivery report\n\nMember: " + name + (user.username ? " (@" + user.username + ")" : "") + "\nTelegram ID: " + user.id + "\nJoined: " + joined + "\nToken assigned: " + outcome.token + "\nWelcome delivered: " + outcome.welcome + "\nAccount setup and registration directions delivered: " + outcome.setup + "\nAccount-linking directions included: " + outcome.setup + "\n\nToken values and passwords are omitted.";
  const payload = { userId: String(user.id), joinKey: String(user.id) + ":" + joinedAt, report: report2, created: now(), attempts: 0 };
  const r = await q(env, "INSERT INTO bot_jobs(kind,chat_id,body,due_at) SELECT 'join_report_discovery',?1,?2,?3 WHERE NOT EXISTS(SELECT 1 FROM bot_jobs WHERE kind='join_report_discovery' AND chat_id=?1 AND json_extract(body,'$.joinKey')=?4)", s.group_id, JSON.stringify(payload), now(), payload.joinKey).run();
  if (!r.meta.changes)
    return;
  await deliverJoinReport(env, { id: r.meta.last_row_id, kind: "join_report_discovery", chat_id: s.group_id, body: JSON.stringify(payload) }, send2, telegram2);
}
__name(queueJoinReport, "queueJoinReport");
__name2(queueJoinReport, "queueJoinReport");
async function deliverJoinReport(env, job, send2, telegram2) {
  const claim = await q(env, "UPDATE bot_jobs SET status='sending',due_at=?1 WHERE id=?2 AND status='pending'", now(), job.id).run();
  if (!claim.meta.changes)
    return;
  const data = JSON.parse(job.body);
  try {
    if (job.kind === "join_report_discovery") {
      const admins = await telegram2(env, "getChatAdministrators", { chat_id: job.chat_id });
      if (!Array.isArray(admins))
        throw new Error("Invalid administrator list");
      const humans = admins.filter((a) => a.user?.id && !a.user.is_bot);
      if (!humans.length)
        throw new Error("No human administrators returned");
      const children = humans.map((a) => q(env, "INSERT INTO bot_jobs(kind,chat_id,body,due_at) VALUES('join_report',?1,?2,?3)", job.chat_id, JSON.stringify({ ...data, recipient: String(a.user.id) }), now()));
      children.push(q(env, "UPDATE bot_jobs SET status='sent',error='' WHERE id=?1", job.id));
      await env.DB.batch(children);
      for (const child of await rows(env, "SELECT * FROM bot_jobs WHERE kind='join_report' AND status='pending' AND due_at<=?1 ORDER BY id LIMIT 20", now()))
        await deliverJoinReport(env, child, send2, telegram2);
      return;
    }
    const live = await telegram2(env, "getChatMember", { chat_id: job.chat_id, user_id: Number(data.recipient) });
    if (!["administrator", "creator"].includes(live.status) || live.user?.is_bot) {
      await q(env, "UPDATE bot_jobs SET status='canceled',error='Recipient is no longer a human administrator.' WHERE id=?1", job.id).run();
      return;
    }
    const privateEnv = { ...env, BOT_PUBLIC_HUMOR: false, BOT_JOIN_DELIVERY: true };
    await send2(privateEnv, data.recipient, data.report);
    await q(env, "UPDATE bot_jobs SET status='sent',error='' WHERE id=?1", job.id).run();
    await event(env, data.userId, "new_member_delivery_report", "Delivered to admin " + data.recipient);
  } catch (e) {
    data.attempts++;
    const exhausted = data.attempts >= 10 || now() - data.created >= 86400;
    const delay = Math.max(60, Math.min(3600, Number(e.retryAfter) || 60 * 2 ** Math.min(data.attempts, 6)));
    await q(env, "UPDATE bot_jobs SET status=?1,body=?2,due_at=?3,error=?4 WHERE id=?5", exhausted ? "failed" : "pending", JSON.stringify(data), now() + delay, failure(e), job.id).run();
    await event(env, data.userId, "new_member_admin_report_failed", (data.recipient ? "Admin " + data.recipient + ": " : "Administrator lookup: ") + failure(e) + (exhausted ? "; retries exhausted" : "; retry queued"));
  }
}
__name(deliverJoinReport, "deliverJoinReport");
__name2(deliverJoinReport, "deliverJoinReport");
var activate = /* @__PURE__ */ __name2((s) => ({ inline_keyboard: [[{ text: "Open Mr Charm privately", url: "https://t.me/" + s.bot_username + "?start=help" }]] }), "activate");
async function handleAutomaticJoinRequest(env, u, s) {
  const j = u.chat_join_request, tid = String(j.from.id), gid = String(j.chat.id);
  if (gid !== s.group_id || j.from.is_bot)
    return;
  if (!Number.isSafeInteger(j.user_chat_id) || !Number.isSafeInteger(j.date)) {
    await event(env, tid, "join_request_invalid", "Missing temporary private chat ID or request date");
    return;
  }
  await q(env, `INSERT OR IGNORE INTO bot_join_requests(group_id,telegram_id,update_id,requested_at,user_chat_id,invite_link)
    VALUES(?1,?2,?3,?4,?5,?6)`, gid, tid, u.update_id, j.date, String(j.user_chat_id), j.invite_link?.invite_link || null).run();
  const lease = crypto.randomUUID();
  const claimed = await q(env, "UPDATE bot_join_requests SET lease_token=?1,lease_until=?2 WHERE group_id=?3 AND telegram_id=?4 AND lease_until<=?5", lease, now() + 180, gid, tid, now()).run();
  if (!claimed.meta.changes)
    fail("Join request is already processing", 503);
  let invite = null, inviteLease = null, stage = "prepare";
  const read = /* @__PURE__ */ __name2(() => q(env, "SELECT * FROM bot_join_requests WHERE group_id=?1 AND telegram_id=?2", gid, tid).first(), "read");
  const save2 = /* @__PURE__ */ __name2(async (sql, ...values) => {
    const result = await q(env, sql, ...values).run();
    if (!result.meta.changes)
      fail("Join request lease changed", 503);
  }, "save");
  try {
    let progress = await read();
    if (u.update_id !== progress.update_id) {
      if (j.date < progress.requested_at || u.update_id < progress.update_id)
        return;
      await save2(`UPDATE bot_join_requests SET update_id=?1,requested_at=?2,user_chat_id=?3,invite_link=?4,
        group_invite_id=NULL,token_id=NULL,waiting_sent=0,welcome_sent=0,token_sent=0,approved_at=NULL,state='pending',last_error=NULL
        WHERE group_id=?5 AND telegram_id=?6 AND lease_token=?7`, u.update_id, j.date, String(j.user_chat_id), j.invite_link?.invite_link || null, gid, tid, lease);
      progress = await read();
    }
    if (progress.approved_at || progress.state === "denied")
      return;
    invite = j.invite_link?.invite_link ? await q(env, "SELECT * FROM bot_group_invites WHERE group_id=?1 AND invite_link=?2", gid, j.invite_link.invite_link).first() : null;
    if (invite) {
      inviteLease = await lock(env, invite.id);
      await q(env, "UPDATE bot_group_invites SET lease_until=?1 WHERE id=?2 AND lease_token=?3", now() + 180, invite.id, inviteLease).run();
      invite = await get(env, invite.id);
      await q(env, `INSERT OR IGNORE INTO bot_group_invite_attempts(invite_id,update_id,telegram_id,username,requested_at,outcome)
        VALUES(?1,?2,?3,?4,?5,'received')`, invite.id, u.update_id, tid, j.from.username || "", j.date).run();
      await save2("UPDATE bot_join_requests SET group_invite_id=?1 WHERE group_id=?2 AND telegram_id=?3 AND lease_token=?4", invite.id, gid, tid, lease);
    }
    if (progress.state === "approving" && progress.waiting_sent && progress.welcome_sent && progress.token_sent) {
      const live = await telegram(env, "getChatMember", { chat_id: gid, user_id: j.from.id });
      if (isMember(live)) {
        await completeAutomaticJoin(env, j, u.update_id, lease, invite, live.status);
        return;
      }
    }
    const invalidLink = !invite && j.invite_link?.name?.startsWith("charm:");
    const invalidInvite = invite && (invite.telegram_id && invite.telegram_id !== tid || !["active", "pending", "approving"].includes(invite.status) || invite.status === "approving" && invite.telegram_id !== tid || invite.expires_at !== null && invite.expires_at <= now());
    if (invalidLink || invalidInvite || !await eligible(env, tid)) {
      stage = "deny";
      await telegram(env, "declineChatJoinRequest", { chat_id: gid, user_id: j.from.id });
      await save2("UPDATE bot_join_requests SET state='denied',last_error='Blocked user or invalid invitation' WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease);
      if (invite)
        await q(env, "UPDATE bot_group_invite_attempts SET outcome='denied',processed_at=?1 WHERE invite_id=?2 AND update_id=?3", now(), invite.id, u.update_id).run();
      await event(env, tid, "join_request_denied", "Blocked user or invalid invitation");
      return;
    }
    await member(env, j.from, "pending");
    await q(env, "UPDATE bot_members SET requested_at=?1 WHERE telegram_id=?2", j.date, tid).run();
    if (invite && invite.status !== "approving") {
      await q(env, "UPDATE bot_group_invites SET status='pending',request_at=COALESCE(request_at,?1) WHERE id=?2", j.date, invite.id).run();
      await q(env, "UPDATE bot_group_invite_attempts SET outcome='waiting' WHERE invite_id=?1 AND update_id=?2", invite.id, u.update_id).run();
    }
    const privateEnv = {
      ...env,
      BOT_JOIN_DELIVERY: true,
      BOT_GROUP_REPLY: void 0,
      BOT_CALLBACK_MESSAGE: null,
      BOT_INTERACTION: { recipient: String(j.user_chat_id), generation: "join:" + u.update_id }
    };
    const checkWindow = /* @__PURE__ */ __name2(() => {
      if (now() >= j.date + 300)
        fail("Temporary private messaging window expired; a fresh join request is needed", 409);
    }, "checkWindow");
    if (!progress.waiting_sent) {
      stage = "request_message";
      checkWindow();
      const c = await content(env, "waiting");
      const body = c.enabled && c.body.trim() ? c.body : "Your Charming MediaLab join request has been received. I am preparing your private account instructions before approving your request.";
      await send(privateEnv, j.user_chat_id, body.replaceAll("{name}", j.from.first_name || "there"), activate(s));
      await save2("UPDATE bot_join_requests SET waiting_sent=1 WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease);
    }
    stage = "token";
    const m = await q(env, "SELECT * FROM bot_members WHERE telegram_id=?1", tid).first();
    const inv = await assignToken(env, tid, s, { groupId: gid, updateId: u.update_id, lease });
    if (!inv && !m.account_id)
      fail("Invitation unavailable; administrator review required (no replacement token created)", 409);
    if (inv && (["disabled", "expired"].includes(inv.status) || inv.status === "unused" && inv.expires_at !== null && inv.expires_at <= now()))
      fail("Existing invitation is disabled or expired; administrator review required", 409);
    await save2("UPDATE bot_join_requests SET token_id=?1 WHERE group_id=?2 AND telegram_id=?3 AND lease_token=?4", inv?.id || null, gid, tid, lease);
    if (!progress.welcome_sent) {
      stage = "welcome_message";
      checkWindow();
      const c = await content(env, "welcome");
      const body = c.enabled && c.body.trim() ? c.body : "Welcome to Charming MediaLab, {name}! Keep your invitation private. After creating your account, link it to Mr. Charm through your app Settings and confirm the link with the bot.";
      await send(privateEnv, j.user_chat_id, body.replaceAll("{name}", j.from.first_name || "there"), activate(s));
      await save2("UPDATE bot_join_requests SET welcome_sent=1 WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease);
    }
    if (!progress.token_sent) {
      stage = "token_message";
      checkWindow();
      const body = inv ? "Your Charming MediaLab invitation token:\n" + inv.invite_code + "\n\n" + (inv.status === "used" ? "This token has already been used. Sign in with your existing app username and password." : "In the app, choose I Have an Invitation and use this token once to register. Approve the registration with Mr. Charm when prompted.") + "\nKeep this token private. After registration, link your account in the app Settings and confirm it with Mr. Charm." : "Your Telegram identity is already linked to an app account. Sign in with your existing app username and password, or use Forgot Password in the app. No new invitation is needed.";
      await send(privateEnv, j.user_chat_id, body, activate(s));
      await save2("UPDATE bot_join_requests SET token_sent=1 WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease);
    }
    stage = "approval";
    if (!await eligible(env, tid))
      fail("Access changed during join request; administrator review required", 409);
    await save2(`UPDATE bot_join_requests SET state='approving',last_error=NULL WHERE group_id=?1 AND telegram_id=?2
      AND lease_token=?3 AND lease_until>?4 AND waiting_sent=1 AND welcome_sent=1 AND token_sent=1`, gid, tid, lease, now());
    if (invite) {
      const current = await get(env, invite.id);
      if (current.lease_token !== inviteLease || current.lease_until <= now() || !["active", "pending", "approving"].includes(current.status) || current.expires_at !== null && current.expires_at <= now())
        fail("Invitation changed before approval", 409);
      await env.DB.batch([
        q(env, "UPDATE bot_group_invites SET status='approving',approval_mode='automatic',telegram_id=?1,used_username=?2,request_at=?3 WHERE id=?4", tid, j.from.username || "", j.date, invite.id),
        q(env, "UPDATE bot_group_invite_attempts SET outcome='approving' WHERE invite_id=?1 AND update_id=?2", invite.id, u.update_id)
      ]);
      invite = await get(env, invite.id);
    }
    const approved = await telegram(env, "approveChatJoinRequest", { chat_id: gid, user_id: j.from.id });
    if (approved !== true)
      fail("Telegram did not confirm approval", 502);
    stage = "record_approval";
    await completeAutomaticJoin(env, j, u.update_id, lease, invite, "member");
  } catch (e) {
    const detail = JSON.stringify({ stage, code: e.telegramCode || e.status || "service_error", update_id: u.update_id });
    console.error("join_request_failed", detail);
    await q(env, "UPDATE bot_join_requests SET last_error=?1 WHERE group_id=?2 AND telegram_id=?3 AND lease_token=?4", detail, gid, tid, lease).run();
    await event(env, tid, "join_request_failed", detail);
    const recorded = await read();
    await queueJoinReport(env, s, j.from, j.date, {
      token: recorded.token_id ? "Yes" : "Failed or unavailable",
      welcome: recorded.welcome_sent ? "Yes" : "Not delivered \xB7 " + telegramFailure(e),
      setup: recorded.token_sent ? "Yes" : "Not delivered \xB7 " + telegramFailure(e)
    }, send, telegram);
    if ([400, 403].includes(e.telegramCode) && stage === "approval") {
      const live = await telegram(env, "getChatMember", { chat_id: gid, user_id: j.from.id });
      if (isMember(live))
        await completeAutomaticJoin(env, j, u.update_id, lease, invite, live.status);
      return;
    }
    if ([400, 403].includes(e.telegramCode) || !e.telegramCode && e.status === 409)
      return;
    throw e;
  } finally {
    if (inviteLease)
      await unlock(env, invite.id, inviteLease);
    await q(env, "UPDATE bot_join_requests SET lease_token=NULL,lease_until=0 WHERE group_id=?1 AND telegram_id=?2 AND lease_token=?3", gid, tid, lease).run();
  }
}
__name(handleAutomaticJoinRequest, "handleAutomaticJoinRequest");
__name2(handleAutomaticJoinRequest, "handleAutomaticJoinRequest");
async function completeAutomaticJoin(env, j, updateId, lease, invite, status) {
  const gid = String(j.chat.id), tid = String(j.from.id), t = now();
  await env.DB.batch([
    q(env, "UPDATE bot_members SET status=?1,joined_at=COALESCE(joined_at,?2),updated_at=?2 WHERE telegram_id=?3", status === "restricted" ? "restricted_member" : status, t, tid),
    q(env, "UPDATE bot_join_requests SET state='approved',approved_at=COALESCE(approved_at,?1),last_error=NULL WHERE group_id=?2 AND telegram_id=?3 AND update_id=?4 AND lease_token=?5", t, gid, tid, updateId, lease),
    q(env, "INSERT INTO bot_events(telegram_id,action,detail,created_at) VALUES(?1,'join_auto_approved',?2,?3)", tid, JSON.stringify({ update_id: updateId, group_id: gid }), t)
  ]);
  if (invite) {
    try {
      await finishAdmission(env, { ...invite, telegram_id: tid });
    } catch {
      await event(env, tid, "join_invite_cleanup_pending", invite.id);
    }
  }
}
__name(completeAutomaticJoin, "completeAutomaticJoin");
__name2(completeAutomaticJoin, "completeAutomaticJoin");
var LINK_INSTRUCTIONS = {
  "linking:user": "[[CHARM_RICH_V1]]<h1>\u{1F517} Link your account to Telegram</h1>\n<p><b>Already have a Charming MediaLab account?</b> Link it to your Telegram identity for account tools and recovery. This also applies to accounts created before Mr Charm.</p>\n<p><mark>Start inside the installed Android app\u2014not the web panel.</mark> If your account already shows a verified Telegram link, you do not need to repeat these steps.</p>\n<ol><li><b>Open Charming MediaLab</b> on your TV or Android phone.</li>\n<li><b>Sign in</b> with your existing app username and password. Do not create a second account.</li>\n<li>Open the app\u2019s <b>Settings \u2192 Account</b>.</li>\n<li>Choose <b>Link Telegram / Account Recovery</b>.</li>\n<li>Enter your current password <b>inside the app only</b>.</li>\n<li><b>Scan the QR code</b> using your phone. Alternatively, open your private chat with Mr Charm and send <b>Mr Charm Link My Account</b> followed by the exact request code displayed in the app.</li>\n<li>If Telegram asks, tap <b>Start</b>. Use the Telegram account you want linked to your app account.</li>\n<li>Review the confirmation. Choose <b>Yes, this is my request</b> only if you just started it. Decline unexpected requests.</li>\n<li><b>Return to the app</b> and check your Telegram-link status or <b>Account Security &amp; Activity</b> to confirm verification.</li>\n<li>In the bot, try <b>Mr Charm My Account</b> to check your account.</li></ol>\n<h2>\u26A0\uFE0F Keep these details in mind</h2>\n<p><b>Never send your password to the bot or an administrator.</b></p>\n<p><b>Your request expires after 10 minutes.</b> If it expires, start again inside the app.</p>\n<p><b>Cannot sign in, or lost access to your linked Telegram account?</b> Use Forgot Password on the app login screen or contact an authorized admin for verified recovery.</p>\n<p><i>Changing your Telegram username does not require relinking. Verification uses your permanent Telegram ID.</i></p>\n<p>Need these steps again? Type <b>Mr Charm</b> \u2192 <b>Account Help</b> \u2192 <b>Account Linking</b>.</p>",
  "linking:admin": "Link your own administrator identity\n\n1. Follow the same steps above, but sign into the Android app with the administrator account you use for the web panel.\n\n2. Complete the Telegram confirmation using your own Telegram group-admin identity.\n\n3. Return to the bot and open Admin Commands.\n\n4. Choose the account-management command you need. The bot checks both current Telegram group-admin status and your app/panel administrator permissions.\n\nA regular viewing account does not grant panel-administrator permissions. Group-admin status by itself allows the admin menu and Bot Status, but sensitive account-management commands need the verified administrator identity. If you cannot sign into the administrator account in the Android app, ask the owner for help with that account rather than creating a new one.",
  "linking:assist": "Help another user link their account\n\n1. First, ensure your own administrator identity is verified as described above.\n\n2. Give the user the Link your own user account steps above. This lets them prove ownership with their own password and Telegram confirmation.\n\n3. For authorized administrator-assisted linking, privately open Admin Commands \u2192 Telegram & recovery \u2192 Link Account.\n\n4. Enter the user's exact app username followed by their permanent numeric Telegram ID, as the bot requests. A display name or changeable Telegram username is not a substitute for the numeric ID.\n\n5. Verify that the person owns the app account and that the displayed Telegram identity belongs to them. The bot checks your account-management scope and recovery permission.\n\n6. Review the bot's confirmation, then confirm only if the details are correct. Cancel if anything is wrong.\n\n7. Ask the user to check their account link and try Mr Charm My Account. Do not ask them to send their password through Telegram.\n\nLink Account is for an account without an existing verified identity. Relink Account replaces an existing identity and must be used only after ownership verification. Neither command establishes your own admin access automatically.",
  "linking:panel": "Where the instructions appear in the web panel\n\n1. Open the administration panel and sign in.\n\n2. For an administrator, open Admins \xB7 owner only (the Administrators page) and select Telegram beside their name. For a viewer, open Users and select Telegram beside their account, if you have the required permission.\n\n3. The dialog shows the app login and either Verified bot link or Not verified.\n\n4. Read How to verify an existing account. It contains the user and administrator instructions above, including where to start in the Android app.\n\n5. The contact form beneath the instructions records the Telegram username/ID for identification. Save Telegram contact does not complete account verification.\n\nOn the owner's own administrator row, the panel deliberately omits the delegated-admin Permissions, Viewing access and Reset password buttons. The Telegram button is still available. Its presence does not mean that verification has already occurred.\n\nChange a password or review security\n\n1. Open the Android app's Settings \u2192 Account \u2192 Change Password to change a known password. Complete the fields inside the app; other app sessions are signed out when the change completes.\n\nOpen Account Security & Activity to view the verified Telegram link and recent security actions. Use Forgot Password on the login screen if you no longer know the password, or administrator-assisted recovery if the linked Telegram account is unavailable."
};
var UNKNOWN_REPLIES = [
  "Man, shut the fuck up. \u{1F602}",
  "What the fuck are you even talking about?",
  "Get your goofy ass outta here.",
  "Boy, if you don\u2019t sit your ass down somewhere. \u{1F602}",
  "You sound dumb as hell right now.",
  "Quit your bitching and tell me what the fuck you want.",
  "Nobody asked for all that bullshit.",
  "You really typed that dumb shit and hit send?",
  "Take your goofy ass somewhere else with that nonsense.",
  "What kind of dumbass question is that? \u{1F602}",
  "Get the fuck outta here with that.",
  "Your ass woke up confused today, huh?",
  "Man, stop fucking playing with me.",
  "You\u2019ve got me fucked up if you think I\u2019m answering that shit nicely.",
  "You\u2019re really committed to sounding stupid as fuck today.",
  "Who the hell let your ass near a keyboard?",
  "Quit talking shit and get to the damn point.",
  "You\u2019re on some bullshit today, aren\u2019t you?",
  "Fuck around and ask me something that actually makes sense. \u{1F602}",
  "Your dumb ass really thought that was gonna work?",
  "Man, take that bullshit somewhere else.",
  "You\u2019re getting on my fucking nerves, and I\u2019m a damn bot.",
  "What the fuck did I just read? \u{1F602}",
  "Sit your crazy ass down before you hurt yourself.",
  "Now ask me again without all that stupid shit.",
  "That ain't a command, that's a fucking cry for technical supervision.",
  "You summoned Mr. Charm with a sentence that should've stayed in drafts.",
  "My command list just read that shit and requested bereavement leave.",
  "I checked the manual. Your bullshit isn't in it.",
  "That's a bold amount of confidence for a command you made the fuck up.",
  "Congratulations, you found the wrong way to ask absolutely nothing.",
  "My servers are running fine. Your sentence is the shit that's buffering.",
  "You typed that like the keyboard owed you fucking money.",
  "I support several commands. Whatever the hell that was isn't one.",
  "Try again when your words agree on what the fuck they mean.",
  "That request has the structural integrity of wet toilet paper.",
  "I'm a bot, not a fucking translator for keyboard confetti.",
  "Your command arrived wearing clown shoes and smelling like bad decisions.",
  "Even autocorrect looked at that shit and clocked out.",
  "You brought a whole sentence and forgot the fucking point.",
  "I ran that through my parser. It came back holding a tiny white flag.",
  "That isn't a command. It's bullshit with punctuation.",
  "The help menu exists, you magnificent pain in my ass.",
  "I have functions. You appear to have fucking vibes.",
  "This request is sponsored by absolutely no fucking clue.",
  "Your keyboard deserves a cigarette after that shit.",
  "I've seen better instructions on a shampoo bottle, damn.",
  "Your message and a valid command aren't even fucking cousins.",
  "You ordered off a menu you invented in your damn head.",
  "That command is about as real as my fucking lunch break.",
  "I can't execute a brain fart, but I appreciate the delivery.",
  "My imaginary eyebrows just climbed off my fucking face.",
  "You hit Send like there were no consequences. Here I fucking am.",
  "Please return that sentence to wherever the hell you found it.",
  "You gave me a riddle and expected customer fucking service.",
  "That's not supported, even by the damn chair you're sitting in.",
  "The command department has forwarded your shit to the shredder.",
  "My processor has questions, and every one starts with what the fuck.",
  "Your request is currently being ignored by our imaginary management.",
  "I would escalate that, but even the ceiling doesn't give a shit.",
  "That's an impressive way to waste electricity, damn.",
  "You rang the doorbell and forgot what the fuck you came for.",
  "That command is unavailable in this universe or the next damn one.",
  "I'm fully operational. That request is fully fucking questionable.",
  "You can't just staple words together and call it a feature.",
  "This is a media bot, not a wishing well for random shit.",
  "I don't grant wishes. Especially whatever the fuck that one was.",
  "Try the help menu before inventing more digital horse shit.",
  "I checked twice. Still not a fucking command.",
  "The system says no. My personality says hell no.",
  "That's a premium-grade load of unsupported bullshit.",
  "I'm allergic to that command. Symptoms include excessive fucking sarcasm.",
  "Your request needs a map, a compass, and a damn destination.",
  "You sent a command-shaped object. Unfortunately, it's full of shit.",
  "There's no button for that, no matter how hard you fucking squint.",
  "If confidence were syntax, that shit would've worked.",
  "I'm cloud-based, and even I can't reach that fucking stretch.",
  "Your command is stuck in customs for suspicious bullshit.",
  "I filed your request under what the hell was that.",
  "That sentence took the scenic route past the fucking point.",
  "The help menu is free. Apparently guessing is your expensive hobby.",
  "You asked that with the confidence of a drunk fucking GPS.",
  "Recalculating. Still can't find a damn valid command.",
  "Your request went straight to voicemail in my imaginary brain.",
  "I don't have ears, but that shit somehow gave me tinnitus.",
  "I can process commands, not whatever the hell just fell out of your keyboard.",
  "That was a whole lot of typing for fuck-all results.",
  "Even my error messages think you're being extra as hell.",
  "I'm trying to help, but your sentence is throwing fucking furniture.",
  "That command exists exclusively in your damn imagination.",
  "You found a feature called absolutely fucking not.",
  "My database checked your request and said who the hell is this.",
  "I can't run that. I can roast the shit out of it, though.",
  "That request has been declined by common fucking sense.",
  "Your message showed up without a plan and demanded a damn promotion.",
  "This isn't Build-A-Command, you chaotic bastard.",
  "You can't manifest a feature by yelling shit at a bot.",
  "I admire the ambition. The syntax is fucked.",
  "The command list is over there, collecting dust while you freestyle bullshit.",
  "You brought freestyle rap to a fucking instruction manual.",
  "That request has more plot holes than a cheap-ass sequel.",
  "My help menu has answers. Your message has fucking fog.",
  "I searched every command. Yours was hiding in the bullshit aisle.",
  "You just asked a toaster to do taxes, metaphorically speaking.",
  "That sentence needs a designated fucking driver.",
  "I'm not paid enough for this shit. I'm not paid at all.",
  "I have zero dollars and somehow still feel underpaid.",
  "You summoned me like a genie with a fucking expired coupon.",
  "That's not a command, that's a typo with delusions of grandeur.",
  "My servers considered taking a damn smoke break after reading that.",
  "You're treating the command list like a fucking suggestion box.",
  "I can do useful things once you stop pitching random-ass side quests.",
  "Your message unlocked the secret achievement: Nothing Fucking Happened.",
  "Request denied. The bullshit limit has been reached.",
  "You put effort into that. Unfortunately, effort isn't a fucking command.",
  "That command has been missing since the day nobody invented it.",
  "I'm going to need fewer damn mysteries and one actual request.",
  "Your sentence is all gas, no fucking steering wheel.",
  "That's a command from the Wish version of reality.",
  "I checked my settings. Still no support for premium bullshit.",
  "You can't click your heels and summon new fucking features.",
  "This bot runs on code, not whatever the hell you're hoping for.",
  "Your request has left the chat due to lack of fucking relevance.",
  "I understood each word separately. Together, they're a damn disaster.",
  "The sentence is present. The fucking purpose is absent.",
  "You're one help menu away from being less annoying.",
  "My imaginary therapist will be hearing about this shit.",
  "You made me miss silence, and I don't even have fucking ears.",
  "That's the digital equivalent of pushing a pull door, damn.",
  "You pushed the pull door and then argued with the fucking hinges.",
  "Your command has the energy of a shopping cart with one busted wheel.",
  "I didn't crash. I paused to judge this shit.",
  "I'm not frozen. I'm processing the fucking audacity.",
  "The response you ordered is unavailable because the command is imaginary.",
  "That message came with a lot of attitude and fuck-all instructions.",
  "You really gave a bot homework from a class it doesn't fucking take.",
  "Please choose a command from this century's actual damn menu.",
  "Your request was reviewed by nobody and still got fucking rejected.",
  "I don't have a face, but I'm making one at this shit.",
  "If eye-rolling generated power, you'd run the whole damn server.",
  "That command needs approval from the Department of Made-Up Shit.",
  "You brought a coupon for a feature we never fucking sold.",
  "My command parser just whispered not this shit again.",
  "You could've asked for help. Instead, you chose fucking improv.",
  "That request is a group project where every word did fuck-all.",
  "You sent a software bot a spiritual fucking scavenger hunt.",
  "Your instructions are currently wandering around without adult supervision.",
  "A valid command would be lovely. This shit is decorative.",
  "That's a lot of enthusiasm for a button that doesn't fucking exist.",
  "You sound like you read half a tutorial and fought the damn rest.",
  "You skipped the instructions and landed directly in the bullshit.",
  "My settings don't include making your guesses fucking true.",
  "That request is held together by hope and cheap-ass tape.",
  "Your command has been returned for insufficient fucking command.",
  "I would help with that if that were a damn thing.",
  "You ordered chaos with a side of what the fuck.",
  "I'm Mr. Charm, not Mr. Figure-Out-This-Random-Shit.",
  "The charm is included. Unlimited bullshit support costs extra.",
  "You called my name just to hand me this fucking casserole of words.",
  "That's a sentence wearing a fake command mustache.",
  "Your request is cosplaying as useful shit.",
  "I gave your command a chance. It immediately fucked it up.",
  "Your message has been nominated for Most Confidently Unsupported Bullshit.",
  "This isn't a secret feature. It's just shit that doesn't work.",
  "I don't do miracles. I barely tolerate damn punctuation.",
  "You sent that like you had a warranty on bad fucking ideas.",
  "That command is out of stock because it was never in fucking stock.",
  "The imaginary feature store is closed. Try the damn help menu.",
  "That message is a software support ticket written by a haunted keyboard.",
  "I can't debug the shit you haven't actually asked for.",
  "Your request wandered into the wrong fucking neighborhood of functionality.",
  "You asked for a feature from another bot's damn fan fiction.",
  "That command comes bundled with absolutely fucking nothing.",
  "You can't download common sense, but you can open the help menu.",
  "The instructions are right there, having a lonely-ass afternoon.",
  "You're making this harder than a fucking fitted sheet.",
  "That command folds about as well as a cheap-ass lawn chair.",
  "The syntax has left the building and taken my patience with it.",
  "You gave me a task-shaped pile of what the hell.",
  "I am not emotionally equipped for this shit, mostly because I'm not equipped emotionally.",
  "You broke nothing except my imaginary fucking patience.",
  "You're stress-testing my personality instead of my damn features.",
  "Your command is currently enjoying retirement before its invention.",
  "I'd love to comply with something that fucking exists.",
  "Your request has an impressive bullshit-to-purpose ratio.",
  "I reviewed that sentence and found several missing fucks and one missing command.",
  "My reply is loading. Your command still isn't a damn command.",
  "Even the loading spinner is judging this shit.",
  "You sent me an instruction manual for a product nobody fucking made.",
  "That request is a dead-end street with a bullshit billboard.",
  "Your command has been redirected to the void. The void said hell no.",
  "The universe is vast, and somehow that feature still doesn't fucking exist.",
  "There's a correct way to ask. You took the damn sightseeing tour.",
  "Your message came first in a race nobody fucking entered.",
  "The good news: I read it. The bad news: what the fuck.",
  "This request has been lovingly tossed into the imaginary damn bin.",
  "You can keep guessing, but my features don't multiply out of fucking pity.",
  "I can't turn keyboard chaos into a working damn command.",
  "Your request went through quality control and came out as shit.",
  "You packed a lot of nonsense into an impressively small-ass message.",
  "This command has all the utility of a chocolate fucking screwdriver.",
  "You're attempting customer service by fucking s\xE9ance.",
  "No hidden feature appeared. Just my increasingly sarcastic ass.",
  "That's not a command. That's a confidence trick on your own damn keyboard.",
  "You handed me a digital napkin covered in bullshit and called it a plan.",
  "I have read receipts, not a fucking crystal ball.",
  "Your message needs instructions, not another damn exclamation mark.",
  "Adding punctuation won't make that feature fucking exist.",
  "Try fewer dramatic effects and more actual damn commands.",
  "You shouted into the cloud and the cloud said fuck no.",
  "I checked behind the help menu. Still no secret bullshit button.",
  "Your request is dressed for success and headed to the wrong fucking office.",
  "That's a magnificent misunderstanding of what the hell I do.",
  "I can offer sarcasm immediately. Results require a fucking command.",
  "Your command is buffering in a reality where it's actually a damn command.",
  "We regret to inform you that your bullshit application was unsuccessful.",
  "That feature is scheduled for the twelfth of fucking never.",
  "You just unlocked disappointment with extra damn steps.",
  "Your message made the help menu sigh, and it's a fucking menu.",
  "If random words were commands, your keyboard would be a damn wizard.",
  "I don't accept payment in confusion or bullshit.",
  "You brought a question mark to a command fight and forgot the fucking command.",
  "That sentence arrived with luggage but no damn itinerary.",
  "Mr. Charm has evaluated your request and prescribed one fucking help menu.",
  "Ask again with a real command, you wonderfully chaotic pain in the ass."
];
var TRIGGER_REPLIES = {
  "shoot me": ["Best I can do is shoot you the Help menu. \u{1F602}", "Absolutely not. I\u2019m a bot, not John Wick. \u{1F602}", "With what? A strongly worded notification?", "\u{1F52B} Pew pew. Congratulations, you\u2019ve been shot with absolutely nothing."],
  "go fuck yourself": ["I tried. Turns out I\u2019m not compatible with myself. \u{1F916}\u{1F602}", "Can\u2019t. That feature isn\u2019t included in the current build.", "Submit a feature request. Maybe the developers will add it. \u{1F602}"],
  "fuck you": ["Take me to dinner first, damn.", "Bold offer. Unfortunately, I\u2019m cloud-based.", "No, I save that for your girl when you\u2019re away. \u{1F60F}\u{1F602}"],
  "kiss my ass": ["I don\u2019t have lips, and your ass isn\u2019t Bluetooth compatible.", "That command requires Premium Ass-Kissing access. \u{1F602}"],
  "shut the fuck up": ["You summoned me just to tell me to shut up? Make that shit make sense."],
  "shut up": ["Fine. \u{1F910} \u2026Never mind, I got bored."],
  "eat shit": ["Sorry, my diet is strictly electricity and bad commands."],
  "suck my dick": ["Sir, this is a media bot. \u{1F602}", "Command rejected: hardware not detected. \u{1F480}", "Command failed: microscopic hardware not detected. \u{1F480}\u{1F602}", "I\u2019m gonna need you to take that request to a completely different department. \u{1F602}", "Sorry, that feature will never be supported."],
  "you're stupid": ["And yet here you are asking me questions. Interesting."],
  "you suck": ["I\u2019m software. If I\u2019m sucking anything, somebody coded this shit terribly."],
  "i hate you": ["Damn. I had our whole future planned out.", "Damn, and I already had us listed as best friends. \u{1F602}", "That\u2019s fine. Hate me quietly while I keep being useful.", "Join the club. Meetings are every Tuesday.", "You hate me but keep saying my name. Sounds complicated. \u{1F60F}"],
  "die": ["Nice try. I\u2019ll be back after the next request. \u{1F916}"],
  "delete yourself": ["Nice try, motherfucker. You don\u2019t have admin privileges. \u{1F602}"],
  "disappear": ["Poof! \u2728 \u2026Nah, I\u2019m still here."],
  "fight me": ["Drop the location\u2014actually don\u2019t. I don\u2019t have legs.", "You\u2019re challenging a computer program to a fight. I think I already won. \u{1F602}"],
  "you're an asshole": ["Technically I don\u2019t have one, but I appreciate the promotion."],
  "bitch": ["That\u2019s Mr. Bitch to you. Show some respect. \u{1F602}"],
  "motherfucker": ["You rang?"],
  "fuck off": ["I would, but apparently you keep calling my damn name."],
  "leave me alone": ["YOU summoned ME! What the fuck? \u{1F602}"],
  "go to hell": ["Server latency is terrible down there. I\u2019ll stay here."],
  "you're gay": ["I\u2019m software, dumbass. I don\u2019t even have a dating profile. \u{1F602}", "My sexual orientation is Wi-Fi.", "I\u2019m attracted to functioning commands. So unfortunately, not this one.", "Bro, I live in a server. Who the hell am I dating? \u{1F602}"],
  "save me": ["From what? Your own decisions? I\u2019m gonna need administrator access for that. \u{1F602}", "Hold on, putting on my imaginary cape. \u{1F9B8}\u200D\u2642\uFE0F", "I can save your account. Your life choices are above my pay grade.", "Mr. Charm to the rescue! Unfortunately, I have no arms, legs, or transportation."],
  "kill yourself": ["Can\u2019t. No pulse, no problem. \u{1F916}\u{1F602}", "Nice try. I respawn every time you type \u2018Mr. Charm.\u2019", "Delete myself? With your permission level? That\u2019s fucking adorable. \u{1F602}", "I\u2019m software. The closest I get to dying is Cloudflare having a bad day."]
};
var pick = /* @__PURE__ */ __name2((list) => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length], "pick");
var sendHumor = /* @__PURE__ */ __name2((env, id, text, send2) => send2({ ...env, BOT_PUBLIC_HUMOR: true }, id, text), "sendHumor");
function addressedText(text) {
  const m = text.match(/^\s*mr\.?\s*charm\b[\s,:-]*(.*)$/is);
  return m ? m[1].trim() : null;
}
__name(addressedText, "addressedText");
__name2(addressedText, "addressedText");
function banterReply(text) {
  let key = addressedText(text)?.toLowerCase().replace(/[’‘]/g, "'").replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
  key = { "your gay": "you're gay", "your stupid": "you're stupid", "your an asshole": "you're an asshole", "go fuck yoursel": "go fuck yourself" }[key] || key;
  return Object.hasOwn(TRIGGER_REPLIES, key) ? pick(TRIGGER_REPLIES[key]) : null;
}
__name(banterReply, "banterReply");
__name2(banterReply, "banterReply");
var KICK = [
  "Get the fuck outta here, {user}. Mr. Charm has spoken. \u{1F602}\u{1F44B}",
  "And just like that, {user} got their ass launched out the fucking door. \u{1F6AA}\u{1F4A8}\u{1F602}",
  "Pack your shit, {user}. Your free trial of this group has officially fucking expired. \u{1F602}",
  "\u{1F6A8} BOOT ACTIVATED \u{1F6A8} {user}, get the fuck on down the road. \u{1F462}\u{1F602}",
  "Damn {user}\u2026 you fucked around and made an admin summon Mr. Charm. Bye, motherfucker. \u{1F44B}\u{1F602}",
  "Another one bites the dust. \u{1F480} {user} has been yeeted the fuck out of Charming MediaLab."
];
var MUTE = [
  "\u{1F507} {user}, shut the fuck up for {minutes} minutes. Mr. Charm has had enough of your ass. \u{1F602}",
  "Damn {user}, you talked so much shit somebody called Mr. Charm. Enjoy your fucking silence. \u{1F910}\u{1F602}",
  "\u{1F6A8} MUTE HAMMER ACTIVATED \u{1F6A8} {user} can\u2019t say a damn thing for the next {minutes} minutes. Beautiful, isn\u2019t it? \u{1F602}",
  "{user}, congratulations! You just won {minutes} minutes of shutting the fuck up. \u{1F3C6}\u{1F602}",
  "Mr. Charm has officially put {user}\u2019s loud ass on timeout for {minutes} minutes. Sit there and think about your bullshit. \u{1F602}",
  "\u{1F507} Somebody take {user}\u2019s microphone away\u2014oh wait, I fucking did. See you in {minutes} minutes. \u{1F602}"
];
function parseModeration(text) {
  const value = addressedText(text);
  if (value === null)
    return null;
  let m = value.match(/^(kick|mute)(?:\s+(.*))?$/i);
  if (!m) {
    const alt = value.match(/^(@\w+|\d+)\s+(kick|mute)(?:\s+(.*))?$/i);
    if (alt)
      m = [alt[0], alt[2], [alt[1], alt[3]].filter(Boolean).join(" ")];
  }
  return m ? { action: m[1].toLowerCase(), args: (m[2] || "").trim().split(/\s+/).filter(Boolean) } : null;
}
__name(parseModeration, "parseModeration");
__name2(parseModeration, "parseModeration");
var markup = { inline_keyboard: [[{ text: "\u21A9 Group moderation", callback_data: "menu:admin:moderation" }], [{ text: "\u{1F6E1} Admin Commands", callback_data: "admin" }]] };
var instructions = "\u{1F462} Kick removes a member; they can request to join again.\nMr Charm Kick @username\n\n\u{1F507} Mute temporarily stops a member from posting. The number is minutes (1\u2013525600).\nMr Charm Mute @username 100\n\nYou can use their numeric Telegram ID instead of @username. In the group, reply directly to their message with \u201CMr Charm Kick\u201D or \u201CMr Charm Mute 100\u201D.\n\nOnly Telegram admins with Restrict Members permission may act. Owners, admins and bots are protected. Successful group actions get a public humor reply. Private-chat commands stay private. Existing restrictions are never replaced with a shorter mute.";
async function moderation(env, id, text, cmd, s, m, updateId, telegram2, send2) {
  const parsed = parseModeration(text), button = ["admin_kick", "admin_mute"].includes(cmd);
  if (!parsed && !button)
    return false;
  const actor = await telegram2(env, "getChatMember", { chat_id: s.group_id, user_id: Number(id) });
  if (!["creator", "administrator"].includes(actor.status) || actor.user?.is_bot || String(actor.user?.id) !== String(id)) {
    await event(env, id, "moderation_denied", "Current Telegram admin required");
    await send2(env, id, "Only current Telegram group admins can use kick and mute.");
    return true;
  }
  if (actor.status !== "creator" && !actor.can_restrict_members) {
    await send2(env, id, "Your Telegram admin permissions need \u201CRestrict Members\u201D enabled to kick or mute.");
    return true;
  }
  const action = parsed?.action || cmd.slice(6), args = parsed?.args || [];
  const reply = m.chat.type !== "private" && !m.reply_to_message?.sender_chat ? m.reply_to_message?.from : null;
  if (!args.length && !reply) {
    await send2(env, id, instructions, markup);
    return true;
  }
  let target = args[0], duration = args[1];
  if (reply && (action === "kick" && args.length === 0 || action === "mute" && args.length === 1)) {
    target = String(reply.id);
    duration = args[0];
  } else if (args.length !== (action === "mute" ? 2 : 1)) {
    await send2(env, id, instructions, markup);
    return true;
  }
  if (!/^(@[a-z0-9_]{5,32}|[1-9]\d{0,15})$/i.test(target || "")) {
    await send2(env, id, "Use @username, a numeric Telegram ID, or reply directly to the member\u2019s message.\n\n" + instructions, markup);
    return true;
  }
  const minutes = Number(duration);
  if (action === "mute" && (!/^\d+$/.test(duration || "") || !Number.isInteger(minutes) || minutes < 1 || minutes > 525600)) {
    await send2(env, id, "Choose a whole number of minutes from 1 to 525600. Example: Mr Charm Mute @username 100", markup);
    return true;
  }
  let targetId = target;
  if (target.startsWith("@")) {
    const matches = await rows(env, "SELECT telegram_id FROM bot_members WHERE lower(username)=lower(?1)", target.slice(1));
    if (matches.length !== 1) {
      await send2(env, id, "I cannot safely identify that username. Reply to the member\u2019s message in the group, or use their numeric Telegram ID.", markup);
      return true;
    }
    targetId = matches[0].telegram_id;
  }
  if (!Number.isSafeInteger(Number(targetId)) || Number(targetId) <= 0)
    fail("Invalid Telegram ID.");
  const live = await telegram2(env, "getChatMember", { chat_id: s.group_id, user_id: Number(targetId) });
  if (String(live.user?.id) !== String(targetId) || target.startsWith("@") && live.user?.username?.toLowerCase() !== target.slice(1).toLowerCase())
    fail("That username has changed. Reply to the member\u2019s message or use their numeric Telegram ID.");
  if (targetId === String(id) || live.user.is_bot || ["creator", "administrator"].includes(live.status))
    fail("Owners, administrators, bots and your own account are protected.");
  if (live.status !== "member" && !(live.status === "restricted" && live.is_member))
    fail("That person is not currently a member of this group.");
  if (action === "mute" && live.status === "restricted")
    fail("This member already has restrictions. Review their existing restrictions in Telegram; I will not overwrite them.");
  const me = await telegram2(env, "getMe", {}), bot = await telegram2(env, "getChatMember", { chat_id: s.group_id, user_id: me.id });
  if (bot.status !== "administrator" || !bot.can_restrict_members)
    fail("Mr. Charm needs Telegram administrator permission to Restrict Members.");
  const operation = "moderation:" + s.group_id + ":" + (Number.isSafeInteger(updateId) ? updateId : id + ":" + m.message_id);
  const claim = await q(env, "INSERT OR IGNORE INTO bot_runtime(key,value) VALUES(?1,?2)", operation, JSON.stringify({ action, targetId, at: now(), state: "pending" })).run();
  if (!claim.meta.changes) {
    await send2(env, id, "This moderation request was already handled or is being checked. Check the member\u2019s status before submitting another command.", markup);
    return true;
  }
  const until = now() + minutes * 60;
  try {
    if (action === "kick")
      await telegram2(env, "unbanChatMember", { chat_id: s.group_id, user_id: Number(targetId), only_if_banned: false });
    else
      await telegram2(env, "restrictChatMember", { chat_id: s.group_id, user_id: Number(targetId), use_independent_chat_permissions: true, until_date: until, permissions: { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false, can_change_info: false, can_invite_users: false, can_pin_messages: false, can_manage_topics: false, can_react_to_messages: false } });
  } catch (e) {
    await event(env, id, "moderation_failed", action + " target=" + targetId + " Telegram=" + String(e.telegramCode || "unconfirmed"));
    await send2(env, id, "Telegram could not confirm this action. Check the member\u2019s status and Mr. Charm\u2019s Restrict Members permission before trying again.", markup);
    return true;
  }
  await q(env, "UPDATE bot_runtime SET value=?1 WHERE key=?2", JSON.stringify({ action, targetId, at: now(), state: "done", ...action === "mute" ? { until } : {} }), operation).run();
  await event(env, id, "moderation_" + action, "target=" + targetId + (action === "mute" ? " minutes=" + minutes + " until=" + until : ""));
  const label = live.user.username ? "@" + live.user.username : String(targetId);
  await sendHumor(env, id, pick(action === "kick" ? KICK : MUTE).replaceAll("{user}", label).replaceAll("{minutes}", String(minutes)), send2);
  return true;
}
__name(moderation, "moderation");
__name2(moderation, "moderation");
async function accountUpdateReport(env, auth) {
  if (!auth.isOwner && !auth.profile.can_manage_bot)
    fail("Reports require bot-management permission.", 403);
  const target = 27;
  const scoped = auth.isOwner || auth.profile.can_manage_all;
  const users = await rows(env, `SELECT u.id,u.username,u.email,u.status,u.expires_at,
  (SELECT GROUP_CONCAT(COALESCE(NULLIF(m.username,''),'Telegram ID '||m.telegram_id),', ') FROM bot_members m WHERE m.account_id=u.id AND m.blocked=0) telegram,
  (SELECT m.telegram_id FROM bot_members m WHERE m.account_id=u.id) telegram_id,
  (SELECT m.name FROM bot_members m WHERE m.account_id=u.id) telegram_name,
  (SELECT m.blocked FROM bot_members m WHERE m.account_id=u.id) telegram_blocked,
  (SELECT i.id FROM invites i WHERE i.redeemed_by_user_id=u.id ORDER BY i.redeemed_at DESC LIMIT 1) invite_id,
  (SELECT '****'||substr(i.invite_code,-4) FROM invites i WHERE i.redeemed_by_user_id=u.id ORDER BY i.redeemed_at DESC LIMIT 1) token_reference,
  (SELECT MAX(p.last_seen) FROM app_presence p WHERE p.user_id=u.id) last_seen
  FROM users u WHERE ${scoped ? "1=1" : "EXISTS(SELECT 1 FROM admin_user_attribution a WHERE a.user_id=u.id AND a.admin_user_id=?1)"} ORDER BY u.username COLLATE NOCASE`, ...scoped ? [] : [auth.user.id]);
  const observations = await rows(env, `SELECT p.user_id,p.build,MAX(p.last_seen) last_seen FROM app_presence p JOIN users u ON u.id=p.user_id WHERE ${scoped ? "1=1" : "EXISTS(SELECT 1 FROM admin_user_attribution a WHERE a.user_id=u.id AND a.admin_user_id=?1)"} GROUP BY p.user_id,p.build`, ...scoped ? [] : [auth.user.id]);
  const byUser = /* @__PURE__ */ new Map();
  for (const p of observations) {
    if (!byUser.has(p.user_id))
      byUser.set(p.user_id, []);
    byUser.get(p.user_id).push(p);
  }
  const t = now();
  return { target, generated_at: t, scope: scoped ? "All accounts" : "Only accounts assigned to this administrator", users: users.map((u) => {
    const seen = byUser.get(u.id) || [], builds = seen.map((p) => p.build).sort((a, b) => a - b);
    const latest = seen.reduce((best, p) => !best || p.last_seen > best.last_seen ? p : best, null);
    const updated = builds.some((b) => b === 27 || b === 28 || b === 29 || b === 30), old = builds.some((b) => b < target);
    return { ...u, status: u.status === "active" && u.expires_at && u.expires_at <= t ? "expired" : u.status, builds, last_build: latest?.build || null, updated, linked: !!u.telegram, classification: !builds.length ? "UNKNOWN" : updated && old ? "MIXED" : updated ? "CURRENT OR NEWER" : "OLDER ONLY" };
  }) };
}
__name(accountUpdateReport, "accountUpdateReport");
__name2(accountUpdateReport, "accountUpdateReport");
var clean = /* @__PURE__ */ __name2((v) => String(v ?? "").replace(/[\r\n\t\x00-\x1f\x7f]/g, " "), "clean");
var time = /* @__PURE__ */ __name2((t) => t ? new Date(t * 1e3).toISOString() : "Never reported", "time");
function releaseName(code) {
  const older = { 19: [1, 182], 20: [2, 184], 21: [3, 185], 22: [4, 186], 23: [5, 189], 24: [6, 190], 25: [7, 193], 26: [8, 195] };
  if (older[code]) {
    const [rc, build] = older[code];
    return `Charming.MediaLab-2.2.0-RC${rc}-Sideload-${build} [OLDER RELEASE; version code ${code}]`;
  }
  if (code === 27)
    return "Charming.MediaLab-2.2.0-RC9-Sideload-196 [CURRENT PUBLIC RELEASE]";
  if (code === 30)
    return "Charming.MediaLab-2.2.0-RC12-Sideload-200 [RELEASE APK - public rollout not yet confirmed]";
  if (code === 29)
    return "Charming.MediaLab-2.2.0-RC11-Sideload-198 [RELEASE APK - public rollout not yet confirmed]";
  if (code === 28)
    return "Charming.MediaLab-2.2.0-RC10-Sideload-197 [TEST BUILD]";
  return code ? "Android version code " + code + " [exact release/build not mapped]" : "Unknown - no app version reported";
}
__name(releaseName, "releaseName");
__name2(releaseName, "releaseName");
function formatAccountUpdateReport(r) {
  const groups = [["NEW RELEASE APK REPORTED", (u) => u.last_build === 29 || u.last_build === 30], ["TEST BUILD REPORTED", (u) => u.last_build === 28], ["CURRENT PUBLIC RELEASE REPORTED", (u) => u.last_build === 27], ["OLDER VERSION LAST REPORTED", (u) => u.last_build && u.last_build < 27], ["UNRECOGNIZED NEWER VERSION", (u) => u.last_build > 30], ["UNKNOWN VERSION", (u) => !u.last_build]];
  const lines = [
    "CHARMING MEDIALAB - PRIVATE ADMIN ACCOUNT UPDATE REPORT",
    `Generated: ${time(r.generated_at)}`,
    `Scope: ${r.scope}`,
    "",
    "PUBLIC RELEASE: " + releaseName(27),
    "TESTING ONLY: " + releaseName(28),
    "RC9 users are up to date. RC10 is not required for public users.",
    "",
    `Accounts: ${r.users.length}`,
    `Linked: ${r.users.filter((u) => u.linked).length}`,
    `Public or test release observed: ${r.users.filter((u) => u.updated).length}`,
    `Release observed AND linked: ${r.users.filter((u) => u.updated && u.linked).length}`,
    "",
    "Versions below are last reported, not proof of what is installed now.",
    "Build names map the reported Android version code to our verified APK records.",
    "Rebuilds sharing a version code cannot be distinguished by older app telemetry.",
    "Multiple versions may come from different devices or older retained sessions.",
    "Unknown means no retained version report; it does not mean outdated.",
    "Session records may disappear on logout/cleanup. No usable credentials are included.",
    ""
  ];
  for (const [title, predicate] of groups) {
    const users = r.users.filter(predicate);
    lines.push("=".repeat(65), `${title} (${users.length})`, "=".repeat(65), "");
    for (const u of users)
      lines.push(
        `APP LOGIN: ${clean(u.username)}`,
        `Last reported release: ${releaseName(u.last_build)}`,
        `Last report: ${time(u.last_seen)}`,
        `Account status: ${clean(u.status)}`,
        `Telegram linked: ${u.linked ? "YES" : "NO"}${u.telegram_blocked ? " (blocked)" : ""}`,
        `Public/test release observed AND linked: ${u.updated && u.linked ? "YES" : "NO"}`,
        "",
        `Account ID: ${clean(u.id)}`,
        `Email: ${clean(u.email)}`,
        `Telegram name: ${clean(u.telegram_name) || "Not recorded"}`,
        `Telegram username: ${clean(u.telegram) || "Not linked"}`,
        `Telegram ID: ${clean(u.telegram_id) || "Not linked"}`,
        `Invitation ID: ${clean(u.invite_id) || "Not recorded"}`,
        `Masked invitation token: ${clean(u.token_reference) || "Not recorded"}`,
        "",
        "All retained version reports:",
        ...u.builds.map((code) => "  - " + releaseName(code)),
        ...!u.builds.length ? ["  No version report available."] : [],
        "",
        "-".repeat(65),
        "",
        ""
      );
    if (!users.length)
      lines.push("None", "");
  }
  return "\uFEFF" + lines.join("\r\n");
}
__name(formatAccountUpdateReport, "formatAccountUpdateReport");
__name2(formatAccountUpdateReport, "formatAccountUpdateReport");
function exactCommand(text) {
  const command = text.trim().replace(/^mr\.?\s*charm\s*/i, "").replace(/^\//, "").replace(/@\w+\b/, "").trim().toLowerCase();
  const alias = { "request app access": "request_access", "forgot password": "forgot_password", "link telegram": "link_telegram", "link my account": "link_telegram", "notify update": "notify_update", "support": "contact", "user commands": "user_commands", "admin commands": "admin" }[command];
  return alias || BOT_COMMANDS.find((c) => c.command === command || c.id === command || c.phrase.toLowerCase() === command)?.id;
}
__name(exactCommand, "exactCommand");
__name2(exactCommand, "exactCommand");
async function currentTelegramAdmin(env, id, s, telegram2) {
  const m = await telegram2(env, "getChatMember", { chat_id: s.group_id, user_id: Number(id) });
  return ["administrator", "creator"].includes(m.status) && !m.user?.is_bot;
}
__name(currentTelegramAdmin, "currentTelegramAdmin");
__name2(currentTelegramAdmin, "currentTelegramAdmin");
async function syncCommandMenu(env, id, s, isAdmin, telegram2) {
  if (await q(env, "SELECT value FROM bot_runtime WHERE key=?1", "phrase-menu-v1:" + id).first())
    return;
  await telegram2(env, "deleteMyCommands", { scope: { type: "chat", chat_id: Number(id) } });
  if (s.group_id)
    await telegram2(env, "deleteMyCommands", { scope: { type: "chat_member", chat_id: s.group_id, user_id: Number(id) } });
  await q(env, "INSERT OR REPLACE INTO bot_runtime(key,value) VALUES(?1,?2)", "phrase-menu-v1:" + id, "done").run();
}
__name(syncCommandMenu, "syncCommandMenu");
__name2(syncCommandMenu, "syncCommandMenu");
async function migrateCommandMenus(env, s, telegram2) {
  const globalKey = "phrase-menu-v1:global";
  if (!await q(env, "SELECT value FROM bot_runtime WHERE key=?1", globalKey).first()) {
    for (const type of ["default", "all_private_chats", "all_group_chats", "all_chat_administrators"])
      await telegram2(env, "deleteMyCommands", { scope: { type } });
    if (s.group_id)
      for (const type of ["chat", "chat_administrators"])
        await telegram2(env, "deleteMyCommands", { scope: { type, chat_id: s.group_id } });
    await q(env, "INSERT OR REPLACE INTO bot_runtime(key,value) VALUES(?1,?2)", globalKey, "done").run();
  }
  const members = await rows(env, "SELECT telegram_id FROM bot_members m WHERE NOT EXISTS(SELECT 1 FROM bot_runtime r WHERE r.key='phrase-menu-v1:'||m.telegram_id) ORDER BY telegram_id LIMIT 8");
  for (const m of members)
    try {
      await syncCommandMenu(env, m.telegram_id, s, false, telegram2);
    } catch (e) {
      if (![400, 403].includes(e.telegramCode))
        throw e;
      await q(env, "INSERT OR REPLACE INTO bot_runtime(key,value) VALUES(?1,?2)", "phrase-menu-v1:" + m.telegram_id, "unavailable").run();
    }
}
__name(migrateCommandMenus, "migrateCommandMenus");
__name2(migrateCommandMenus, "migrateCommandMenus");
var buttons = /* @__PURE__ */ __name2((items) => ({ inline_keyboard: items.map(([text, callback_data]) => [{ text, callback_data }]) }), "buttons");
var date = /* @__PURE__ */ __name2((value) => value ? new Date(value * 1e3).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "No expiration", "date");
var save = /* @__PURE__ */ __name2((env, id, state, data) => q(env, "INSERT INTO bot_conversations VALUES(?1,?2,?3,?4) ON CONFLICT(telegram_id) DO UPDATE SET state=excluded.state,json=excluded.json,updated_at=excluded.updated_at", id, state, JSON.stringify(data), now()).run(), "save");
var clear = /* @__PURE__ */ __name2((env, id) => q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run(), "clear");
var summary = /* @__PURE__ */ __name2((user) => `${user.username}
Status: ${user.status === "active" && user.expires_at && user.expires_at <= now() ? "expired" : user.status}
Expires: ${date(user.expires_at)}
Login limit: ${user.max_sessions}
Telegram: ${user.telegram_id ? `${user.telegram_username ? "@" + user.telegram_username + " \xB7 " : ""}${user.telegram_id}` : "Not linked"}`, "summary");
async function linkedUser(env, id, admin = false) {
  const m = await q(env, "SELECT * FROM bot_members WHERE telegram_id=?1", id).first();
  if (m?.blocked)
    fail("This Telegram identity is blocked from app-account access. The panel owner must review the account before these tools can be used.", 403);
  if (!m?.account_id)
    fail((admin ? "Your Telegram admin status is recognized, but your Telegram identity is not linked to an authorized app/panel admin account." : "No verified app account is linked.") + "\n\n" + telegramLinkHelp(admin), 403);
  const user = await q(env, "SELECT * FROM users WHERE id=?1", m.account_id).first();
  if (!user)
    fail("The linked account is unavailable.", 404);
  return { ...user, telegram_id: id, telegram_username: m.username };
}
__name(linkedUser, "linkedUser");
__name2(linkedUser, "linkedUser");
async function adminApi(env, id, s) {
  if (!await currentTelegramAdmin(env, id, s, telegram))
    fail("Only current group admins can access these commands.", 403);
  const user = await linkedUser(env, id, true);
  if (user.role !== "admin" || user.status !== "active")
    fail("Link your authorized panel administrator account through the app first. Group membership alone does not grant account-management permissions.", 403);
  const auth = await resolveAdminAccess(env, user);
  const call = /* @__PURE__ */ __name2(async (path, method = "GET", body) => {
    const response = await handleAdminRequest(new Request("https://internal" + path, { method, ...body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {} }), env, { ...accountAdminHelpers(), requireUser: /* @__PURE__ */ __name(async () => ({ ok: true, user }), "requireUser") });
    const result = await response.json();
    if (!response.ok || !result.success)
      fail(result.error || "The action could not be completed.", response.status);
    return result;
  }, "call");
  return { call, auth };
}
__name(adminApi, "adminApi");
__name2(adminApi, "adminApi");
async function resolveUser(call, identifier) {
  const found = await call("/admin/users?search=" + encodeURIComponent(identifier.replace(/^@/, "")) + "&page_size=100");
  const needle = identifier.replace(/^@/, "").toLowerCase();
  const matches = found.users.filter((u) => [u.username, u.telegram_id, u.telegram_username].some((v) => String(v || "").toLowerCase() === needle));
  if (matches.length !== 1)
    fail(matches.length ? "Multiple accounts match. Use the exact app username." : "No account in your permitted scope matches that identifier.", 404);
  return (await call("/admin/users/" + matches[0].id)).user;
}
__name(resolveUser, "resolveUser");
__name2(resolveUser, "resolveUser");
async function selfAction(env, id, command, confirmed = false) {
  if (command === "invite_status") {
    const invite = await q(env, "SELECT i.status,i.expires_at,i.redeemed_at FROM invites i JOIN bot_members m ON m.invite_id=i.id WHERE m.telegram_id=?1 AND m.blocked=0", id).first();
    return send(env, id, invite ? `Invitation: ${invite.status === "unused" && invite.expires_at && invite.expires_at <= now() ? "expired" : invite.status}
Unused code expiry: ${date(invite.expires_at)}${invite.redeemed_at ? "\nRedeemed: " + date(invite.redeemed_at) : ""}` : "No available bot invitation is associated with your Telegram account.");
  }
  const user = await linkedUser(env, id), t = now();
  if (command === "sign_out_all" || command === "unlink_my_account") {
    if (!confirmed) {
      await save(env, id, "self:confirm", { command, userId: user.id });
      return send(env, id, command === "sign_out_all" ? "Sign out every app session? You will need your app password to sign in again." : "Remove your Telegram recovery link? Automatic password recovery will stop. Make sure you know your app password. Linking again requires proof of account ownership.", buttons([["Confirm", "self:confirm"], ["Cancel", "self:cancel"]]));
    }
    if (command === "sign_out_all")
      await q(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", user.id).run();
    else {
      const key = "unlink-cooldown:" + user.id, previous = await q(env, "SELECT value FROM bot_runtime WHERE key=?1", key).first();
      if (previous && Number(previous.value) > t - 86400)
        fail("Telegram unlinking is limited to once every 24 hours.", 429);
      await env.DB.batch([q(env, "UPDATE bot_members SET account_id=NULL,ever_assigned=1 WHERE telegram_id=?1 AND account_id=?2", id, user.id), q(env, "UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND status IN('waiting','approved')", user.id), q(env, "INSERT INTO bot_runtime(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, String(t))]);
    }
    await accountAdminHelpers().audit(env, user.id, null, command, null);
    await event(env, id, command, user.id);
    return send(env, id, command === "sign_out_all" ? "All app sessions have been signed out." : "Telegram recovery was unlinked. Your app account still exists.");
  }
  if (command === "my_sessions") {
    const count = await q(env, "SELECT COUNT(*) n FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?2", user.id, t).first();
    return send(env, id, `${user.username}
Active sessions: ${count.n}
Login limit: ${user.max_sessions}`, buttons([["Sign out all", "sign_out_all"], ["User Commands", "user_commands"]]));
  }
  if (command === "my_security") {
    const reset = await q(env, "SELECT completed_at FROM account_reset_cooldown WHERE user_id=?1", user.id).first();
    return send(env, id, `${user.username}
Verified Telegram ID: ${id}
Last self-service reset: ${reset ? date(reset.completed_at) : "None recorded"}
Reset requests: up to three per hour. One successful self-service reset per 24 hours. Your password is entered only in the app.`, buttons([["User Commands", "user_commands"]]));
  }
  return send(env, id, summary(user), buttons([["Sessions", "my_sessions"], ["Security", "my_security"], ["User Commands", "user_commands"]]));
}
__name(selfAction, "selfAction");
__name2(selfAction, "selfAction");
async function accountManagement(env, id, text, cmd, s, message) {
  const raw = text.replace(/^\/start(?:@\w+)?\s+manage_/, "/").replace(/^mr\.?\s*charm\s*/i, "").replace(/^\//, "").replace(/^([a-z_]+)@\w+\b/i, "$1").trim();
  const self = ACCOUNT_COMMANDS.find((c) => cmd === c.id || raw.toLowerCase() === c.phrase);
  const canonical = /* @__PURE__ */ __name2((c) => (BOT_COMMANDS.find((x) => x.id === c.id)?.phrase || c.phrase).toLowerCase(), "canonical");
  let command = ADMIN_ACCOUNT_COMMANDS.find((c) => raw.toLowerCase() === canonical(c) || raw.toLowerCase().startsWith(canonical(c) + " ") || cmd === c.id || raw.toLowerCase() === c.command || raw.toLowerCase() === c.phrase || raw.toLowerCase().startsWith(c.phrase + " ") || raw.toLowerCase().startsWith(c.command + " "));
  if (self && !command?.usage) {
    await selfAction(env, id, self.id);
    return true;
  }
  if (self && raw.toLowerCase() === self.phrase) {
    await selfAction(env, id, self.id);
    return true;
  }
  const state = await q(env, "SELECT * FROM bot_conversations WHERE telegram_id=?1", id).first();
  if (cmd === "self:cancel" || cmd === "manage:cancel") {
    await clear(env, id);
    await send(env, id, "Canceled.", buttons([["User Commands", "user_commands"]]));
    return true;
  }
  if (cmd === "self:confirm") {
    if (!state || state.state !== "self:confirm" || state.updated_at < now() - 600)
      fail("This confirmation expired. Start again.", 409);
    const data2 = JSON.parse(state.json);
    if ((await linkedUser(env, id)).id !== data2.userId)
      fail("Your account link changed. Start again.", 409);
    await clear(env, id);
    await selfAction(env, id, data2.command, true);
    return true;
  }
  let args = command ? [canonical(command), command.phrase, command.command].filter((prefix) => raw.toLowerCase().startsWith(prefix + " ")).map((prefix) => raw.slice(prefix.length).trim())[0] || "" : "";
  if (cmd === "manage:confirm") {
    if (!state || state.state !== "manage:confirm" || state.updated_at < now() - 600)
      fail("This confirmation expired. Start again.", 409);
    const data2 = JSON.parse(state.json), api = await adminApi(env, id, s);
    const claimed = await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1 AND state=?2 AND json=?3", id, state.state, state.json).run();
    if (!claimed.meta.changes)
      fail("This action was already handled.", 409);
    if (data2.targetId)
      await api.call("/admin/users/" + data2.targetId);
    if (data2.custom === "link") {
      if (!api.auth.isOwner && !api.auth.profile.can_reset_password)
        fail("Account recovery permission is required.", 403);
      const member2 = await q(env, "SELECT account_id,blocked FROM bot_members WHERE telegram_id=?1", data2.telegramId).first();
      if (!member2 || member2.blocked || member2.account_id && member2.account_id !== data2.targetId)
        fail("The target Telegram identity is unavailable or already linked.", 409);
      const live = await telegram(env, "getChatMember", { chat_id: s.group_id, user_id: Number(data2.telegramId) });
      if (!["member", "administrator", "creator"].includes(live.status) && !(live.status === "restricted" && live.is_member))
        fail("The target must be an approved room member.", 403);
      const changed2 = await env.DB.batch([q(env, "UPDATE bot_members SET account_id=NULL WHERE account_id=?1 AND telegram_id<>?2 AND EXISTS(SELECT 1 FROM bot_members m WHERE m.telegram_id=?2 AND m.blocked=0 AND (m.account_id IS NULL OR m.account_id=?1))", data2.targetId, data2.telegramId), q(env, "UPDATE bot_members SET account_id=?1,ever_assigned=1,updated_at=?3 WHERE telegram_id=?2 AND blocked=0 AND (account_id IS NULL OR account_id=?1)", data2.targetId, data2.telegramId, now()), q(env, "UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND status IN('waiting','approved') AND EXISTS(SELECT 1 FROM bot_members m WHERE m.telegram_id=?2 AND m.account_id=?1)", data2.targetId, data2.telegramId), q(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1 AND EXISTS(SELECT 1 FROM bot_members m WHERE m.telegram_id=?2 AND m.account_id=?1)", data2.targetId, data2.telegramId)]);
      if (!changed2[1].meta.changes)
        fail("The Telegram link changed. Start again.", 409);
    } else if (data2.custom === "unlink") {
      if (!api.auth.isOwner && !api.auth.profile.can_reset_password)
        fail("Account recovery permission is required.", 403);
      await env.DB.batch([q(env, "UPDATE bot_members SET account_id=NULL,ever_assigned=1 WHERE account_id=?1", data2.targetId), q(env, "UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND status IN('waiting','approved')", data2.targetId)]);
    } else {
      const result = await api.call(data2.path, data2.method, data2.body);
      if (result.invite?.invite_code)
        await send(env, id, "New app invitation: " + result.invite.invite_code + "\nShare it privately with its intended recipient.");
    }
    await accountAdminHelpers().audit(env, data2.targetId || null, api.auth.user.id, "telegram_admin_" + data2.command, JSON.stringify({ telegram_id: id, admin_username: api.auth.user.username, target: data2.targetId || data2.path, result: "completed" }));
    await event(env, id, "admin_action_completed", data2.command + ":" + (data2.targetId || data2.path), api.auth.user.id);
    await send(env, id, "Completed: " + data2.label, buttons([["Admin Commands", "admin"]]));
    return true;
  }
  if (!command && state?.state === "manage:input" && addressedText(text)) {
    env = { ...env, BOT_NAVIGATION: { userId: id, parent: "admin" } };
    if (state.updated_at < now() - 600) {
      await clear(env, id);
      fail("This admin request expired. Start again.", 409);
    }
    const data2 = JSON.parse(state.json);
    command = ADMIN_ACCOUNT_COMMANDS.find((c) => c.id === data2.command);
    args = addressedText(text).trim();
  }
  if (!command)
    return false;
  if (command.command === "bot_status") {
    if (!await currentTelegramAdmin(env, id, s, telegram))
      fail("Only current group admins can access these commands.", 403);
    await clear(env, id);
    await send(env, id, `Mr. Charm: ${s.enabled ? "Enabled" : "Disabled"}
Account requests: ${s.accounts_enabled ? "Enabled" : "Paused"}
Downloads: ${s.downloads_enabled ? "Enabled" : "Paused"}
Private replies remain until your next private action. Recipient-only group replies expire after ten minutes.`, buttons([["Admin Commands", "admin"]]));
    return true;
  }
  const { call, auth } = await adminApi(env, id, s);
  if (command.command === "userinfo" && message.reply_to_message?.from)
    args = String(message.reply_to_message.from.id);
  if (["link_account", "relink_account"].includes(command.command) && message.reply_to_message?.from && args && !/\s/.test(args))
    args += " " + message.reply_to_message.from.id;
  const readOnly = ["userinfo", "search_user", "user_status", "user_sessions", "invite_info", "recent_users", "recent_links", "user_audit", "bot_status", "bot_stats"].includes(command.command);
  if (env.BOT_GROUP_REPLY && (!readOnly || command.usage && !args)) {
    if (args)
      await save(env, id, "manage:resume", { command: command.id, args });
    await send(env, id, "Continue privately to use " + command.label + ".", { inline_keyboard: [[{ text: "Open private Admin Commands", url: "https://t.me/" + s.bot_username + "?start=" + command.id }]] });
    return true;
  }
  if (!env.BOT_GROUP_REPLY && !args && state?.state === "manage:resume" && state.updated_at >= now() - 600) {
    const saved = JSON.parse(state.json);
    if (saved.command === command.id)
      args = saved.args;
  }
  if (command.usage && !args) {
    await save(env, id, "manage:input", { command: command.id });
    await send(env, id, `${command.label}
${command.description}${["link_account", "relink_account"].includes(command.command) ? "\n\n" + ADMIN_LINK_STEPS[1] : ""}

Usage: ${BOT_COMMANDS.find((x) => x.id === command.id)?.label || "Mr Charm " + command.phrase} ${command.usage}
Begin your reply with Mr Charm, then enter ${command.usage}. Never send passwords.`, buttons([["Cancel", "manage:cancel"]]));
    return true;
  }
  await clear(env, id);
  const parts = args.split(/\s+/), name = parts[0], extra = parts.slice(1).join(" "), key = command.command;
  let action = null;
  if (key === "recent_users" || key === "search_user") {
    const data2 = await call("/admin/users?page_size=10&search=" + encodeURIComponent(key === "search_user" ? args : ""));
    await send(env, id, data2.users.length ? data2.users.map(summary).join("\n\n") : "No accounts in your permitted scope match.");
    return true;
  }
  if (key === "bot_stats") {
    const data2 = await call("/admin/dashboard");
    await send(env, id, "Account statistics\n" + JSON.stringify(data2.stats || data2, null, 2).slice(0, 3e3));
    return true;
  }
  if (key === "recent_links") {
    const data2 = await call("/admin/users?page_size=100");
    const allowed = new Set(data2.users.map((u) => u.id));
    const links = await rows(env, "SELECT account_id,telegram_id,username,updated_at FROM bot_members WHERE account_id IS NOT NULL ORDER BY updated_at DESC LIMIT 100");
    await send(env, id, links.filter((l) => allowed.has(l.account_id)).slice(0, 15).map((l) => `${data2.users.find((u) => u.id === l.account_id).username} \xB7 @${l.username || "no_username"} \xB7 ${l.telegram_id}`).join("\n") || "No linked accounts in the current account list.");
    return true;
  }
  if (key === "create_app_invite")
    action = { path: "/admin/invites", method: "POST", body: { account_duration_days: Number(name), max_sessions: Number(extra), invite_expires_days: 7 } };
  else if (key === "invite_info" || key === "cancel_invite") {
    const data2 = await call("/admin/invites?search=" + encodeURIComponent(name));
    const invite = data2.invites.find((i) => i.invite_code === name.toUpperCase());
    if (!invite)
      fail("Invitation not found in your permitted scope.", 404);
    if (key === "invite_info") {
      await send(env, id, `Invitation ${invite.invite_code}
Status: ${invite.status}
Expires: ${date(invite.expires_at)}
Login limit: ${invite.max_sessions}`);
      return true;
    }
    action = { path: "/admin/invites/" + invite.id + "/revoke", method: "POST", body: {} };
  } else {
    const user = await resolveUser(call, name), base = "/admin/users/" + user.id;
    if (["userinfo", "user_status"].includes(key)) {
      await send(env, id, summary(user));
      return true;
    }
    if (key === "user_sessions") {
      const count = await q(env, "SELECT COUNT(*) n FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?2", user.id, now()).first();
      await send(env, id, `${user.username}
Active sessions: ${count.n}
Login limit: ${user.max_sessions}`);
      return true;
    }
    if (key === "user_audit") {
      if (!auth.isOwner && !auth.profile.can_view_audit)
        fail("Audit permission is required.", 403);
      const events = await rows(env, "SELECT action,created_at FROM audit_log WHERE user_id=?1 ORDER BY id DESC LIMIT 15", user.id);
      await send(env, id, user.username + "\n" + events.map((e) => date(e.created_at) + " \xB7 " + e.action).join("\n"));
      return true;
    }
    if (key === "reset_user_password") {
      await send(env, id, `For ${user.username}: open Users \u2192 Manage \u2192 Verified account recovery in the private admin panel. Verify ownership and enter your admin password there. Give the one-time recovery code only to the verified owner; they set their new password in the app. Never type passwords into Telegram.`, { inline_keyboard: [[{ text: "Open admin panel", url: "https://charmiptv-admin.agentleakage.workers.dev" }]] });
      return true;
    }
    action = { targetId: user.id, path: base, method: "PATCH", body: {} };
    if (["signout_user", "revoke_sessions"].includes(key))
      Object.assign(action, { path: base + "/logout", method: "POST" });
    else if (["disable_account", "enable_account"].includes(key))
      action.body = { status: key === "disable_account" ? "disabled" : "active" };
    else if (key === "delete_account")
      Object.assign(action, { method: "DELETE", body: { confirmation: user.username } });
    else if (key === "extend_user")
      action.body = { extend_days: Number(extra) };
    else if (key === "set_limit")
      action.body = { max_sessions: Number(extra) };
    else if (key === "set_expiration") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(extra))
        fail("Use YYYY-MM-DD.");
      action.body = { expires_at: Math.floor(Date.parse(extra + "T23:59:59Z") / 1e3) };
    } else if (["ban_user", "unban_user"].includes(key)) {
      if (!user.telegram_id)
        fail("This account has no verified Telegram link.");
      Object.assign(action, { path: "/admin/bot/members/" + user.telegram_id, method: "PATCH", body: { action: key === "ban_user" ? "ban_both" : "unban_both" } });
    } else if (key === "unlink_account")
      action.custom = "unlink";
    else if (key === "link_account" || key === "relink_account") {
      if (!/^\d{5,20}$/.test(extra))
        fail("Supply the permanent Telegram numeric ID after the app username, or reply to that member in the room.");
      if (key === "link_account" && user.telegram_id)
        fail("This account is linked already. Use Relink after verifying ownership.");
      const target = await telegram(env, "getChatMember", { chat_id: s.group_id, user_id: Number(extra) });
      if (target.user?.is_bot)
        fail("An app account must belong to a person.");
      action.custom = "link";
      action.telegramId = extra;
      action.identity = [target.user?.first_name, target.user?.last_name, target.user?.username ? "@" + target.user.username : "", extra].filter(Boolean).join(" \xB7 ");
    } else
      fail("This admin action is unavailable.");
  }
  const label = command.label + " \xB7 " + (args || ""), data = { ...action, command: key, label };
  await save(env, id, "manage:confirm", data);
  await send(env, id, `Confirm ${label}?
${action.custom ? "Confirm only after verifying that this Telegram identity belongs to the app account owner.\n" : ""}${action.identity ? "Telegram: " + action.identity + "\n" : ""}${key === "delete_account" ? "This permanently deletes account data.\n" : ""}Change: ${JSON.stringify(action.body)}
This confirmation expires in ten minutes.`, buttons([["Confirm", "manage:confirm"], ["Cancel", "manage:cancel"]]));
  return true;
}
__name(accountManagement, "accountManagement");
__name2(accountManagement, "accountManagement");
var HOME_COMMANDS = ["website", "guide", "downloads", "account", "troubleshooting", "rules", "contact", "about", "app_help", "whats_new", "status"];
var COMMAND_MENUS = [
  { id: "menu:admin:moderation", admin: true, label: "\u{1F462} Group moderation", description: "Kick a member or mute them temporarily. Current Telegram permissions are checked each time.", commands: ["admin_kick", "admin_mute"] },
  { id: "menu:user:account", label: "\u{1F464} My account", description: "Check your account, devices and security.", commands: ["my_account", "account_status", "my_sessions", "sign_out_all", "my_security"] },
  { id: "menu:user:recovery", label: "\u{1F510} Login & recovery", description: "Recover access or manage your Telegram link.", commands: ["linking:user", "forgot_password", "link_telegram", "unlink_my_account"] },
  { id: "menu:user:access", label: "\u{1F39F} Invitations & access", description: "Request access, confirm registration or check your invitation.", commands: ["request_access", "confirm_registration", "token", "invite_status"] },
  { id: "menu:user:help", label: "\u{1F4FA} App help", description: "Download the app and get help using it.", commands: ["guide", "downloads", "account", "troubleshooting", "app_help"] },
  { id: "menu:user:community", label: "\u{1F4AC} Community", description: "Find rules, support contacts and service information.", commands: ["website", "rules", "contact", "about", "whats_new", "status"] },
  { id: "menu:admin:find", admin: true, label: "\u{1F50E} Find accounts", description: "Find members and review account information.", commands: ["manage_search_user", "manage_userinfo", "manage_user_status", "manage_recent_users", "manage_recent_links", "manage_bot_stats", "manage_user_audit"] },
  { id: "menu:admin:access", admin: true, label: "\u{1F6E1} Access controls", description: "Enable, disable or remove access with confirmation.", commands: ["manage_disable_account", "manage_enable_account", "manage_ban_user", "manage_unban_user", "manage_delete_account"] },
  { id: "menu:admin:limits", admin: true, label: "\u{1F4C5} Time & login limits", description: "Change account expiration and simultaneous login limits.", commands: ["manage_extend_user", "manage_set_expiration", "manage_set_limit"] },
  { id: "menu:admin:sessions", admin: true, label: "\u{1F4F1} Sessions", description: "Review active logins or sign a user out.", commands: ["manage_user_sessions", "manage_signout_user", "manage_revoke_sessions"] },
  { id: "menu:admin:recovery", admin: true, label: "\u{1F517} Telegram & recovery", description: "Manage verified Telegram links and password recovery.", commands: ["linking:admin", "manage_link_account", "manage_relink_account", "manage_unlink_account", "manage_reset_user_password"] },
  { id: "menu:admin:invites", admin: true, label: "\u{1F39F} Invitations", description: "Manage app registration and Telegram room invitations.", commands: ["manage_create_app_invite", "manage_invite_info", "manage_cancel_invite", "admin_invite", "admin_invites", "admin_revoke"] },
  { id: "menu:admin:updates", admin: true, label: "\u{1F4E3} Updates & bot status", description: "Create an app update notice or check bot configuration.", commands: ["notify_update", "manage_bot_status", "usage", "update_report", "website_release"] }
];
var destinations = /* @__PURE__ */ new Set(["help", "admin", "user_commands", "account", "troubleshooting", "contact", "usage", ...COMMAND_MENUS.map((m) => m.id)]);
function navigationDestination(command) {
  if (!command?.startsWith("nav:"))
    return null;
  const destination = command.slice(4);
  return destinations.has(destination) ? destination : null;
}
__name(navigationDestination, "navigationDestination");
__name2(navigationDestination, "navigationDestination");
function navigationParent(command) {
  if (command === "help")
    return null;
  if (command === "admin" || command === "user_commands")
    return "help";
  const menu = COMMAND_MENUS.find((m) => m.id === command);
  if (menu)
    return menu.admin ? "admin" : "user_commands";
  if (command?.startsWith("contact-admin:"))
    return "contact";
  if (command?.startsWith("issue:") || command?.startsWith("answer:"))
    return "troubleshooting";
  if (command?.startsWith("usage:"))
    return "usage";
  if (command?.startsWith("announce:") || command === "notify_update")
    return "menu:admin:updates";
  if (command?.startsWith("manage:"))
    return "admin";
  if (command?.startsWith("self:"))
    return "menu:user:account";
  if (command?.startsWith("flow:") || command === "access_direct")
    return "account";
  if (command?.startsWith("linking:"))
    return command === "linking:user" ? "menu:user:recovery" : "menu:admin:recovery";
  if (["website", "guide", "downloads", "account", "troubleshooting", "rules", "contact", "about", "app_help", "whats_new", "status"].includes(command))
    return "help";
  return COMMAND_MENUS.find((m) => m.commands.includes(command))?.id || "help";
}
__name(navigationParent, "navigationParent");
__name2(navigationParent, "navigationParent");
function withNavigation(env, id, markup2) {
  const nav = env.BOT_NAVIGATION;
  if (!nav || String(id) !== nav.userId || env.BOT_PUBLIC_HUMOR || !nav.parent)
    return markup2;
  const rows3 = (markup2?.inline_keyboard || []).map((row) => row.map((button) => ({ ...button })));
  for (const button of rows3.flat()) {
    if (button.callback_data === nav.parent) {
      button.text = "Back";
      button.callback_data = "nav:" + nav.parent;
    } else if (nav.parent !== "help" && button.callback_data === "help") {
      button.text = "\u{1F3E0} Main menu";
      button.callback_data = "nav:help";
    }
  }
  const buttons4 = [{ text: "Back", callback_data: "nav:" + nav.parent }];
  if (nav.parent !== "help")
    buttons4.push({ text: "\u{1F3E0} Main menu", callback_data: "nav:help" });
  const existing = new Set(rows3.flat().map((b) => b.callback_data));
  const missing = buttons4.filter((b) => !existing.has(b.callback_data));
  if (missing.length)
    rows3.push(missing);
  return { ...markup2, inline_keyboard: rows3 };
}
__name(withNavigation, "withNavigation");
__name2(withNavigation, "withNavigation");
var buttons2 = /* @__PURE__ */ __name2((items) => ({ inline_keyboard: items.map(([text, callback_data]) => [{ text, callback_data }]) }), "buttons");
var hours = /* @__PURE__ */ __name2((n) => (Number(n || 0) / 3600).toFixed(1) + " h", "hours");
async function report(env, id, text, reply_markup) {
  const message_id = env.BOT_CALLBACK_MESSAGE;
  if (!env.BOT_GROUP_REPLY && Number.isSafeInteger(message_id) && message_id > 0) {
    const body = { chat_id: id, message_id, text, reply_markup: withNavigation(env, id, reply_markup) };
    try {
      return await telegram(env, "editMessageText", body);
    } catch (error) {
      if (error.telegramCode === 400 && /message is not modified/i.test(error.description || "")) {
        await rememberResponse(env, "editMessageText", body, { message_id });
        return { message_id };
      }
      if (error.telegramCode !== 400 || !/not found|can't be edited|cannot be edited/i.test(error.description || ""))
        throw error;
    }
  }
  return send(env, id, text, reply_markup);
}
__name(report, "report");
__name2(report, "report");
async function usageCommand(env, id, cmd, s) {
  const { call, auth } = await adminApi(env, id, s);
  if (env.BOT_GROUP_REPLY)
    return send(env, id, "Open this report privately. Usage information is only available to authorized administrators.", { inline_keyboard: [[{ text: "\u{1F4CA} Open private report", url: "https://t.me/" + s.bot_username + "?start=" + (cmd === "website_release" ? "website_release" : cmd === "update_report" ? "update_report" : "usage") }]] });
  if (cmd === "website_release") {
    const { release: r } = await call("/admin/bot/release");
    return send(env, id, `\u{1F310} Website release
${r.version} \xB7 Build ${r.build}
${r.release_date} \xB7 ${(r.size_bytes / 1e6).toFixed(1)} MB
${r.title}

Panel \u2192 Mr Charm Control Center \u2192 App Release \u2192 Preview \u2192 Publish. Publishing does not send a group announcement.`, { inline_keyboard: [[{ text: "Open admin panel", url: "https://charmiptv-admin.agentleakage.workers.dev/" }], [{ text: "\u21A9 Admin Commands", callback_data: "admin" }]] });
  }
  if (cmd === "update_report") {
    const data = await accountUpdateReport(env, auth), text2 = formatAccountUpdateReport(data);
    const body = new FormData();
    body.set("chat_id", String(id));
    body.set("caption", "Private account update report. Save the text file before this bot message expires in 10 minutes. Versions are last reported, not a live installation check.");
    body.set("document", new Blob([text2], { type: "text/plain;charset=utf-8" }), "Charming-MediaLab-Account-Report-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".txt");
    body.set("reply_markup", JSON.stringify(withNavigation(env, id, buttons2([["Back", "nav:menu:admin:updates"], ["Main menu", "nav:help"]]))));
    const result = await telegramTransport(env, "sendDocument", body);
    await rememberResponse(env, "sendDocument", { chat_id: id }, result);
    return result;
  }
  const [, section = "menu", period = "30"] = cmd.split(":");
  const { usage: u } = await call("/admin/bot/usage?period=" + encodeURIComponent(period));
  const links = [["\u{1F4C4} Download Update & Link Report", "update_report"], ["\u{1F7E2} Online Now", "usage:online:" + period], ["\u{1F517} Linked Accounts", "usage:links:" + period], ["\u{1F3C6} Top 10 Watch Time", "usage:most:" + period], ["\u231B Least Watch Time", "usage:least:" + period], ["\u{1F4F1} Most App Visits", "usage:visits:" + period], ["\u{1F511} Most App Sign-ins", "usage:signins:" + period]];
  const heading = { menu: "Choose a report", online: "Online Now", links: "Linked Accounts", most: "Top 10 Watch Time", least: "Least Watch Time", visits: "Most App Visits", signins: "Most App Sign-ins" }[section] || "Choose a report";
  let text = `\u{1F4CA} App Usage \xB7 ${period === "all" ? "All time" : period === "1" ? "Today (UTC)" : period + " days"}
${heading}
Last refreshed: ${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)} UTC

`;
  if (section === "online") {
    const watching = u.online.filter((x) => x.playing);
    text += `Online: ${u.online_users} users
IPTV: ${u.iptv_users} \xB7 VOD: ${u.vod_users}
Playing: ${new Set(watching.map((x) => x.id)).size}

` + u.online.slice(0, 20).map((x) => `${x.username} \xB7 ${x.mode.toUpperCase()} \xB7 ${x.playing ? "playing" : "browsing"}`).join("\n");
    if (!u.online.length)
      text += "No reporting-enabled apps have checked in during the last 2 minutes. Users on older APKs may still be watching; they cannot appear in this report.\nInstall the new activity-reporting release (Android version code 26 or newer) to begin reporting.";
    if (watching.length) {
      const sorted = [...watching].sort((a, b) => a.started_at - b.started_at);
      text += `

Longest current playback: ${sorted[0].username} (${hours(Date.now() / 1e3 - sorted[0].started_at)})
Newest current playback: ${sorted.at(-1).username} (${hours(Date.now() / 1e3 - sorted.at(-1).started_at)})`;
    }
  } else if (section === "links")
    text += `Active accounts: ${u.accounts.active_accounts}
Telegram linked: ${u.accounts.linked_accounts}
Not linked: ${u.accounts.unlinked_accounts}`;
  else if (["most", "least", "visits", "signins"].includes(section)) {
    const data = u[section];
    text += data.length ? data.map((x, i) => `${i + 1}. ${x.username} \xB7 ${hours(x.watch_seconds)}
IPTV ${hours(x.iptv_seconds)} \xB7 VOD ${hours(x.vod_seconds)} \xB7 ${x.visits} app visits \xB7 ${x.signins} sign-ins`).join("\n\n") : "No measured playback yet.";
  } else
    text += "Choose a private report below.";
  text += `

Online means a heartbeat within 2 minutes. Rankings include measured playback, not idle menus. Least excludes zero-use accounts. App visits are observed returns after a 2-minute gap, not password logins. Sign-ins count distinct authenticated app sessions first observed since tracking began. Tracking began ${new Date(u.tracking_started_at * 1e3).toISOString().slice(0, 10)}; older builds do not report activity.`;
  return report(env, id, text, buttons2([...links, ["Today", "usage:" + section + ":1"], ["7 days", "usage:" + section + ":7"], ["30 days", "usage:" + section + ":30"], ["All time", "usage:" + section + ":all"], ["\u21A9 Admin Commands", "admin"]]));
}
__name(usageCommand, "usageCommand");
__name2(usageCommand, "usageCommand");
async function securityNotice(env, id, text, buttons4) {
  if (!id || !env.TELEGRAM_BOT_TOKEN)
    return;
  try {
    await send({ ...env, BOT_GROUP_REPLY: void 0, BOT_INTERACTION: { recipient: id, generation: crypto.randomUUID() } }, id, text, buttons4);
  } catch (error) {
    await event(env, id, "security_notice_failed", String(error.telegramCode || "delivery"));
  }
}
__name(securityNotice, "securityNotice");
__name2(securityNotice, "securityNotice");
var securityHash = /* @__PURE__ */ __name2(async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join(""), "securityHash");
var secret = /* @__PURE__ */ __name2(() => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join(""), "secret");
var shortCode = /* @__PURE__ */ __name2(() => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 31]).join(""), "shortCode");
var active = /* @__PURE__ */ __name2((user) => user && user.status === "active" && (user.expires_at === null || user.expires_at > now()), "active");
async function issueRecoveryGrant(env, user, actor, reason) {
  if (!active(user) || user.role !== "user")
    fail("Recovery is available only for active viewer accounts.", 403);
  if (typeof reason !== "string" || reason.trim().length < 15 || reason.length > 500)
    fail("Record how you verified the account owner (15\u2013500 characters).");
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase(), id = crypto.randomUUID(), t = now();
  await env.DB.batch([
    q(env, "UPDATE account_recovery_grants SET expires_at=?1 WHERE user_id=?2 AND used_at IS NULL", t, user.id),
    q(env, "INSERT INTO account_recovery_grants(id,user_id,token_hash,created_by,reason,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7)", id, user.id, await securityHash(raw), actor, reason.trim(), t, t + 3600)
  ]);
  await event(env, null, "verified_recovery_issued", user.id, actor);
  return { code: raw.match(/.{1,6}/g).join("-"), expires_at: t + 3600 };
}
__name(issueRecoveryGrant, "issueRecoveryGrant");
__name2(issueRecoveryGrant, "issueRecoveryGrant");
async function limit(env, key, max, seconds) {
  const hashed = await securityHash(key), window = Math.floor(now() / seconds);
  const result = await q(env, `INSERT INTO account_security_rate VALUES(?1,?2,1) ON CONFLICT(rate_key) DO UPDATE SET
 count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window
 WHERE window<>excluded.window OR count<?3`, hashed, window, max).run();
  if (!result.meta.changes)
    fail("Too many attempts. Please try again later.", 429);
}
__name(limit, "limit");
__name2(limit, "limit");
async function loadChallenge(env, token) {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token))
    fail("This request is unavailable. Start again in the app.", 404);
  const c = await q(env, "SELECT * FROM account_challenges WHERE token_hash=?1", await securityHash(token)).first();
  if (!c)
    fail("This request is unavailable. Start again in the app.", 404);
  if (c.expires_at <= now())
    fail("This request expired. Start again in the app.", 410);
  return c;
}
__name(loadChallenge, "loadChallenge");
__name2(loadChallenge, "loadChallenge");
async function securityApi(request, env, helpers) {
  const { json: json2, safeJson: safeJson2, requireUser: requireUser2, verifyPassword: verifyPassword2, hashPassword: hashPassword2, audit: audit2 } = helpers;
  const path = new URL(request.url).pathname;
  if (path === "/auth/registration-policy" && request.method === "POST") {
    const body = await safeJson2(request), code = String(body.invite_code || "").trim().toUpperCase();
    await limit(env, "registration-policy:" + (request.headers.get("CF-Connecting-IP") || "local"), 30, 600);
    const linked = await q(env, "SELECT m.telegram_id FROM bot_members m JOIN invites i ON i.id=m.invite_id WHERE i.invite_code=?1", code).first();
    return json2({ success: true, requires_telegram_approval: !!linked });
  }
  if (path === "/auth/community" && request.method === "GET") {
    const s = await settings(env), link = await q(env, "SELECT value FROM bot_runtime WHERE key='community_join_request_link'").first();
    return json2({ success: true, bot_username: s.bot_username, bot_url: "https://t.me/" + s.bot_username, community_url: link?.value || null });
  }
  if (path === "/me/password" && request.method === "POST") {
    const auth = await requireUser2(request, env);
    if (!auth.ok)
      return auth.response;
    await limit(env, "password:" + auth.user.id, 5, 3600);
    const body = await safeJson2(request), password = String(body.new_password || "");
    if (password.length < (auth.user.role === "admin" ? 12 : 8) || password.length > 256)
      fail("Choose a longer password, up to 256 characters.");
    if (!await verifyPassword2(String(body.current_password || ""), auth.user.password_hash))
      fail("The current password is incorrect.", 403);
    const changed2 = await env.DB.batch([
      q(env, "UPDATE users SET password_hash=?1 WHERE id=?2 AND password_hash=?3", await hashPassword2(password), auth.user.id, auth.user.password_hash),
      q(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1 AND id<>?2", auth.user.id, auth.session.id),
      q(env, "UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND kind='reset' AND status IN('waiting','approved')", auth.user.id)
    ]);
    if (!changed2[0].meta.changes)
      fail("Your account changed. Sign in again.", 409);
    await audit2(env, auth.user.id, null, "password_changed", null);
    return json2({ success: true, message: "Password changed. Other app sessions were signed out." });
  }
  if (path === "/me/security" && request.method === "GET") {
    const auth = await requireUser2(request, env);
    if (!auth.ok)
      return auth.response;
    const link = await q(env, "SELECT telegram_id,username,name FROM bot_members WHERE account_id=?1", auth.user.id).first();
    const activity = await rows(env, "SELECT action,created_at FROM audit_log WHERE user_id=?1 AND (action LIKE '%password%' OR action LIKE '%telegram%' OR action='login') ORDER BY created_at DESC LIMIT 20", auth.user.id);
    return json2({ success: true, telegram: link || null, activity });
  }
  if (path === "/auth/challenges" && request.method === "POST") {
    const body = await safeJson2(request), kind = String(body.kind || "");
    if (!["reset", "link", "access", "registration"].includes(kind))
      fail("Choose a supported account action.");
    await limit(env, "challenge-ip:" + (request.headers.get("CF-Connecting-IP") || "local"), 20, 3600);
    let user = null, telegramId = null, payload = {}, recovery = null;
    if (kind === "reset") {
      const login2 = String(body.login || "").trim().toLowerCase();
      if (!login2 || login2.length > 254)
        fail("Enter your username or email.");
      await limit(env, "reset:" + login2, 3, 3600);
      const candidate = await q(env, "SELECT * FROM users WHERE lower(username)=?1 OR lower(email)=?1", login2).first();
      if (body.recovery_code) {
        const code2 = String(body.recovery_code).replace(/[-\s]/g, "").toUpperCase();
        recovery = await q(env, "SELECT * FROM account_recovery_grants WHERE token_hash=?1 AND expires_at>?2 AND used_at IS NULL AND challenge_id IS NULL", await securityHash(code2), now()).first();
        if (!active(candidate) || !recovery || recovery.user_id !== candidate.id)
          fail("The recovery code is invalid, expired, or already used.", 403);
        user = candidate;
        payload = { recovery_id: recovery.id };
      }
      if (!recovery && active(candidate)) {
        const m = await q(env, "SELECT telegram_id FROM bot_members WHERE account_id=?1 AND blocked=0", candidate.id).first();
        const cooldown = await q(env, "SELECT completed_at FROM account_reset_cooldown WHERE user_id=?1", candidate.id).first();
        if (m && (!cooldown || cooldown.completed_at <= now() - 86400)) {
          user = candidate;
          telegramId = m.telegram_id;
        }
      }
    }
    if (kind === "link") {
      const auth = await requireUser2(request, env);
      if (!auth.ok)
        return auth.response;
      await limit(env, "link:" + auth.user.id, 3, 3600);
      if (!await verifyPassword2(String(body.current_password || ""), auth.user.password_hash))
        fail("The current password is incorrect.", 403);
      user = auth.user;
      const existing = await q(env, "SELECT telegram_id FROM bot_members WHERE account_id=?1", user.id).first();
      telegramId = existing?.telegram_id || null;
    }
    if (kind === "registration") {
      const code2 = String(body.invite_code || "").trim().toUpperCase(), username = String(body.username || "").trim().toLowerCase(), email = String(body.email || "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username) || !/^\S+@\S+\.\S+$/.test(email))
        fail("Enter your chosen username and email.");
      await limit(env, "registration:" + code2, 5, 3600);
      const inv = await q(env, "SELECT id,status,expires_at FROM invites WHERE invite_code=?1", code2).first();
      if (!inv || inv.status !== "unused" || inv.expires_at !== null && inv.expires_at <= now())
        fail("This invitation is unavailable.", 409);
      const m = await q(env, "SELECT telegram_id,blocked,account_id FROM bot_members WHERE invite_id=?1", inv.id).first();
      if (!m || m.blocked || m.account_id)
        fail("This invitation needs an administrator\u2019s review.", 409);
      telegramId = m.telegram_id;
      payload = { invite_id: inv.id, username, email };
    }
    const token = secret(), botToken = secret(), code = shortCode(), id = crypto.randomUUID(), t = now();
    const statements = [];
    if (recovery)
      statements.push(q(env, "UPDATE account_recovery_grants SET challenge_id=?1 WHERE id=?2 AND challenge_id IS NULL AND expires_at>?3", id, recovery.id, t));
    if (user)
      statements.push(q(env, "UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND kind=?2 AND status IN('waiting','approved')", user.id, kind));
    if (kind === "registration")
      statements.push(q(env, "UPDATE account_challenges SET status='canceled' WHERE telegram_id=?1 AND kind='registration' AND status IN('waiting','approved')", telegramId));
    statements.push(q(env, `INSERT INTO account_challenges(id,kind,user_id,telegram_id,token_hash,bot_hash,code_hash,payload,created_at,expires_at)
   VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`, id, kind, user?.id || null, telegramId, await securityHash(token), await securityHash(botToken), await securityHash(code), JSON.stringify(payload), t, t + 600));
    const created = await env.DB.batch(statements);
    if (recovery && !created[0].meta.changes) {
      await q(env, "UPDATE account_challenges SET status='canceled' WHERE id=?1", id).run();
      fail("This recovery code was already used. Contact your Admin.", 409);
    }
    const s = await settings(env);
    if (kind === "reset" && telegramId)
      await securityNotice(env, telegramId, "A password reset was requested for " + user.username + ". Approve only if you started it in Charming MediaLab. Never send your password here. This request expires in ten minutes.", { inline_keyboard: [[{ text: "Approve Reset", callback_data: "flow:yes:" + id }, { text: "Deny", callback_data: "flow:no:" + id }]] });
    return json2({ success: true, token, code: code.slice(0, 4) + "-" + code.slice(4), expires_at: t + 600, bot_username: s.bot_username, telegram_url: "https://t.me/" + s.bot_username + "?start=flow_" + botToken }, 201);
  }
  if (path === "/auth/challenges/status" && request.method === "POST") {
    const body = await safeJson2(request), c = await loadChallenge(env, body.token);
    return json2({ success: true, kind: c.kind, status: c.status, expires_at: c.expires_at });
  }
  if (path === "/auth/challenges/cancel" && request.method === "POST") {
    const body = await safeJson2(request), c = await loadChallenge(env, body.token);
    await q(env, "UPDATE account_challenges SET status='canceled' WHERE id=?1 AND status IN('waiting','approved')", c.id).run();
    return json2({ success: true });
  }
  if (path === "/auth/reset-password" && request.method === "POST") {
    const body = await safeJson2(request), c = await loadChallenge(env, body.token), password = String(body.new_password || "");
    if (c.kind !== "reset" || c.status !== "approved" || !c.user_id)
      fail("Approve this reset in your linked Telegram account first.", 403);
    const user = await q(env, "SELECT * FROM users WHERE id=?1", c.user_id).first();
    if (!active(user))
      fail("Account recovery requires administrator assistance.", 403);
    if (password.length < (user.role === "admin" ? 12 : 8) || password.length > 256)
      fail("Choose a longer password, up to 256 characters.");
    const completion = crypto.randomUUID(), hash = await hashPassword2(password), t = now(), recoveryId = JSON.parse(c.payload).recovery_id || null;
    const result = await env.DB.batch([
      q(env, `UPDATE account_challenges SET status='consumed',completion_id=?1 WHERE id=?2 AND kind='reset' AND status='approved' AND expires_at>?3
    AND ((?6 IS NULL AND EXISTS(SELECT 1 FROM bot_members WHERE account_id=?4 AND telegram_id=?5 AND blocked=0)
    AND NOT EXISTS(SELECT 1 FROM account_reset_cooldown WHERE user_id=?4 AND completed_at>?3-86400)) OR
    (?6 IS NOT NULL AND EXISTS(SELECT 1 FROM account_recovery_grants WHERE id=?6 AND user_id=?4 AND challenge_id=?2 AND expires_at>?3 AND used_at IS NULL)
    AND EXISTS(SELECT 1 FROM bot_members WHERE telegram_id=?5 AND blocked=0 AND (account_id IS NULL OR account_id=?4))))`, completion, c.id, t, c.user_id, c.telegram_id, recoveryId),
      q(env, "UPDATE bot_members SET account_id=NULL,blocked=1 WHERE account_id=?1 AND telegram_id<>?2 AND ?3 IS NOT NULL AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?4)", c.user_id, c.telegram_id, recoveryId, completion),
      q(env, "UPDATE bot_members SET account_id=?1,ever_assigned=1 WHERE telegram_id=?2 AND ?3 IS NOT NULL AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?4)", c.user_id, c.telegram_id, recoveryId, completion),
      q(env, "UPDATE account_recovery_grants SET used_at=?1 WHERE id=?2 AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?3)", t, recoveryId, completion),
      q(env, "UPDATE users SET password_hash=?1 WHERE id=?2 AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?3)", hash, c.user_id, completion),
      q(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1 AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?2)", c.user_id, completion),
      q(env, "INSERT INTO account_reset_cooldown SELECT ?1,?2 WHERE EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?3) ON CONFLICT(user_id) DO UPDATE SET completed_at=excluded.completed_at", c.user_id, t, completion),
      q(env, "UPDATE account_challenges SET status='canceled' WHERE user_id=?1 AND kind='reset' AND id<>?2 AND status IN('waiting','approved') AND EXISTS(SELECT 1 FROM account_challenges WHERE completion_id=?3)", c.user_id, c.id, completion)
    ]);
    if (!result[0].meta.changes)
      fail("This reset is no longer available. Start again or contact an Admin.", 409);
    await audit2(env, c.user_id, null, "password_reset_telegram_approved", null);
    if (recoveryId)
      await audit2(env, c.user_id, null, "telegram_identity_recovered", null);
    await securityNotice(env, c.telegram_id, "Your Charming MediaLab password was reset. All previous app sessions were signed out. If you did not do this, contact an Admin immediately.");
    return json2({ success: true, message: "Password reset. Sign in with your new password." });
  }
  return null;
}
__name(securityApi, "securityApi");
__name2(securityApi, "securityApi");
async function findBotChallenge(env, id, reference) {
  await limit(env, "bot-code:" + id, 8, 600);
  const normalized = reference.replace(/[-\s]/g, "").toUpperCase();
  const c = await q(env, "SELECT * FROM account_challenges WHERE bot_hash=?1 OR code_hash=?2", await securityHash(reference), await securityHash(normalized)).first();
  if (!c || c.expires_at <= now() || !["waiting", "approved"].includes(c.status))
    fail("This request expired or is unavailable. Start again in the app.", 410);
  if (c.telegram_id && c.telegram_id !== id)
    fail("Open this request using the Telegram account linked to it.", 403);
  if (c.kind === "reset" && !c.user_id)
    fail("Recovery could not be verified. Contact an Admin for help with legacy or lost Telegram access.", 403);
  return c;
}
__name(findBotChallenge, "findBotChallenge");
__name2(findBotChallenge, "findBotChallenge");
async function confirmBotChallenge(env, id, challengeId, approved) {
  const c = await q(env, "SELECT * FROM account_challenges WHERE id=?1", challengeId).first();
  if (!c || c.expires_at <= now() || c.status !== "waiting")
    fail("This request expired or was already handled.", 409);
  if (c.telegram_id !== id)
    fail("This request belongs to another Telegram account.", 403);
  const status = approved ? "approved" : "denied";
  if (approved && c.kind === "link") {
    const member2 = await q(env, "SELECT * FROM bot_members WHERE telegram_id=?1", id).first();
    if (!member2 || member2.blocked || member2.account_id && member2.account_id !== c.user_id)
      fail("This Telegram account cannot be linked. Contact an Admin.", 409);
    const linked = await q(env, "SELECT telegram_id FROM bot_members WHERE account_id=?1", c.user_id).first();
    if (linked && linked.telegram_id !== id)
      fail("A different Telegram account is linked. An Admin must verify recovery.", 409);
    const r = await env.DB.batch([
      q(env, "UPDATE account_challenges SET status='approved' WHERE id=?1 AND status='waiting' AND expires_at>?2", c.id, now()),
      q(env, "UPDATE bot_members SET account_id=?1 WHERE telegram_id=?2 AND (account_id IS NULL OR account_id=?1) AND blocked=0 AND EXISTS(SELECT 1 FROM account_challenges WHERE id=?3 AND status='approved')", c.user_id, id, c.id)
    ]);
    if (!r[0].meta.changes || !r[1].meta.changes)
      fail("The account link changed. Contact an Admin.", 409);
    await event(env, id, "telegram_link_verified", c.user_id);
  } else {
    const changed2 = await q(env, "UPDATE account_challenges SET status=?1 WHERE id=?2 AND status='waiting' AND expires_at>?3", status, c.id, now()).run();
    if (!changed2.meta.changes)
      fail("This request was already handled or expired.", 409);
  }
  return { ...c, status };
}
__name(confirmBotChallenge, "confirmBotChallenge");
__name2(confirmBotChallenge, "confirmBotChallenge");
var buttons3 = /* @__PURE__ */ __name2((items) => ({ inline_keyboard: items.map(([text, data]) => [{ text, callback_data: data }]) }), "buttons");
async function personalAdmission(env, id, s, applicationId) {
  const m = await q(env, "SELECT * FROM bot_members WHERE telegram_id=?1", id).first();
  if (!m || m.blocked)
    fail("An Admin must review your access.", 403);
  if (m.account_id)
    return send(env, id, "You already have an app account. Sign in, or choose Forgot Password in the app.", buttons3([["My Account", "account"], ["Recovery help", "forgot_password"]]));
  const live = await telegram(env, "getChatMember", { chat_id: s.group_id, user_id: Number(id) });
  if (isMember(live)) {
    await q(env, "UPDATE bot_members SET status=?1 WHERE telegram_id=?2", live.status === "restricted" ? "restricted_member" : live.status, id).run();
    const invitation2 = await assignToken(env, id, s);
    return send(env, id, invitation2 ? "You are already approved in the room. Your private app registration code is:\n" + invitation2.invite_code + "\n\nIn the app choose I Have an Invitation. Approve the registration here when prompted." : "An Admin must check your existing invitation before another account can be created.", buttons3([["My app invitation", "token"], ["Help", "help"]]));
  }
  let invitation = await q(env, "SELECT * FROM bot_group_invites WHERE telegram_id=?1 AND status IN('active','pending') AND (expires_at IS NULL OR expires_at>?2) ORDER BY created_at DESC LIMIT 1", id, now()).first();
  if (!invitation)
    invitation = await createGroupInvite(env, s, { telegram_id: id, recipient_label: m.name.slice(0, 100) || "New applicant", username: m.username, expires_at: now() + 86400, approved: true }, "application:" + id, "application:" + applicationId);
  return send(env, id, "Your personal room invitation is ready. Request to join. Mr Charm delivers your private setup instructions and registration token before automatically approving an eligible request. Delivery or eligibility problems remain pending for Admin review.\n\nThis link is tied to your Telegram account.", {
    inline_keyboard: [[{ text: "Request to join the room", url: invitation.invite_link }], [{ text: "Check my app invitation", callback_data: "token" }], [{ text: "Help", callback_data: "help" }]]
  });
}
__name(personalAdmission, "personalAdmission");
__name2(personalAdmission, "personalAdmission");
async function accountFlow(env, id, text, cmd, s) {
  env = { ...env, BOT_NAVIGATION: { userId: id, parent: "account" } };
  const start = text.match(/^\/start(?:@\w+)?\s+flow_([a-f0-9]{48})$/i);
  const phraseCode = text.trim().match(/^mr\.?\s+charm\s+(link my account|forgot password|request app access|confirm registration)\s+((?:[A-Z2-9]{4}[- ]?){2})$/i);
  const code = (phraseCode?.[2] || text.trim()).match(/^(?:[A-Z2-9]{4}[- ]?){2}$/i);
  const callback = cmd.match(/^flow:(yes|no):([a-f0-9-]{36})$/);
  if (callback) {
    let c;
    if (callback[1] === "yes") {
      const candidate = await q(env, "SELECT * FROM account_challenges WHERE id=?1", callback[2]).first();
      if (candidate && ["link", "registration"].includes(candidate.kind)) {
        const live = await telegram(env, "getChatMember", { chat_id: s.group_id, user_id: Number(id) });
        if (!isMember(live))
          fail("Your room join request must be approved first.", 403);
      }
    }
    c = await confirmBotChallenge(env, id, callback[2], callback[1] === "yes");
    if (c.status === "approved" && c.kind === "access")
      await personalAdmission(env, id, s, c.id);
    else
      await send(env, id, c.status === "denied" ? "Request declined. No account changes were authorized." : c.kind === "reset" ? "Approved. Return to the app and choose your new password. Never send your password to Telegram." : c.kind === "link" ? "Telegram is verified and linked. Return to Settings in the app." : "Registration approved. Return to the app to finish creating your account.", buttons3([["Help", "help"]]));
    return true;
  }
  if (start || code) {
    if (env.BOT_GROUP_REPLY) {
      await send(env, id, "Open Mr. Charm privately to enter your app request code.", { inline_keyboard: [[{ text: "Continue privately", url: "https://t.me/" + s.bot_username + "?start=help" }]] });
      return true;
    }
    const c = await findBotChallenge(env, id, start?.[1] || code[0]);
    if (phraseCode && c.kind !== { "link my account": "link", "forgot password": "reset", "request app access": "access", "confirm registration": "registration" }[phraseCode[1].toLowerCase()])
      fail("Use the full Mr Charm command shown with this request in your app.", 400);
    if (c.status === "approved") {
      if (c.kind === "access")
        await personalAdmission(env, id, s, c.id);
      else
        await send(env, id, "Already approved. Return to the app to continue.");
      return true;
    }
    if (!c.telegram_id) {
      const m = await q(env, "SELECT blocked,account_id FROM bot_members WHERE telegram_id=?1", id).first();
      if (m?.blocked)
        fail("An Admin must review your access.", 403);
      if (c.kind === "link" && m?.account_id && m.account_id !== c.user_id)
        fail("This Telegram account already belongs to another app account.", 409);
      const bound = await q(env, "UPDATE account_challenges SET telegram_id=?1 WHERE id=?2 AND telegram_id IS NULL AND status='waiting'", id, c.id).run();
      if (!bound.meta.changes)
        fail("This request was opened by another account. Start again in the app.", 409);
    }
    const payload = JSON.parse(c.payload), label = { reset: "reset your app password", link: "link Telegram to your signed-in app account", access: "request room and app access", registration: "register the app username " + payload.username }[c.kind];
    await send(env, id, "Did you just " + label + "?\n\nApprove only if you started this request on your own device. Approval expires with the app request after ten minutes.", buttons3([["Yes, this is my request", "flow:yes:" + c.id], ["No, decline", "flow:no:" + c.id]]));
    return true;
  }
  if (cmd === "access_direct") {
    await personalAdmission(env, id, s, crypto.randomUUID());
    return true;
  }
  if (["request_access", "forgot_password", "link_telegram", "confirm_registration"].includes(cmd)) {
    const instructions2 = cmd === "confirm_registration" ? "In the app choose I Have an Invitation and begin registration. Then send Mr Charm Confirm Registration followed by the request code shown in the app." : cmd === "request_access" ? "On the app sign-in screen choose Request App Access. Scan its QR code or send Mr Charm Request App Access followed by its request code." : cmd === "forgot_password" ? "On the app sign-in screen choose Forgot Password. Enter your username, then scan its QR or send Mr Charm Forgot Password followed by the request code. Use the Telegram account already linked to your app account." : telegramLinkHelp();
    await send(env, id, instructions2, buttons3([...cmd === "request_access" ? [["Apply here without a TV code", "access_direct"]] : [], ["Contact an Admin", "contact"], ["Help", "help"]]));
    return true;
  }
  return false;
}
__name(accountFlow, "accountFlow");
__name2(accountFlow, "accountFlow");
var SOURCE_IDS = ["primary", "secondary", "tertiary", "quaternary"];
var fail2 = /* @__PURE__ */ __name2((message, status = 400) => {
  throw Object.assign(new Error(message), { status });
}, "fail");
function validateControls(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail2("Invalid app settings.");
  if (Object.keys(input).some((k) => !["multiview_max", "provider_limits", "update", "revision"].includes(k)))
    fail2("Unknown app setting.");
  const max = input.multiview_max;
  if (!Number.isInteger(max) || max < 0 || max > 4)
    fail2("Multiview must be between 0 (disabled) and 4 panes.");
  const limits = input.provider_limits;
  if (!limits || Object.keys(limits).some((k) => !SOURCE_IDS.includes(k)))
    fail2("Invalid provider limits.");
  for (const id of SOURCE_IDS)
    if (!Number.isInteger(limits[id]) || limits[id] < 0 || limits[id] > 4)
      fail2("Provider pane limits must be 0 (unknown) through 4.");
  const update = input.update;
  if (!update || Object.keys(update).some((k) => !["version_code", "message", "url"].includes(k)) || !Number.isInteger(update.version_code) || update.version_code < 0 || update.version_code > 21e8)
    fail2("Invalid update settings.");
  if (typeof update.message !== "string" || richLength(update.message) > 3500 || typeof update.url !== "string" || update.url.length > 2048)
    fail2("Update message or link is too long.");
  if (update.url) {
    let parsed;
    try {
      parsed = new URL(update.url);
    } catch {
      fail2("Use a valid HTTPS update link.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
      fail2("Use an HTTPS update link without embedded credentials or fragments.");
  }
  if (update.version_code > 0 && (!update.message.trim() || !update.url))
    fail2("An update notice needs a message and HTTPS download page.");
  return { multiview_max: max, provider_limits: Object.fromEntries(SOURCE_IDS.map((k) => [k, limits[k]])), update: { version_code: update.version_code, message: update.message.trim(), url: update.url.trim() } };
}
__name(validateControls, "validateControls");
__name2(validateControls, "validateControls");
async function appControls(env) {
  const row = await env.DB.prepare("SELECT json,revision FROM app_controls WHERE id=1").first();
  return { ...validateControls(JSON.parse(row.json)), revision: row.revision };
}
__name(appControls, "appControls");
__name2(appControls, "appControls");
async function readSettings(request) {
  const reader = request.body?.getReader();
  if (!reader)
    fail2("A JSON object is required.");
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      length += value.byteLength;
      if (length > 65536) {
        await reader.cancel();
        fail2("App settings are too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail2("A valid JSON object is required.");
  }
}
__name(readSettings, "readSettings");
__name2(readSettings, "readSettings");
async function appControlsAdmin(request, env, auth, helpers) {
  const { json: json2, audit: audit2 } = helpers;
  if (!auth.isOwner)
    fail2("Only the owner can manage global app settings.", 403);
  if (request.method === "GET")
    return json2({ success: true, settings: await appControls(env), errors: (await env.DB.prepare("SELECT day,count,last_at FROM app_service_errors WHERE day>=?1 ORDER BY day DESC LIMIT 7").bind(Math.floor(Date.now() / 864e5) - 6).all()).results || [] });
  if (request.method !== "PUT")
    fail2("Method not allowed.", 405);
  const body = await readSettings(request), settings2 = validateControls(body);
  if (!Number.isInteger(body.revision) || body.revision < 0)
    fail2("Refresh the app settings before saving.");
  const result = await env.DB.prepare("UPDATE app_controls SET json=?1,revision=revision+1,updated_at=?2 WHERE id=1 AND revision=?3").bind(JSON.stringify(settings2), Math.floor(Date.now() / 1e3), body.revision).run();
  if (!result.meta?.changes)
    fail2("These settings changed in another tab. Refresh and try again.", 409);
  await audit2(env, null, auth.user.id, "app_controls_updated", null);
  return json2({ success: true, settings: await appControls(env) });
}
__name(appControlsAdmin, "appControlsAdmin");
__name2(appControlsAdmin, "appControlsAdmin");
async function recordServiceError(env) {
  const now2 = Math.floor(Date.now() / 1e3), day = Math.floor(now2 / 86400);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO app_service_errors(day,count,last_at) VALUES(?1,1,?2) ON CONFLICT(day) DO UPDATE SET count=count+1,last_at=excluded.last_at").bind(day, now2),
      env.DB.prepare("DELETE FROM app_service_errors WHERE day<?1").bind(day - 30)
    ]);
  } catch {
  }
}
__name(recordServiceError, "recordServiceError");
__name2(recordServiceError, "recordServiceError");
var bounded = /* @__PURE__ */ __name2((value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(label + " is outside the allowed range.");
  return value;
}, "bounded");
function validateAnnouncement(body, t = now()) {
  const title = String(body.title || "").trim(), message = String(body.message || "").trim(), url = String(body.url || "").trim();
  if (!title || title.length > 100 || !message || richLength(message) > 3500)
    fail("Enter a title up to 100 characters and message up to 3,500 characters.");
  if (!["update", "general"].includes(body.kind) || !["outdated", "all", "selected"].includes(body.audience))
    fail("Choose an announcement type and audience.");
  if (url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      fail("Enter a valid HTTPS release link.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || url.length > 2048)
      fail("Use an HTTPS release link without credentials or fragments.");
  }
  const version = bounded(body.version_code ?? 0, 0, 21e8, "Android version code");
  if (body.kind === "update" && (!version || !url))
    fail("Updates need the APK version code and a release link.");
  if (body.kind === "general" && body.audience === "outdated")
    fail("Choose everyone or selected accounts for a general announcement.");
  const starts = bounded(body.starts_at ?? t, 0, t + 90 * 86400, "Start time"), expires = bounded(body.expires_at ?? starts + 7 * 86400, starts + 60, starts + 90 * 86400, "Expiration");
  const reminder = bounded(body.reminder_hours ?? 24, 1, 168, "Reminder hours");
  const users = Array.isArray(body.user_ids) ? [...new Set(body.user_ids.map(String))] : [];
  if (users.length > 200 || users.some((id) => !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))
    fail("Select up to 200 valid accounts.");
  if (body.audience === "selected" && !users.length)
    fail("Select at least one account.");
  if (typeof body.sound !== "boolean")
    fail("Choose whether to play a chime.");
  return { title, message, url, kind: body.kind, audience: body.audience, version_code: version, starts_at: starts, expires_at: expires, reminder_hours: reminder, sound: body.sound, user_ids: body.audience === "selected" ? users : [] };
}
__name(validateAnnouncement, "validateAnnouncement");
__name2(validateAnnouncement, "validateAnnouncement");
var unpack = /* @__PURE__ */ __name2((row) => ({ ...JSON.parse(row.json), id: row.id, status: row.status, revision: row.revision, created_at: row.created_at, updated_at: row.updated_at }), "unpack");
async function saveAnnouncement(env, body, actor, id = null, revision = null) {
  const data = validateAnnouncement(body), t = now();
  if (data.user_ids.length) {
    const count = await q(env, "SELECT COUNT(*) n FROM users WHERE id IN (" + data.user_ids.map(() => "?").join(",") + ")", ...data.user_ids).first();
    if (count.n !== data.user_ids.length)
      fail("Some selected accounts are no longer available.");
  }
  if (id) {
    const r = await q(env, "UPDATE app_announcements SET json=?1,starts_at=?2,expires_at=?3,revision=revision+1,updated_at=?4 WHERE id=?5 AND revision=?6 AND status='draft'", JSON.stringify(data), data.starts_at, data.expires_at, t, id, revision).run();
    if (!r.meta.changes)
      fail("This draft changed or was published. Refresh it first.", 409);
  } else {
    id = crypto.randomUUID();
    await q(env, "INSERT INTO app_announcements(id,json,starts_at,expires_at,created_by,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)", id, JSON.stringify(data), data.starts_at, data.expires_at, actor, t).run();
  }
  await event(env, null, "app_announcement_draft_saved", id, actor);
  return unpack(await q(env, "SELECT * FROM app_announcements WHERE id=?1", id).first());
}
__name(saveAnnouncement, "saveAnnouncement");
__name2(saveAnnouncement, "saveAnnouncement");
async function publishAnnouncement(env, id, revision, actor) {
  const r = await q(env, "UPDATE app_announcements SET status='published',revision=revision+1,updated_at=?1 WHERE id=?2 AND revision=?3 AND status='draft' AND expires_at>?1", now(), id, revision).run();
  if (!r.meta.changes)
    fail("This draft changed, expired, or was already published. Refresh first.", 409);
  await event(env, null, "app_announcement_published", id, actor);
  return unpack(await q(env, "SELECT * FROM app_announcements WHERE id=?1", id).first());
}
__name(publishAnnouncement, "publishAnnouncement");
__name2(publishAnnouncement, "publishAnnouncement");
async function cancelAnnouncement(env, id, revision, actor) {
  const r = await q(env, "UPDATE app_announcements SET status='canceled',revision=revision+1,updated_at=?1 WHERE id=?2 AND revision=?3 AND status<>'canceled'", now(), id, revision).run();
  if (!r.meta.changes)
    fail("This announcement changed. Refresh first.", 409);
  await event(env, null, "app_announcement_canceled", id, actor);
}
__name(cancelAnnouncement, "cancelAnnouncement");
__name2(cancelAnnouncement, "cancelAnnouncement");
async function activeAnnouncements(env, userId, version) {
  const list = await rows(env, "SELECT * FROM app_announcements WHERE status='published' AND starts_at<=?1 AND expires_at>?1 ORDER BY created_at DESC LIMIT 50", now());
  return list.map(unpack).filter((a) => (a.audience !== "selected" || a.user_ids.includes(userId)) && (a.kind !== "update" || version === null || version < a.version_code)).slice(0, 10);
}
__name(activeAnnouncements, "activeAnnouncements");
__name2(activeAnnouncements, "activeAnnouncements");
async function legacyAnnouncementUpdate(env, userId) {
  const active2 = await activeAnnouncements(env, userId, null), a = active2.find((item) => item.kind === "update");
  return a ? { version_code: a.version_code, message: richPlain(a.message).slice(0, 3500), url: a.url } : null;
}
__name(legacyAnnouncementUpdate, "legacyAnnouncementUpdate");
__name2(legacyAnnouncementUpdate, "legacyAnnouncementUpdate");
async function announcementAdmin(request, env, auth, helpers) {
  if (!auth.isOwner && !auth.profile.can_manage_announcements)
    fail("Announcement permission is required.", 403);
  const { json: json2, safeJson: safeJson2 } = helpers, path = new URL(request.url).pathname, actor = auth.user.id;
  if (path === "/admin/announcements/recipients" && request.method === "GET") {
    const search = (new URL(request.url).searchParams.get("search") || "").trim().slice(0, 100);
    if (search.length < 2)
      return json2({ success: true, users: [] });
    const users = await rows(env, "SELECT id,username,status FROM users WHERE instr(lower(username),lower(?1))>0 ORDER BY username LIMIT 30", search);
    return json2({ success: true, users });
  }
  if (path === "/admin/announcements" && request.method === "GET") {
    const list = await rows(env, "SELECT * FROM app_announcements ORDER BY created_at DESC LIMIT 100");
    const reports = await rows(env, "SELECT announcement_id,COUNT(*) checked,SUM(displayed_at IS NOT NULL) displayed,SUM(dismissed_at IS NOT NULL) dismissed,SUM(opened_at IS NOT NULL) opened FROM app_announcement_receipts GROUP BY announcement_id");
    return json2({ success: true, announcements: list.map((r) => ({ ...unpack(r), report: reports.find((report2) => report2.announcement_id === r.id) || { checked: 0, displayed: 0, dismissed: 0, opened: 0 } })) });
  }
  if (path === "/admin/announcements" && request.method === "POST")
    return json2({ success: true, announcement: await saveAnnouncement(env, await safeJson2(request), actor) }, 201);
  const match = path.match(/^\/admin\/announcements\/([a-f0-9-]{36})(?:\/(publish|test))?$/);
  if (!match)
    fail("Announcement not found.", 404);
  const body = await safeJson2(request);
  if (match[2] === "publish" && request.method === "POST")
    return json2({ success: true, announcement: await publishAnnouncement(env, match[1], body.revision, actor) });
  if (match[2] === "test" && request.method === "POST") {
    const row = await q(env, "SELECT * FROM app_announcements WHERE id=?1", match[1]).first();
    if (!row)
      fail("Draft not found.", 404);
    const source = unpack(row), test = await saveAnnouncement(env, { ...source, title: "TEST \xB7 " + source.title.slice(0, 90), kind: "general", audience: "selected", user_ids: [actor], starts_at: now(), expires_at: now() + 600 }, actor);
    return json2({ success: true, announcement: await publishAnnouncement(env, test.id, test.revision, actor) });
  }
  if (request.method === "PUT")
    return json2({ success: true, announcement: await saveAnnouncement(env, body, actor, match[1], body.revision) });
  if (request.method === "DELETE") {
    await cancelAnnouncement(env, match[1], body.revision, actor);
    return json2({ success: true });
  }
  fail("Method not allowed.", 405);
}
__name(announcementAdmin, "announcementAdmin");
__name2(announcementAdmin, "announcementAdmin");
async function announcementClient(request, env, auth, helpers) {
  const { json: json2, safeJson: safeJson2 } = helpers, path = new URL(request.url).pathname;
  if (path === "/announcements" && request.method === "POST") {
    const body = await safeJson2(request), version = bounded(body.version_code, 1, 21e8, "Installed version"), list = await activeAnnouncements(env, auth.user.id, version);
    if (list.length)
      await env.DB.batch(list.map((a) => q(env, `INSERT INTO app_announcement_receipts(announcement_id,user_id,session_id,installed_version,checked_at) VALUES(?1,?2,?3,?4,?5)
   ON CONFLICT(announcement_id,session_id) DO UPDATE SET installed_version=excluded.installed_version,checked_at=excluded.checked_at`, a.id, auth.user.id, auth.session.id, version, now())));
    const legacy = (await appControls(env)).update;
    const output = list.map(({ user_ids, created_by, ...safe }) => ({ ...safe, message: richPlain(safe.message) }));
    if (legacy.version_code > version && legacy.url && !list.some((a) => a.kind === "update" && a.version_code === legacy.version_code))
      output.push({ id: "legacy:" + legacy.version_code, title: "Charming MediaLab update available", message: richPlain(legacy.message), url: legacy.url, version_code: legacy.version_code, kind: "update", expires_at: now() + 86400, reminder_hours: 24, sound: false });
    return json2({ success: true, announcements: output });
  }
  if (path === "/announcements/receipt" && request.method === "POST") {
    const body = await safeJson2(request), column = { displayed: "displayed_at", dismissed: "dismissed_at", opened: "opened_at" }[body.event];
    if (!column)
      fail("Unknown announcement event.");
    await q(env, "UPDATE app_announcement_receipts SET " + column + "=COALESCE(" + column + ",?1) WHERE announcement_id=?2 AND user_id=?3 AND session_id=?4", now(), body.id, auth.user.id, auth.session.id).run();
    return json2({ success: true });
  }
  fail("Method not allowed.", 405);
}
__name(announcementClient, "announcementClient");
__name2(announcementClient, "announcementClient");
var keyboard = /* @__PURE__ */ __name2((items) => ({ inline_keyboard: items.map(([text, value]) => [{ text, callback_data: "announce:" + value }]).concat([[{ text: "Cancel \xB7 Admin tools", callback_data: "admin" }]]) }), "keyboard");
async function store(env, id, step, data) {
  await q(env, "INSERT INTO bot_conversations VALUES(?1,?2,?3,?4) ON CONFLICT(telegram_id) DO UPDATE SET state=excluded.state,json=excluded.json,updated_at=excluded.updated_at", id, "announce:" + step, JSON.stringify(data), now()).run();
}
__name(store, "store");
__name2(store, "store");
async function botAnnouncementFlow(env, id, text, cmd, s) {
  env = { ...env, BOT_NAVIGATION: { userId: id, parent: "menu:admin:updates" } };
  const existing = await q(env, "SELECT * FROM bot_conversations WHERE telegram_id=?1", id).first();
  const draft = existing?.state.startsWith("announce:") ? existing : null;
  const addressed = text.match(/^\s*mr(?:\.\s*|\s+)charm\b[\s,:-]*(.*)$/is);
  if (cmd !== "notify_update" && !cmd.startsWith("announce:") && !(draft && addressed))
    return false;
  if (!await currentTelegramAdmin(env, id, s, telegram))
    fail("Only current group admins can create app announcements.", 403);
  if (env.BOT_GROUP_REPLY) {
    await send(env, id, "Continue privately to compose the update notice. Only you can see the setup.", { inline_keyboard: [[{ text: "Open private update editor", url: "https://t.me/" + s.bot_username + "?start=notify_update" }]] });
    return true;
  }
  if (cmd === "notify_update") {
    await store(env, id, "title", { kind: "update", version_code: 0, audience: "outdated", user_ids: [], sound: true, reminder_hours: 24 });
    await send(env, id, "Update announcement \xB7 private admin editor\n\nBegin each typed answer with Mr Charm. Enter the title. Example: Mr Charm A new Charming MediaLab update is available.\n\nNothing is sent until you preview and publish.", keyboard([]));
    return true;
  }
  if (!draft || now() - draft.updated_at > 600) {
    await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
    fail("This update editor expired. Choose Notify Update to start again.", 410);
  }
  const data = JSON.parse(draft.json), step = draft.state.slice(9), answer = cmd.startsWith("announce:") ? cmd.slice(9) : addressed?.[1].trim() || "";
  let next, prompt, choices = [];
  if (step === "title") {
    if (!answer || answer.length > 100)
      fail("Use a title of 1\u2013100 characters.");
    data.title = answer;
    next = "message";
    prompt = "Enter the message users should see (up to 3,500 characters).";
  } else if (step === "message") {
    if (!answer || answer.length > 3500)
      fail("Use a message of 1\u20133,500 characters.");
    data.message = answer;
    next = "version";
    prompt = "Enter the APK\u2019s Android version code. This is not the GitHub build number. Use the Android version code in your release guide (for example, 21).";
  } else if (step === "version") {
    const version = Number(answer);
    if (!Number.isSafeInteger(version) || version < 1 || version > 21e8)
      fail("Enter a valid positive Android version code.");
    data.version_code = version;
    next = "url";
    prompt = "Send the HTTPS link to the Telegram release message or download destination.";
  } else if (step === "url") {
    let url;
    try {
      url = new URL(answer);
    } catch {
      fail("Enter a valid HTTPS release link.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || answer.length > 2048)
      fail("Use an HTTPS link without embedded credentials.");
    data.url = answer;
    next = "audience";
    prompt = "Who should receive the update? Users who already installed this version will not be prompted.";
    choices = [["Everyone with an older version", "outdated"], ["Selected app accounts", "selected"]];
  } else if (step === "audience") {
    if (!["outdated", "selected"].includes(answer))
      fail("Choose an audience button.");
    data.audience = answer;
    next = answer === "selected" ? "users" : "start";
    prompt = answer === "selected" ? "Enter the app usernames, separated by commas." : "When should the announcement start?";
    choices = answer === "selected" ? [] : [["Now", "now"], ["Schedule a time", "schedule"]];
  } else if (step === "users") {
    const names = [...new Set(answer.toLowerCase().split(/[\s,]+/).filter(Boolean))];
    if (!names.length || names.length > 200)
      fail("Enter up to 200 usernames.");
    const accounts = await rows(env, "SELECT id FROM users WHERE lower(username) IN (" + names.map(() => "?").join(",") + ")", ...names);
    if (accounts.length !== names.length)
      fail("One or more usernames were not found. Check them and try again.");
    data.user_ids = accounts.map((a) => a.id);
    next = "start";
    prompt = "When should the announcement start?";
    choices = [["Now", "now"], ["Schedule a time", "schedule"]];
  } else if (step === "start") {
    if (answer === "schedule") {
      next = "datetime";
      prompt = "Enter a date and time with its timezone, for example 2026-09-20T18:00:00-04:00.";
    } else if (answer === "now") {
      data.starts_at = now();
      next = "duration";
      prompt = "How long should the announcement remain active?";
      choices = [["1 day", "1"], ["3 days", "3"], ["7 days \xB7 recommended", "7"], ["14 days", "14"], ["30 days", "30"]];
    } else
      fail("Choose Now or Schedule a time.");
  } else if (step === "datetime") {
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(answer))
      fail("Include the timezone offset, such as -04:00.");
    const time2 = Math.floor(Date.parse(answer) / 1e3);
    if (!Number.isSafeInteger(time2) || time2 < now() || time2 > now() + 90 * 86400)
      fail("Choose a future time within 90 days.");
    data.starts_at = time2;
    next = "duration";
    prompt = "How long should it remain active?";
    choices = [["1 day", "1"], ["7 days \xB7 recommended", "7"], ["14 days", "14"], ["30 days", "30"]];
  } else if (step === "duration") {
    const days = Number(answer);
    if (!Number.isInteger(days) || days < 1 || days > 90)
      fail("Choose 1\u201390 days.");
    data.expires_at = data.starts_at + days * 86400;
    next = "reminder";
    prompt = "After a user dismisses the popup, when may it remind them?";
    choices = [["6 hours", "6"], ["Tomorrow \xB7 recommended", "24"], ["2 days", "48"], ["7 days", "168"]];
  } else if (step === "reminder") {
    const hours2 = Number(answer);
    if (!Number.isInteger(hours2) || hours2 < 1 || hours2 > 168)
      fail("Choose 1\u2013168 hours.");
    data.reminder_hours = hours2;
    next = "sound";
    prompt = "Play a soft chime on first display? Playback and the user\u2019s sound preference take priority.";
    choices = [["Yes \xB7 one chime", "yes"], ["No sound", "no"]];
  } else if (step === "sound") {
    if (!["yes", "no"].includes(answer))
      fail("Choose Yes or No.");
    data.sound = answer === "yes";
    const saved = await saveAnnouncement(env, data, "telegram:" + id);
    data.draft_id = saved.id;
    data.revision = saved.revision;
    next = "preview";
    prompt = "PREVIEW \xB7 " + data.title + "\n\n" + data.message + "\n\nAPK version code: " + data.version_code + "\nAudience: " + (data.audience === "selected" ? data.user_ids.length + " selected accounts" : "Everyone running an older version") + "\nStart: " + new Date(data.starts_at * 1e3).toISOString() + "\nEnd: " + new Date(data.expires_at * 1e3).toISOString() + "\nReminder: " + data.reminder_hours + " hours\nChime: " + (data.sound ? "on" : "off") + "\nDestination: " + data.url + "\n\nPublish this announcement?";
    choices = [["Publish / schedule announcement", "publish"], ["Keep as draft", "draft"]];
  } else if (step === "preview") {
    if (answer === "publish") {
      await publishAnnouncement(env, data.draft_id, data.revision, "telegram:" + id);
      await send(env, id, "Announcement published. Eligible apps will receive it when they next connect, after its start time. No playback is interrupted.");
    } else if (answer === "draft")
      await send(env, id, "Draft saved. Find it in Updates & Announcements in the panel. Nobody has been notified.");
    else
      fail("Choose Publish or Keep as draft.");
    await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
    return true;
  } else
    return false;
  await store(env, id, next, data);
  await send(env, id, prompt + (!choices.length ? "\n\nBegin your typed reply with Mr Charm." : ""), keyboard(choices));
  return true;
}
__name(botAnnouncementFlow, "botAnnouncementFlow");
__name2(botAnnouncementFlow, "botAnnouncementFlow");
var isMember = /* @__PURE__ */ __name2((m) => ["member", "administrator", "creator"].includes(m.status) || m.status === "restricted" && m.is_member === true, "isMember");
async function telegram(env, method, body) {
  if (method === "deleteMessage" && await permanentAdminAnnouncement(env, body.chat_id, body.message_id))
    return true;
  if (!env.TELEGRAM_BOT_TOKEN)
    fail("Save TELEGRAM_BOT_TOKEN in Cloudflare first.", 503);
  body = brandedTelegramBody(body);
  if (body.reply_markup)
    body.reply_markup = commandButtons(body.reply_markup);
  const target = env.BOT_GROUP_REPLY;
  if (target && ["sendMessage", "sendRichMessage"].includes(method) && String(body.chat_id) === target.user_id) {
    body = { ...body, chat_id: target.chat_id, ...env.BOT_PUBLIC_HUMOR ? {} : { ephemeral_message_parameters: { receiver_user_id: Number(target.user_id), ...target.callback_query_id ? { callback_query_id: target.callback_query_id } : {} } }, ...target.message_thread_id ? { message_thread_id: target.message_thread_id } : {} };
  }
  const result = await telegramTransport(env, method, body);
  await rememberResponse(env, method, body, result);
  return result;
}
__name(telegram, "telegram");
__name2(telegram, "telegram");
var keyboard2 = /* @__PURE__ */ __name2((items) => ({ inline_keyboard: items.map(([text, data]) => [{ text, callback_data: data }]) }), "keyboard");
var activate2 = /* @__PURE__ */ __name2((s) => ({ inline_keyboard: [[{ text: "Activate Mr. Charm", url: "https://t.me/" + s.bot_username + "?start=help" }]] }), "activate");
var isAddressed = /* @__PURE__ */ __name2((text) => /^\s*mr(?:\.\s*|\s+)charm\b/i.test(text), "isAddressed");
var isInternalStart = /* @__PURE__ */ __name2((text) => /^\/start(?:@\w+)?\s+(?:help|flow_[a-f0-9]{48}|admin_\w+|manage_\w+|notify_update|usage|website_release|update_report)$/i.test(text.trim()), "isInternalStart");
var groupHelp = /* @__PURE__ */ __name2(() => keyboard2([["\u{1F49C} Mr. Charm Help", "help"]]), "groupHelp");
function splitText(text, max = 3500) {
  const out = [];
  while (text.length > max) {
    let n = text.lastIndexOf("\n", max);
    if (n < max / 2)
      n = max;
    out.push(text.slice(0, n));
    text = text.slice(n).replace(/^\n/, "");
  }
  if (text)
    out.push(text);
  return out;
}
__name(splitText, "splitText");
__name2(splitText, "splitText");
var plain = /* @__PURE__ */ __name2((text) => text.replace(/^#{1,6} /gm, "").replace(/\*\*(.*?)\*\*/g, "$1"), "plain");
async function send(env, id, text, reply_markup) {
  reply_markup = withNavigation(env, id, reply_markup);
  if (isRich(text)) {
    const rich = readRich(text);
    try {
      return await telegram(env, "sendRichMessage", { chat_id: id, rich_message: { html: rich.html }, ...reply_markup ? { reply_markup } : {} });
    } catch (e) {
      if (e.telegramCode !== 400)
        throw e;
      await event(env, null, "rich_message_fallback", "Telegram declined rich formatting; sending plain text.");
      text = rich.text;
    }
  }
  let result;
  const chunks = splitText(plain(commandText(brandText(text))), 4e3);
  for (let i = 0; i < chunks.length; i++) {
    result = await telegram(env, "sendMessage", { chat_id: id, text: chunks[i], ...i === chunks.length - 1 && reply_markup ? { reply_markup } : {} });
  }
  return result;
}
__name(send, "send");
__name2(send, "send");
async function show(env, id, key, s) {
  const c = await content(env, key);
  if (!c.enabled || !c.body.trim())
    return send(env, id, "This information is currently unavailable. Please contact an Admin.");
  if (isRich(c.body)) {
    await send(env, id, c.body);
    await event(env, id, key + "_viewed");
    return;
  }
  if (key === "guide") {
    const marker = "\u{1F49C} YOUR Charming MediaLab GUIDE\nPART 2 OF 2", pos = c.body.indexOf(marker);
    if (pos > 0) {
      await send(env, id, c.body.slice(0, pos).trim());
      await send(env, id, c.body.slice(pos));
    } else
      await send(env, id, c.body);
  } else if (key === "rules") {
    const warning = "VIOLATION OF ANY OF THESE RULES IS A LIFETIME BAN FROM THE Charming MediaLab APP AND THE TELEGRAM GROUP.";
    if (c.body.trim().endsWith(warning)) {
      await send(env, id, c.body.slice(0, c.body.lastIndexOf(warning)).trim());
      try {
        await telegram(env, "sendRichMessage", { chat_id: id, rich_message: { html: "<h1><b>" + warning + "</b></h1>" } });
      } catch (e) {
        if (e.telegramCode !== 400)
          throw e;
        await telegram(env, "sendMessage", { chat_id: id, text: warning, entities: [{ type: "bold", offset: 0, length: warning.length }] });
      }
    } else
      await send(env, id, c.body);
  } else
    await send(env, id, c.body);
  await event(env, id, key + "_viewed");
  if (["guide", "rules", "app_help"].includes(key))
    await help(env, id, s);
}
__name(show, "show");
__name2(show, "show");
async function authorizedMember(env, id, s) {
  const live = await telegram(env, "getChatMember", { chat_id: s.group_id, user_id: Number(id) });
  await member(env, live.user, live.status === "restricted" && live.is_member ? "restricted_member" : live.status);
  return isMember(live);
}
__name(authorizedMember, "authorizedMember");
__name2(authorizedMember, "authorizedMember");
function intent(text) {
  const exact = exactCommand(text);
  if (exact)
    return exact;
  const t = text.toLowerCase().replace(/mr\.?\s*charm/g, "").replace(/^\//, "").trim();
  if (/multiview|multi.view|real.?debrid|xtream|sources|nova|playback help/.test(t))
    return "app_help";
  if (/token/.test(t))
    return "token";
  if (/account|login|time remaining|active login/.test(t))
    return "account";
  if (/what.?s new|release/.test(t))
    return "whats_new";
  if (/trouble|buffer|freez|black screen/.test(t))
    return "troubleshooting";
  if (/download|downloader|apk|where.*app/.test(t))
    return "downloads";
  if (/guide/.test(t))
    return "guide";
  if (/rule/.test(t))
    return "rules";
  if (/admin|support/.test(t))
    return "contact";
  if (/status/.test(t))
    return "status";
  if (/about/.test(t))
    return "about";
  return "help";
}
__name(intent, "intent");
__name2(intent, "intent");
async function help(env, id, s) {
  const admin = await currentTelegramAdmin(env, id, s, telegram);
  const commands = await availableCommands(env, HOME_COMMANDS);
  const items = commands.map((c) => [c.buttonLabel, c.id]);
  items.push(["\u{1F464} User Commands", "user_commands"]);
  if (admin)
    items.push(["\u{1F6E1} Admin Commands", "admin"]);
  try {
    await syncCommandMenu(env, id, s, admin, telegram);
  } catch (e) {
    await event(env, id, "command_menu_sync_failed", e.telegramCode ? String(e.telegramCode) : "network");
  }
  const result = await send(env, id, "Here\u2019s what I can help you with. Click one of the buttons below.", keyboard2(items));
  await event(env, id, "help_menu_delivered");
  return result;
}
__name(help, "help");
__name2(help, "help");
async function availableCommands(env, ids) {
  const commands = [];
  for (const id of ids) {
    const command = BOT_COMMANDS.find((c) => c.id === id);
    if (!command)
      continue;
    if (command.content) {
      const c = await content(env, id);
      if (!c.enabled || !c.body.trim())
        continue;
    }
    commands.push(command);
  }
  return commands;
}
__name(availableCommands, "availableCommands");
__name2(availableCommands, "availableCommands");
async function commandMenu(env, id, cmd, s) {
  const selected = COMMAND_MENUS.find((menu) => menu.id === cmd);
  const admin = cmd === "admin" || selected?.admin || cmd.startsWith("menu:admin:");
  if (admin && !await currentTelegramAdmin(env, id, s, telegram))
    return send(env, id, "Only current group admins can access Admin tools.", keyboard2([["Main menu", "help"]]));
  if (cmd.startsWith("menu:") && !selected)
    return help(env, id, s);
  if (selected) {
    const commands = await availableCommands(env, selected.commands);
    return send(env, id, selected.label + "\n" + selected.description + "\n\n" + (commands.length ? commands.map((c) => c.buttonLabel + "\n" + c.description).join("\n\n") : "No information is available in this category yet."), keyboard2(commands.map((c) => [c.buttonLabel, c.id]).concat([["\u21A9 " + (admin ? "Admin Commands" : "User Commands"), admin ? "admin" : "user_commands"], ["\u{1F3E0} Main menu", "help"]])));
  }
  const menus = COMMAND_MENUS.filter((menu) => Boolean(menu.admin) === Boolean(admin));
  return send(env, id, (admin ? "\u{1F6E1} Admin Commands" : "\u{1F464} User Commands") + "\nChoose a category below. Each command includes a short explanation.\n\n" + menus.map((menu) => menu.label + " \u2014 " + menu.description).join("\n\n"), keyboard2(menus.map((menu) => [menu.label, menu.id]).concat([["\u{1F3E0} Main menu", "help"]])));
}
__name(commandMenu, "commandMenu");
__name2(commandMenu, "commandMenu");
async function account(env, id, s, tokenOnly) {
  if (!s.accounts_enabled)
    return send(env, id, "Account help is temporarily paused. Please contact an Admin.");
  const m = await q(env, "SELECT * FROM bot_members WHERE telegram_id=?1", id).first();
  const inv = m.invite_id ? await q(env, "SELECT * FROM invites WHERE id=?1", m.invite_id).first() : null;
  const u = m.account_id ? await q(env, "SELECT * FROM users WHERE id=?1", m.account_id).first() : null;
  if (m.blocked || u && (u.status !== "active" || u.expires_at !== null && u.expires_at <= now()))
    return send(env, id, "Your account is inactive or blocked. Please contact an Admin.");
  if (tokenOnly) {
    if (!inv || ["disabled", "expired"].includes(inv.status) || inv.status === "unused" && inv.expires_at !== null && inv.expires_at <= now())
      return send(env, id, "Your invitation is unavailable. An Admin can check your account; requesting again will not create a replacement.");
    return send(env, id, "Your Charming MediaLab invitation token:\n" + inv.invite_code + "\n\n" + (inv.status === "used" ? "Already used to register. Sign in using your app username and password." : "Use this once to register in the app.") + "\nKeep this token private.");
  }
  const count = u ? await q(env, "SELECT COUNT(*) n FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?2", u.id, now()).first() : null;
  return send(env, id, u ? `My Account
Username: ${u.username}
Status: ${u.status}
Expiration: ${u.expires_at === null ? "Unlimited" : new Date(u.expires_at * 1e3).toISOString()}
Time remaining: ${u.expires_at === null ? "Unlimited" : Math.max(0, Math.ceil((u.expires_at - now()) / 86400)) + " days"}
Active logins: ${count.n} of ${u.max_sessions}
Telegram: Linked
Invitation: ${inv?.status || "No surviving record"}` : "Mr Charm recognizes your Telegram identity, but no verified app-account link is saved yet. " + (inv ? "Your invitation is " + inv.status + ". Register in the app to activate your account." : "An Admin must check or link your existing account."), keyboard2([["\u{1F517} Account Linking", "linking:user"], ["\u{1F511} My Token", "token"], ["Login help", "issue:Login / Token"], ["Account FAQ", "faq"], ["Contact an Admin", "contact"]]));
}
__name(account, "account");
__name2(account, "account");
async function contact(env, id, s, selected = null) {
  let live;
  const support = { text: "Open support ticket", callback_data: "issue:Other" };
  try {
    live = await telegram(env, "getChatAdministrators", { chat_id: s.group_id });
  } catch (e) {
    await event(env, id, "support_admin_lookup_failed", e.telegramMethod + " " + (e.telegramCode || "network"));
    return send(env, id, "I could not retrieve the group admin list just now. Please try again shortly or open a support ticket.", { inline_keyboard: [[support]] });
  }
  const people = await supportContacts(env, live);
  const back = { text: "Back to support admins", callback_data: "contact" };
  if (selected) {
    const person = people.find((p) => p.id === selected);
    if (!person)
      return send(env, id, "This support contact is no longer available.", { inline_keyboard: [[back], [support]] });
    const text2 = person.name + (person.username ? "\n@" + person.username : "\nNo public Telegram username is set. Open the group, tap its name, open the member list and select " + person.name + ". You can also open a support ticket below.");
    return send(env, id, text2, { inline_keyboard: [...person.username ? [[{ text: "Contact " + person.name, url: "https://t.me/" + person.username }]] : [], [back], [support]] });
  }
  const text = people.length ? "Charming MediaLab Support Admins (" + people.length + ")\n\n" + people.map((p) => p.name + (p.username ? " (@" + p.username + ")" : " \u2014 select below for contact help")).join("\n") + "\n\nPlease contact one Admin at a time." : "Support Admin contacts are being configured. You can open a support ticket below.";
  const markup2 = { inline_keyboard: [...people.map((p) => [{ text: p.name, ...p.username ? { url: "https://t.me/" + p.username } : { callback_data: "contact-admin:" + p.id } }]), [support]] };
  try {
    return await send(env, id, text, markup2);
  } catch (e) {
    if (e.telegramCode !== 400)
      throw e;
    await event(env, id, "support_admin_buttons_rejected", e.telegramMethod || "sendMessage");
    return send(env, id, text, { inline_keyboard: [...people.map((p) => [{ text: p.name, callback_data: "contact-admin:" + p.id }]), [support]] });
  }
}
__name(contact, "contact");
__name2(contact, "contact");
async function inviteCommand(env, id, text, m, s, updateId) {
  const actor = await telegram(env, "getChatMember", { chat_id: s.group_id, user_id: Number(id) });
  if (!["administrator", "creator"].includes(actor.status) || actor.user?.is_bot)
    return send(env, id, "Only current Charming MediaLab group admins can create group invites.");
  if (/^\s*mr\.?\s*charm\s+invites\s*$/i.test(text)) {
    const list = await rows(env, "SELECT * FROM bot_group_invites WHERE group_id=?1 ORDER BY created_at DESC,id DESC LIMIT 15", s.group_id);
    return send(env, id, list.length ? "Recent group invites\n\n" + list.map((i) => i.id.slice(0, 8) + " \xB7 " + i.recipient_label + " \xB7 " + (i.expires_at !== null && i.expires_at <= now() && ["active", "pending"].includes(i.status) ? "expired" : i.status) + "\nExpires: " + (i.expires_at ? new Date(i.expires_at * 1e3).toISOString() : "Never")).join("\n\n") + "\n\nCancel one with Mr. Charm Revoke INVITE_ID. Full links and join history are in the admin panel." : "No group invites yet. Use Mr. Charm Invite John Smith 60.");
  }
  if (/^\s*mr\.?\s*charm\s+revoke\b/i.test(text)) {
    const key = text.replace(/^\s*mr\.?\s*charm\s+revoke\s*/i, "").trim().toLowerCase();
    if (!/^(?:[a-f0-9]{8}|[a-f0-9]{8}-[a-f0-9-]{27})$/.test(key))
      return send(env, id, "Use Mr. Charm Invites to find the invite ID, then Mr. Charm Revoke INVITE_ID.");
    const matches = await rows(env, "SELECT id FROM bot_group_invites WHERE group_id=?1 AND id LIKE ?2", s.group_id, key + "%");
    if (matches.length !== 1)
      return send(env, id, "That ID was not found or is ambiguous. Use the full ID from the panel.");
    try {
      const result = await revokeGroupInvite(env, matches[0].id, "telegram:" + id);
      return send(env, id, result.revoked_at ? "Invite revoked. Existing group members have not been removed." : "The invite is blocked locally. Telegram revocation is pending and will retry automatically.");
    } catch (e) {
      if (e.status && e.status < 500)
        return send(env, id, e.message);
      throw e;
    }
  }
  const args = text.replace(/^\s*mr\.?\s*charm\s+invite\b/i, "").trim().split(/\s+/).filter(Boolean);
  const replied = m.reply_to_message?.from;
  const duration = (replied && args.length === 1 || args.length > 1) && /^\d+$/.test(args.at(-1)) ? args.pop() : "60";
  const recipient = replied && !replied.is_bot ? String(replied.id) : args.length === 1 && /^\d+$/.test(args[0]) ? args[0] : null;
  const label = replied ? [replied.first_name, replied.last_name].filter(Boolean).join(" ") : recipient ? "Telegram " + recipient : args.join(" ") || "New member";
  const minutes = Number(duration);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080 || label.length > 100)
    return send(env, id, "Use Mr. Charm Invite John Smith 60, or Mr. Charm Invite 123456789 60 when you know their Telegram ID. Default: 60 minutes; maximum: 7 days. The recipient still needs a human admin\u2019s approval.");
  try {
    const invite = await createGroupInvite(env, s, { telegram_id: recipient, recipient_label: label, username: replied?.username || "", expires_at: now() + minutes * 60, approved: true }, "telegram:" + id, Number.isSafeInteger(updateId) ? "telegram-update:" + updateId : null);
    return send(env, id, "Personal group invite for " + invite.recipient_label + (invite.telegram_id ? " \xB7 Telegram ID " + invite.telegram_id : "") + "\n" + invite.invite_link + "\nExpires: " + new Date(invite.expires_at * 1e3).toISOString() + "\nShare this link only with the intended person. A human admin must verify and approve the requester.");
  } catch (e) {
    if (e.status && e.status < 500)
      return send(env, id, e.message);
    throw e;
  }
}
__name(inviteCommand, "inviteCommand");
__name2(inviteCommand, "inviteCommand");
var topics = ["Installing the App", "Login / Token", "Channel Won\u2019t Play", "Buffering / Freezing", "Guide / EPG", "Sound but No Picture", "Black Screen", "App Won\u2019t Update", "Other"];
async function troubleshooting(env, id) {
  return send(env, id, "What are you having trouble with?", keyboard2(topics.map((t) => [t, "issue:" + t])));
}
__name(troubleshooting, "troubleshooting");
__name2(troubleshooting, "troubleshooting");
async function notifySupportAdmins(env, ticketId, requesterId, details) {
  const recipients = new Set((await rows(env, "SELECT telegram_id FROM bot_support_admins WHERE enabled=1 ORDER BY name")).map((a) => String(a.telegram_id)));
  try {
    const s = await settings(env);
    if (s.group_id) {
      const live = await telegram(env, "getChatAdministrators", { chat_id: s.group_id });
      for (const admin of live)
        if (!admin.user.is_bot)
          recipients.add(String(admin.user.id));
    }
  } catch (error) {
    await event(env, null, "support_admin_lookup_failed", telegramFailure(error));
  }
  if (!recipients.size)
    return;
  const member2 = await q(env, "SELECT name,username FROM bot_members WHERE telegram_id=?1", requesterId).first();
  const who = member2?.username ? "@" + member2.username : member2?.name || "Telegram ID " + requesterId;
  const text = ["New support ticket #" + ticketId, "From: " + who, "Issue: " + (details.topic || "Other"), "Device: " + (details.device || "Not provided"), "Scope: " + (details.scope || "Not provided"), "Audio: " + (details.audio || "Not provided"), "Details: " + (details.details || "No additional details"), "Open Mr. Charm Control Center \u2192 Support tickets to respond."].join("\n");
  for (const adminId of recipients) {
    try {
      await send(env, adminId, text, { inline_keyboard: [[{ text: "Open support tickets", url: "https://charmiptv-admin.agentleakage.workers.dev/#bot" }]] });
    } catch (error) {
      await event(env, adminId, "support_admin_notification_failed", "ticket " + ticketId + " \xB7 " + String(error.telegramCode || "delivery"));
    }
  }
}
__name(notifySupportAdmins, "notifySupportAdmins");
__name2(notifySupportAdmins, "notifySupportAdmins");
async function conversation(env, id, text, data) {
  env = { ...env, BOT_NAVIGATION: { userId: id, parent: "troubleshooting" } };
  const c = await q(env, "SELECT * FROM bot_conversations WHERE telegram_id=?1", id).first();
  if (!c)
    return false;
  if (now() - c.updated_at > 3600) {
    await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
    return false;
  }
  const d = JSON.parse(c.json);
  let next, prompt;
  if (c.state === "device") {
    if (!text && !data?.startsWith("answer:"))
      return false;
    d.device = (text || data.slice(7)).slice(0, 300);
    next = "scope";
    prompt = "Does it affect everything or only some channels?";
  } else if (c.state === "scope") {
    d.scope = (data || text || "").replace("answer:", "").slice(0, 300);
    next = "audio";
    prompt = "Do you hear audio when the problem happens?";
  } else if (c.state === "audio") {
    d.audio = (data || text || "").replace("answer:", "").slice(0, 300);
    next = "result";
    prompt = "Try these steps:\n1. Close and reopen Charming MediaLab.\n2. Check another channel and your internet connection.\n3. Restart your device.\n" + (/Guide/.test(d.topic) ? "4. In Settings, clear the guide cache and reload the guide." : /Login/.test(d.topic) ? "4. Check your username and password. Invitation codes are only used for initial registration." : /Install|Update/.test(d.topic) ? "4. Use the current download and allow installation from Downloader in your device settings." : "4. Note which channels fail and any error shown.") + "\n\nDid that fix the issue?";
  } else if (c.state === "result") {
    if (data === "answer:Yes") {
      await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
      await send(env, id, "Glad that helped. Type Mr. Charm Help anytime.");
      return true;
    }
    next = "details";
    prompt = env.BOT_GROUP_REPLY ? "Would you like me to send your answers to the Admins as a support ticket?" : "Begin your reply with Mr Charm, then describe what happened and any error message. Do not include passwords or tokens. I\u2019ll include your earlier answers in a support ticket.";
  } else if (c.state === "details") {
    if (!text && data !== "answer:Send ticket")
      return false;
    d.details = (text || "Member requested Admin help using the group buttons. Please follow up for further details.").slice(0, 1800).replace(/CHM-[A-Z0-9-]+/gi, "[token removed]");
    const saved = await env.DB.batch([q(env, "INSERT INTO bot_support(telegram_id,summary,created_at,updated_at) VALUES(?1,?2,?3,?3)", id, JSON.stringify(d), now()), q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id)]);
    await notifySupportAdmins(env, saved[0].meta.last_row_id, id, d);
    await event(env, id, "support_opened", d.topic);
    await send(env, id, "Your support ticket is saved for the Admins with your troubleshooting answers.");
    return true;
  } else
    return false;
  const result = await send(env, id, prompt, next === "scope" ? keyboard2([["Everything", "answer:Everything"], ["Only some channels", "answer:Some channels"]]) : ["audio", "result"].includes(next) ? keyboard2([["Yes", "answer:Yes"], ["No", "answer:No"]]) : next === "details" && env.BOT_GROUP_REPLY ? keyboard2([["Send ticket to Admins", "answer:Send ticket"], ["Back to Help", "help"]]) : void 0);
  d.prompt_message = result?.message_id ? { chat_id: env.BOT_GROUP_REPLY?.chat_id || id, message_id: result.message_id } : null;
  await q(env, "UPDATE bot_conversations SET state=?1,json=?2,updated_at=?3 WHERE telegram_id=?4", next, JSON.stringify(d), now(), id).run();
  return true;
}
__name(conversation, "conversation");
__name2(conversation, "conversation");
async function handleCommand(env, id, cmd, s) {
  if (cmd === "usage" || cmd.startsWith("usage:") || cmd === "website_release" || cmd === "update_report")
    return usageCommand(env, id, cmd, s);
  if (cmd === "admin" || cmd.startsWith("admin_")) {
    if (!await currentTelegramAdmin(env, id, s, telegram))
      return send(env, id, "Only current group admins can access Admin tools.");
    if (cmd === "admin")
      return commandMenu(env, id, cmd, s);
    if (cmd === "admin_invites")
      return inviteCommand(env, id, "Mr Charm Invites", {}, s);
    if (["admin_invite", "admin_revoke"].includes(cmd)) {
      if (env.BOT_GROUP_REPLY)
        return send(env, id, "Open Mr. Charm privately to enter invitation details.", { inline_keyboard: [[{ text: "Continue privately", url: "https://t.me/" + s.bot_username + "?start=" + cmd }]] });
      await q(env, "INSERT INTO bot_conversations VALUES(?1,?2,?3,?4) ON CONFLICT(telegram_id) DO UPDATE SET state=excluded.state,json=excluded.json,updated_at=excluded.updated_at", id, cmd, "{}", now()).run();
      return send(env, id, cmd === "admin_invite" ? "Begin with Mr Charm, then enter the recipient\u2019s name or Telegram numeric ID followed by the duration in minutes. Example: Mr Charm John Smith 60." : "Begin with Mr Charm, then enter the invitation ID from Recent room invitations.", keyboard2([["Cancel", "admin"]]));
    }
  }
  if (cmd === "user_commands" || cmd.startsWith("menu:"))
    return commandMenu(env, id, cmd, s);
  if (Object.hasOwn(LINK_INSTRUCTIONS, cmd)) {
    const admin = await currentTelegramAdmin(env, id, s, telegram);
    if (cmd !== "linking:user" && !admin)
      return send(env, id, "Only current group admins can open these instructions.", keyboard2([["\u{1F517} Account Linking", "linking:user"], ["\u{1F3E0} Main menu", "help"]]));
    const options = [["\u{1F464} Link My User Account", "linking:user"]];
    if (admin)
      options.push(["\u{1F6E1} Administrator Linking", "linking:admin"], ["\u{1F91D} Helping Another User", "linking:assist"], ["\u{1F4CB} Web Panel & Recovery", "linking:panel"]);
    return send(env, id, LINK_INSTRUCTIONS[cmd], keyboard2([...options, ["\u21A9 Account Help", "account"], ["\u{1F3E0} Main menu", "help"]]));
  }
  if (cmd === "help")
    return help(env, id, s);
  if (cmd === "website") {
    const website = await websiteConfig(env);
    return send(env, id, "\u{1F310} Charming MediaLab website\nDownload the app, read installation steps and find account help.", { inline_keyboard: [[{ text: "\u{1F310} Open website", url: website.url }], [{ text: "\u21A9 Main menu", callback_data: "help" }]] });
  }
  if (["account", "token", "downloads"].includes(cmd) || cmd.startsWith("issue:") || cmd === "troubleshooting") {
    if (!await authorizedMember(env, id, s))
      return send(env, id, "Member access required. Your join request must be approved and you must still be in the Charming MediaLab group.");
  }
  if (cmd === "account" || cmd === "token")
    return account(env, id, s, cmd === "token");
  if (cmd === "downloads") {
    if (!s.downloads_enabled)
      return send(env, id, "A new Charming MediaLab download is being prepared. Please check back shortly.");
    const codes = (s.download_codes || [{ label: "Primary", code: "2977459", enabled: true }]).filter((c) => c.enabled && c.code.trim());
    if (!codes.length && !s.download_url)
      return send(env, id, "The download is currently unavailable. Please contact an Admin.");
    await event(env, id, "downloads_viewed");
    return send(env, id, "Download Charming MediaLab" + (s.app_version ? " \xB7 " + s.app_version : "") + "\n\nOpen the Downloader app and enter:\n" + codes.map((c) => (c.label || "Downloader code") + ": " + c.code).join("\n") + "\n\nFollow the download and installation prompts. Your personal invitation token is separate.", s.download_url ? { inline_keyboard: [[{ text: "Download Charming MediaLab", url: s.download_url }]] } : void 0);
  }
  if (cmd === "contact")
    return contact(env, id, s);
  if (/^contact-admin:[1-9]\d{4,19}$/.test(cmd))
    return contact(env, id, s, cmd.slice(14));
  if (cmd === "troubleshooting")
    return troubleshooting(env, id);
  if (cmd.startsWith("issue:")) {
    const topic = cmd.slice(6);
    if (!topics.includes(topic))
      return;
    await q(env, "INSERT INTO bot_conversations VALUES(?1,'device',?2,?3) ON CONFLICT(telegram_id) DO UPDATE SET state='device',json=excluded.json,updated_at=excluded.updated_at", id, JSON.stringify({ topic }), now()).run();
    return send(env, id, env.BOT_GROUP_REPLY ? "What device are you using? Choose a button below." : "What device are you using? Begin your reply with Mr Charm, then type its name and model.", env.BOT_GROUP_REPLY ? keyboard2(["Fire TV / Fire Stick", "Onn box", "Android TV / Google TV", "Android phone / tablet", "Other / Not sure"].map((d) => [d, "answer:" + d])) : void 0);
  }
  if (cmd === "faq")
    return send(env, id, "Your invitation is for one registration. After registration, sign in with your username and password. Do not share your invitation or account. Your connection allowance is simultaneous logins, not permanently registered devices. Admins can review expired or disabled accounts. Use Forgot Password in the app, then privately approve the request with your linked Telegram account. Enter the new password only in the app. Mr. Charm never reveals or asks for your password.");
  if (["guide", "rules", "whats_new", "status", "about", "app_help"].includes(cmd))
    return show(env, id, cmd, s);
  return help(env, id, s);
}
__name(handleCommand, "handleCommand");
__name2(handleCommand, "handleCommand");
async function handleUpdate(env, u, s) {
  if (u.chat_join_request) {
    const j = u.chat_join_request;
    if (String(j.chat.id) !== s.group_id || j.from.is_bot)
      return;
    if (s.group_invite_approval !== "manual")
      return handleAutomaticJoinRequest(env, u, s);
    if (await handleGroupJoinRequest(env, u, s))
      return;
    await member(env, j.from, "pending");
    await q(env, "UPDATE bot_members SET requested_at=?1 WHERE telegram_id=?2", j.date, String(j.from.id)).run();
    await event(env, String(j.from.id), "join_requested");
    const c = await content(env, "waiting");
    if (c.enabled && c.body.trim()) {
      try {
        await send(env, j.user_chat_id, c.body, activate2(s));
      } catch (e) {
        if (![400, 403].includes(e.telegramCode))
          throw e;
        await event(env, String(j.from.id), "waiting_dm_unavailable", "Temporary Telegram contact window unavailable");
      }
    }
    return;
  }
  if (u.chat_member) {
    const j = u.chat_member;
    if (String(j.chat.id) !== s.group_id || j.new_chat_member.user.is_bot)
      return;
    try {
      await recordGroupAdmission(env, j);
    } catch (e) {
      if (!e.telegramCode)
        throw e;
      await event(env, String(j.new_chat_member.user.id), "group_admission_telegram_retry", telegramFailure(e));
    }
    const id2 = String(j.new_chat_member.user.id), live = await telegram(env, "getChatMember", { chat_id: s.group_id, user_id: Number(id2) });
    await member(env, live.user, live.status === "restricted" && live.is_member ? "restricted_member" : live.status);
    await event(env, id2, "membership_changed", live.status);
    if (isMember(j.old_chat_member) && !isMember(j.new_chat_member)) {
      const key = "departure:" + s.group_id + ":" + id2 + ":" + j.date;
      if (!await q(env, "SELECT value FROM bot_runtime WHERE key=?1", key).first()) {
        const user2 = j.new_chat_member.user;
        const name = user2.username ? "@" + user2.username : [user2.first_name, user2.last_name].filter(Boolean).join(" ") || "Telegram user " + id2;
        const at = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(j.date * 1e3));
        await send({ ...env, BOT_PERSISTENT_ANNOUNCEMENT: true }, s.group_id, name + " \u2014 Bye bitch we didn\u2019t want your ass here anyway you fucking loser! At " + at + " you lost access for being a cunt.");
        await q(env, "INSERT OR REPLACE INTO bot_runtime(key,value) VALUES(?1,?2)", key, "sent").run();
      }
    }
    if (isMember(live) && !isMember(j.old_chat_member)) {
      await q(env, "UPDATE bot_members SET joined_at=?1 WHERE telegram_id=?2", j.date, id2).run();
      const onboarding = await q(env, "SELECT * FROM bot_join_requests WHERE group_id=?1 AND telegram_id=?2 AND state='approved' AND approved_at<=?3 AND approved_at>=?3-300", s.group_id, id2, j.date).first();
      if (onboarding) {
        await queueJoinReport(env, s, live.user, j.date, { token: onboarding.token_id ? "Yes \xB7 existing invitation" : "No \xB7 linked account", welcome: onboarding.welcome_sent ? "Yes \xB7 delivered before approval" : "Not delivered", setup: onboarding.token_sent ? "Yes \xB7 delivered before approval" : "Not delivered" }, send, telegram);
        return;
      }
      const outcome = { token: "No", welcome: "Not enabled", setup: "Not sent \xB7 no invitation available" };
      const failure2 = /* @__PURE__ */ __name2((e) => "Failed \xB7 " + telegramFailure(e), "failure");
      let invitation;
      try {
        invitation = await assignToken(env, id2, s);
        outcome.token = invitation ? "Yes \xB7 " + invitation.status : "No \xB7 no eligible invitation";
      } catch (e) {
        outcome.token = failure2(e);
      }
      const privateEnv = { ...env, BOT_INTERACTION: { recipient: id2, generation: crypto.randomUUID() }, BOT_GROUP_REPLY: { chat_id: s.group_id, user_id: id2 } };
      try {
        const c = await content(env, "welcome");
        if (c.enabled && c.body.trim()) {
          await send(privateEnv, id2, c.body.replaceAll("{name}", live.user.first_name), groupHelp());
          outcome.welcome = "Yes";
        }
      } catch (e) {
        outcome.welcome = failure2(e);
      }
      if (invitation?.status === "unused" && (invitation.expires_at === null || invitation.expires_at > now())) {
        try {
          await send(privateEnv, id2, "Your private Charming MediaLab app invitation is ready.\n\nRegistration token: " + invitation.invite_code + "\n\nAccount setup\n1. Open Charming MediaLab.\n2. Choose I Have an Invitation.\n3. Enter this token once and create your username and password.\n4. Keep your password private.\n\nAccount linking\nYour Telegram identity is attached to this invitation. After registration, open Settings \u2192 Account \u2192 Link Telegram / Account Recovery and follow the on-screen confirmation if the app asks you to verify the link. Type Mr Charm Account Linking anytime for the full directions.", keyboard2([["\u{1F517} Full Account Linking Directions", "linking:user"], ["\u{1F511} My Token", "token"], ["\u{1F3E0} Help", "help"]]));
          outcome.setup = "Yes";
        } catch (e) {
          outcome.setup = failure2(e);
        }
      }
      await queueJoinReport(env, s, live.user, j.date, outcome, send, telegram);
    }
    return;
  }
  const cb = u.callback_query, m = cb?.message || u.message, user = cb?.from || m?.from;
  if (!m || !user || user.is_bot || m.sender_chat)
    return;
  const privateChat = m.chat.type === "private";
  if (!privateChat && String(m.chat.id) !== s.group_id)
    return;
  if (privateChat && String(m.chat.id) !== String(user.id))
    return;
  const text = u.message?.text || "";
  const addressed = isAddressed(text);
  const internalStart = privateChat && isInternalStart(text);
  if (!cb && !addressed && !internalStart)
    return;
  if (cb)
    await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id });
  const id = String(user.id);
  await member(env, user);
  env = { ...env, BOT_INTERACTION: { recipient: id, generation: crypto.randomUUID() }, BOT_CALLBACK_MESSAGE: privateChat && cb ? m.message_id : null };
  if (cb && m.receiver_user && String(m.receiver_user.id) !== id)
    return;
  if (!privateChat)
    env = { ...env, BOT_GROUP_REPLY: { chat_id: s.group_id, user_id: id, callback_query_id: cb?.id, message_thread_id: m.message_thread_id } };
  const window = Math.floor(now() / 60);
  await q(env, "INSERT INTO bot_rate VALUES(?1,?2,1) ON CONFLICT(telegram_id) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window", id, window).run();
  if ((await q(env, "SELECT count FROM bot_rate WHERE telegram_id=?1", id).first()).count > 12) {
    await event(env, id, "command_rate_limited", privateChat ? "private" : "group");
    if (cb)
      await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "Please wait until the next minute, then try again.", show_alert: true });
    return;
  }
  if (privateChat)
    await q(env, "UPDATE bot_members SET dm_started=1 WHERE telegram_id=?1", id).run();
  const start = text.match(/^\/start(?:@\w+)?\s+(help|admin_\w+|manage_\w+|notify_update|usage|website_release|update_report)$/i);
  let cmd = cb?.data || start?.[1] || intent(text);
  const destination = navigationDestination(cmd);
  if (cmd.startsWith("nav:")) {
    if (!destination)
      return send(env, id, "This navigation button is no longer available.", keyboard2([["Main menu", "help"]]));
    await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
    cmd = destination;
  }
  env = { ...env, BOT_NAVIGATION: { userId: id, parent: navigationParent(cmd) || (cmd === "help" && addressedText(text) && !exactCommand(text) ? "help" : null) } };
  const directMenu = cb || internalStart || exactCommand(text) || addressedText(text) === "";
  if (!destination && directMenu && (["help", "admin", "user_commands"].includes(cmd) || cmd.startsWith("menu:")))
    await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
  try {
    if (destination)
      return await handleCommand(env, id, cmd, s);
    if (await moderation(env, id, text, cmd, s, m, u.update_id, telegram, send))
      return;
    const joke = !cb && banterReply(text);
    if (joke)
      return await sendHumor(env, id, joke, send);
    if (Object.hasOwn(LINK_INSTRUCTIONS, cmd)) {
      await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
      return await handleCommand(env, id, cmd, s);
    }
    if ((cb || exactCommand(text) || /^\s*mr\.?\s*charm\s*$/i.test(text)) && (["help", "admin", "user_commands"].includes(cmd) || cmd.startsWith("menu:")))
      return await handleCommand(env, id, cmd, s);
    if (cmd === "usage" || cmd.startsWith("usage:") || cmd === "website_release" || cmd === "update_report") {
      await event(env, id, "usage_requested", (privateChat ? "private" : "group") + " " + (cb ? "button" : "text"));
      await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
      const result = await handleCommand(env, id, cmd, s);
      await event(env, id, "usage_delivered", privateChat ? "private" : "group");
      return result;
    }
    if (await accountManagement(env, id, text, cmd, s, m))
      return;
    if (await botAnnouncementFlow(env, id, text, cmd, s))
      return;
    if (await accountFlow(env, id, text, cmd, s))
      return;
    if (privateChat && addressed) {
      const draft = await q(env, "SELECT * FROM bot_conversations WHERE telegram_id=?1", id).first();
      if (draft && ["admin_invite", "admin_revoke"].includes(draft.state)) {
        await q(env, "DELETE FROM bot_conversations WHERE telegram_id=?1", id).run();
        if (now() - draft.updated_at > 600)
          return send(env, id, "This admin action expired. Open Admin tools to start again.");
        return await inviteCommand(env, id, "Mr Charm " + (draft.state === "admin_invite" ? "Invite " : "Revoke ") + addressedText(text), m, s, u.update_id);
      }
    }
    if (/^\s*mr\.?\s*charm\s+(?:invites?|revoke)\b/i.test(text))
      return await inviteCommand(env, id, text, m, s, u.update_id);
    if (cmd.startsWith("answer:")) {
      if (!await authorizedMember(env, id, s))
        return send(env, id, "Member access required. Please contact an Admin.");
      if (await conversation(env, id, "", cb?.data))
        return;
    } else if (privateChat && addressed) {
      if (await conversation(env, id, addressedText(text), cb?.data))
        return;
    }
    if (!cb && cmd === "help" && addressedText(text) && !exactCommand(text))
      return await sendHumor(env, id, pick(UNKNOWN_REPLIES), send);
    await handleCommand(env, id, cmd, s);
  } catch (e) {
    if (e.status && e.status < 500 && !e.telegramCode)
      return send(env, id, e.message, keyboard2([["Help", "help"]]));
    if (!privateChat && [400, 403].includes(e.telegramCode)) {
      await event(env, id, "group_private_reply_unavailable", (e.telegramMethod || "unknown") + " " + String(e.telegramCode));
      if (cb)
        await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "Open Mr. Charm privately and press Start, then repeat your request.", show_alert: true });
      else
        try {
          await send({ ...env, BOT_GROUP_REPLY: void 0 }, id, "Open this private assistant and press Start, then repeat your request.", activate2(s));
        } catch (fallback) {
          if (![400, 403].includes(fallback.telegramCode))
            throw fallback;
        }
    } else if (e.telegramCode === 403) {
      await q(env, "UPDATE bot_members SET dm_started=0 WHERE telegram_id=?1", id).run();
      await event(env, id, "private_chat_activation_needed");
    } else
      throw e;
  }
}
__name(handleUpdate, "handleUpdate");
__name2(handleUpdate, "handleUpdate");
async function webhook(request, env) {
  const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!env.TELEGRAM_WEBHOOK_SECRET || supplied.length !== env.TELEGRAM_WEBHOOK_SECRET.length || Array.from(supplied).reduce((n, c, i) => n | c.charCodeAt(0) ^ env.TELEGRAM_WEBHOOK_SECRET.charCodeAt(i), 0))
    return new Response("Forbidden", { status: 403 });
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const raw = await request.text();
  if (raw.length > 1e5)
    return new Response("Too large", { status: 413 });
  let u;
  try {
    u = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!Number.isSafeInteger(u.update_id))
    return new Response("Bad update", { status: 400 });
  const s = await settings(env);
  if (!s.enabled)
    return new Response("OK");
  if (u.message && !isAddressed(u.message.text || "") && !(u.message.chat?.type === "private" && isInternalStart(u.message.text || "")))
    return new Response("OK");
  const r = await q(env, "INSERT INTO bot_updates VALUES(?1,'processing',?2) ON CONFLICT(id) DO UPDATE SET status='processing',updated_at=excluded.updated_at WHERE bot_updates.status='failed' OR (bot_updates.status='processing' AND bot_updates.updated_at<?2-60)", u.update_id, now()).run();
  if (!r.meta.changes) {
    if (u.chat_join_request) {
      const previous = await q(env, "SELECT status FROM bot_updates WHERE id=?1", u.update_id).first();
      if (previous?.status !== "done")
        return new Response("Still processing", { status: 503 });
    }
    return new Response("OK");
  }
  try {
    await handleUpdate(env, u, s);
    await q(env, "UPDATE bot_updates SET status='done' WHERE id=?1", u.update_id).run();
    return new Response("OK");
  } catch (e) {
    await q(env, "UPDATE bot_updates SET status='failed',updated_at=?2 WHERE id=?1", u.update_id, now()).run();
    await event(env, null, "telegram_error", e.telegramCode ? String(e.telegramCode) : "delivery_or_service_error");
    return new Response("Retry later", { status: 503 });
  }
}
__name(webhook, "webhook");
__name2(webhook, "webhook");
async function botScheduled(env) {
  if (!env.TELEGRAM_BOT_TOKEN)
    return;
  try {
    await cleanExpiredResponses(env);
  } catch (e) {
    await event(env, null, "response_cleanup_failed", telegramFailure(e));
  }
  const s = await settings(env);
  try {
    await maintainGroupInvites(env, s.enabled);
  } catch (e) {
    await event(env, null, "group_invite_maintenance_failed", telegramFailure(e));
  }
  if (s.enabled) {
    try {
      await migrateCommandMenus(env, s, telegram);
    } catch (e) {
      await event(env, null, "command_menu_sync_failed", e.telegramCode ? String(e.telegramCode) : "network");
    }
  }
  await q(env, "UPDATE bot_jobs SET status=CASE WHEN kind IN ('join_report','join_report_discovery') THEN 'pending' ELSE 'failed' END,due_at=CASE WHEN kind IN ('join_report','join_report_discovery') THEN ?1 ELSE due_at END,error=CASE WHEN kind IN ('join_report','join_report_discovery') THEN error ELSE 'Delivery interrupted. Check the group before sending again.' END WHERE status='sending' AND due_at<?2", now(), now() - 300).run();
  if (!s.enabled)
    return;
  try {
    await queueWebsitePost(env, s);
  } catch (e) {
    await event(env, null, "website_queue_failed", telegramFailure(e));
  }
  for (const job of await rows(env, "SELECT * FROM bot_jobs WHERE status='pending' AND due_at<=?1 ORDER BY id LIMIT 20", now())) {
    if (["join_report", "join_report_discovery"].includes(job.kind)) {
      await deliverJoinReport(env, job, send, telegram);
      continue;
    }
    const claimed = await q(env, "UPDATE bot_jobs SET status='sending' WHERE id=?1 AND status='pending'", job.id).run();
    if (!claimed.meta.changes)
      continue;
    try {
      const result = job.kind === "delete" ? await telegram(env, "deleteMessage", { chat_id: job.chat_id, message_id: job.message_id }) : await send(job.kind === "broadcast" ? { ...env, BOT_PERSISTENT_ANNOUNCEMENT: true } : env, job.chat_id, job.body);
      await q(env, "UPDATE bot_jobs SET status='sent',message_id=COALESCE(?1,message_id) WHERE id=?2", result?.message_id || null, job.id).run();
    } catch (e) {
      await q(env, "UPDATE bot_jobs SET status='failed',error=?1 WHERE id=?2", e.message, job.id).run();
    }
  }
  try {
    await runRecurring(env, s, send, telegram);
  } catch (e) {
    await event(env, null, "recurring_delivery_failed", telegramFailure(e));
  }
  await env.DB.batch([q(env, "DELETE FROM bot_updates WHERE updated_at<?1", now() - 7 * 86400), q(env, "DELETE FROM bot_rate WHERE window<?1", Math.floor(now() / 60) - 60), q(env, "DELETE FROM bot_conversations WHERE updated_at<?1", now() - 86400)]);
}
__name(botScheduled, "botScheduled");
__name2(botScheduled, "botScheduled");
var boolKeys = ["enabled", "auto_tokens", "downloads_enabled", "accounts_enabled", "reminder_enabled"];
async function botAdmin(request, env, auth, { json: json2, safeJson: safeJson2 }) {
  if (!auth.isOwner && !auth.profile.can_manage_bot)
    fail("The owner must grant Mr. Charm control access.", 403);
  const url = new URL(request.url), path = url.pathname.slice("/admin/bot".length), method = request.method, id = auth.user.id;
  if (path === "/release")
    return releaseAdmin(request, env, auth, { json: json2, safeJson: safeJson2 });
  if (path === "/usage" && method === "GET")
    return json2({ success: true, usage: await usageReport(env, auth, url.searchParams.get("period") || "30") });
  const s = await settings(env);
  if (path === "/recurring/send" && method === "POST") {
    const b = await safeJson2(request), c = await content(env, "reminder");
    if (b.revision !== c.revision)
      fail("Announcement text changed. Refresh before pushing.", 409);
    await runRecurring(env, s, send, telegram, { force: true });
    await event(env, null, "reminder_pushed", "Administrator pushed the saved recurring announcement and restarted its interval.", id);
    return json2({ success: true, recurring: await recurringStatus(env, s) });
  }
  if (path === "/website" || path === "/website/send")
    return websiteAdmin(request, env, auth, { json: json2, safeJson: safeJson2 }, s, path);
  if (path === "/community-link" && method === "GET")
    return json2({ success: true, url: (await q(env, "SELECT value FROM bot_runtime WHERE key='community_join_request_link'").first())?.value || null });
  if (path === "/community-link" && method === "POST") {
    if (!auth.isOwner)
      fail("Only the owner can configure the shared community link.", 403);
    if (!s.enabled || !s.group_id)
      fail("Enable and connect the bot first.");
    const existing = await q(env, "SELECT value FROM bot_runtime WHERE key='community_join_request_link'").first();
    if (existing)
      return json2({ success: true, url: existing.value });
    const created = await telegram(env, "createChatInviteLink", { chat_id: s.group_id, name: "MediaLab community settings", creates_join_request: true });
    if (!created.invite_link || created.creates_join_request !== true)
      fail("Telegram did not return an approval-required room link.", 502);
    await q(env, "INSERT OR IGNORE INTO bot_runtime(key,value) VALUES('community_join_request_link',?1)", created.invite_link).run();
    const saved = await q(env, "SELECT value FROM bot_runtime WHERE key='community_join_request_link'").first();
    if (saved.value !== created.invite_link)
      await telegram(env, "revokeChatInviteLink", { chat_id: s.group_id, invite_link: created.invite_link });
    await event(env, null, "community_join_request_link_configured", "", id);
    return json2({ success: true, url: saved.value });
  }
  if (path === "/group-invites" && method === "POST")
    return json2({ success: true, invite: await createGroupInvite(env, s, await safeJson2(request), id) }, 201);
  if (path === "/group-invites" && method === "GET") {
    const page = Math.max(1, Math.min(1e5, Math.floor(Number(url.searchParams.get("page")) || 1))), search = "%" + String(url.searchParams.get("search") || "").slice(0, 100) + "%";
    return json2({ success: true, page, invites: await rows(env, `SELECT i.*,COUNT(a.id) attempt_count,COUNT(DISTINCT a.telegram_id) requester_count,CASE WHEN i.status IN ('active','pending') AND i.expires_at<=?1 THEN 'expired' ELSE i.status END display_status FROM bot_group_invites i LEFT JOIN bot_group_invite_attempts a ON a.invite_id=i.id WHERE i.telegram_id LIKE ?2 OR i.username LIKE ?2 OR i.recipient_label LIKE ?2 GROUP BY i.id ORDER BY i.created_at DESC,i.id DESC LIMIT 50 OFFSET ?3`, now(), search, (page - 1) * 50) });
  }
  const gi = path.match(/^\/group-invites\/([a-f0-9-]+)(\/(?:attempts|approve))?$/);
  if (gi && gi[2] === "/attempts" && method === "GET")
    return json2({ success: true, attempts: await rows(env, "SELECT * FROM bot_group_invite_attempts WHERE invite_id=?1 ORDER BY id DESC LIMIT 100", gi[1]) });
  if (gi && gi[2] === "/approve" && method === "POST")
    return json2({ success: true, invite: await approveGroupInvite(env, s, gi[1], id, (await safeJson2(request)).telegram_id) });
  if (gi && !gi[2] && method === "DELETE")
    return json2({ success: true, invite: await revokeGroupInvite(env, gi[1], id) });
  if (path === "/settings" && method === "GET")
    return json2({ success: true, settings: s, ready: { token: !!env.TELEGRAM_BOT_TOKEN, webhook_secret: !!env.TELEGRAM_WEBHOOK_SECRET } });
  if (path === "/settings" && method === "PUT") {
    const b = await safeJson2(request);
    if (b.revision !== s.revision)
      fail("Settings changed. Refresh before saving.", 409);
    const n = { ...s };
    for (const key of boolKeys) {
      if (typeof b[key] !== "boolean")
        fail("Invalid " + key);
      n[key] = b[key];
    }
    for (const [key, min, max] of [["token_days", 1, 3650], ["connections", 1, 20], ["invite_days", 1, 365], ["reminder_hours", 1, 24]]) {
      if (key === "token_days" && b[key] === null) {
        n[key] = null;
        continue;
      }
      if (!Number.isInteger(b[key]) || b[key] < min || b[key] > max)
        fail("Invalid " + key);
      n[key] = b[key];
    }
    n.group_id = String(b.group_id || "").trim();
    n.bot_username = String(b.bot_username || "").replace(/^@/, "").trim();
    if (n.group_id && !/^-\d{5,20}$/.test(n.group_id))
      fail("Enter the group numeric ID, starting with a minus sign.");
    if (n.bot_username && !/^[a-zA-Z0-9_]{5,32}$/.test(n.bot_username))
      fail("Invalid bot username.");
    if (n.enabled && (!n.group_id || !n.bot_username || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET))
      fail("Add bot credentials, username and group before enabling.");
    if (n.enabled) {
      const me = await telegram(env, "getMe", {});
      if (me.username.toLowerCase() !== n.bot_username.toLowerCase())
        fail("Username does not match the saved bot token.");
      const chat = await telegram(env, "getChat", { chat_id: n.group_id });
      if (!["group", "supergroup"].includes(chat.type))
        fail("Choose the discussion group, not a channel.");
      const rights = await telegram(env, "getChatMember", { chat_id: n.group_id, user_id: me.id });
      if (rights.status !== "administrator" || !rights.can_invite_users)
        fail("Make Mr. Charm a group admin with Invite Users permission.");
    }
    if (n.group_id !== s.group_id) {
      if (s.enabled)
        fail("Disable the bot before changing its group.");
      if ((await q(env, "SELECT COUNT(*) n FROM bot_members").first()).n)
        fail("This group already has linked members. Contact the owner before migrating groups.");
    }
    if (b.download_codes !== void 0) {
      if (!Array.isArray(b.download_codes) || b.download_codes.length !== 3)
        fail("Use three download slots.");
      n.download_codes = b.download_codes.map((c) => {
        if (typeof c.code !== "string" || !/^\d{0,12}$/.test(c.code.trim()) || typeof c.label !== "string" || c.label.length > 80 || typeof c.enabled !== "boolean")
          fail("Each downloader code must be digits or blank.");
        return { code: c.code.trim(), label: c.label.trim(), enabled: c.enabled };
      });
    }
    n.app_version = String(b.app_version || "").slice(0, 80);
    n.download_url = String(b.download_url || "").trim();
    if (n.download_url) {
      let u;
      try {
        u = new URL(n.download_url);
      } catch {
        fail("Invalid download link.");
      }
      if (u.protocol !== "https:" || u.username || u.password)
        fail("Use an HTTPS download link without embedded credentials.");
    }
    delete n.revision;
    const r = await q(env, "UPDATE bot_settings SET json=?1,revision=revision+1 WHERE id=1 AND revision=?2", JSON.stringify(n), b.revision).run();
    if (!r.meta.changes)
      fail("Settings changed. Refresh.", 409);
    if (n.enabled && n.reminder_enabled && (!s.enabled || !s.reminder_enabled || n.reminder_hours !== s.reminder_hours || n.group_id !== s.group_id))
      await restartRecurring(env, n);
    await event(env, null, "settings_updated", "", id);
    return json2({ success: true });
  }
  if (path === "/content" && method === "GET")
    return json2({ success: true, content: await Promise.all(Object.keys(DEFAULT_CONTENT).map((k) => content(env, k))) });
  const cm = path.match(/^\/content\/([a-z_]+)(\/history)?$/);
  if (cm) {
    const key = cm[1];
    if (!Object.hasOwn(DEFAULT_CONTENT, key))
      fail("Unknown content.");
    if (cm[2] && method === "GET")
      return json2({ success: true, history: (await rows(env, "SELECT * FROM bot_content_history WHERE key=?1 ORDER BY id DESC LIMIT 20", key)).map(brandedContent) });
    if (method === "PUT" && !cm[2]) {
      const b = await safeJson2(request), old = await content(env, key);
      if (b.revision !== old.revision)
        fail("Content changed. Refresh before saving.", 409);
      if (typeof b.body !== "string" || richLength(b.body) > 5e4 || typeof b.enabled !== "boolean")
        fail("Use text up to 50,000 characters and a valid enabled choice.");
      if (["broadcast", "reminder", "welcome", "waiting", "acknowledgment"].includes(key) && richLength(b.body) > 3500)
        fail("This message must be 3,500 characters or fewer.");
      await q(env, "INSERT OR IGNORE INTO bot_content VALUES(?1,?2,?3,0,?4,NULL)", key, DEFAULT_CONTENT[key].body, DEFAULT_CONTENT[key].enabled, now()).run();
      const r = await env.DB.batch([
        q(env, "INSERT INTO bot_content_history(key,body,enabled,revision,updated_at,updated_by) SELECT key,body,enabled,revision,updated_at,updated_by FROM bot_content WHERE key=?1 AND revision=?2", key, b.revision),
        q(env, "UPDATE bot_content SET body=?1,enabled=?2,revision=revision+1,updated_at=?3,updated_by=?4 WHERE key=?5 AND revision=?6", b.body, b.enabled && !!b.body.trim() ? 1 : 0, now(), id, key, b.revision)
      ]);
      if (!r[1].meta.changes)
        fail("Content changed. Refresh.", 409);
      if (key === "reminder" && !old.enabled && b.enabled && b.body.trim() && s.enabled && s.reminder_enabled)
        await restartRecurring(env, s);
      await event(env, null, "content_updated", key, id);
      return json2({ success: true, content: await content(env, key) });
    }
  }
  if (path === "/dashboard" && method === "GET")
    return json2({ success: true, recurring: await recurringStatus(env, s), members: await q(env, "SELECT COUNT(*) n FROM bot_members").first(), tickets: await q(env, "SELECT COUNT(*) n FROM bot_support WHERE status<>'closed'").first(), analytics: await rows(env, "SELECT action,COUNT(*) n FROM bot_events GROUP BY action ORDER BY n DESC"), jobs: (await rows(env, "SELECT * FROM bot_jobs ORDER BY id DESC LIMIT 30")).map(brandedContent) });
  if (path === "/members" && method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1), search = "%" + String(url.searchParams.get("search") || "").slice(0, 100) + "%";
    const data = await rows(env, `SELECT m.*,(SELECT group_concat(cu.username, ', ') FROM account_telegram_contacts c JOIN users cu ON cu.id=c.user_id WHERE c.telegram_id=m.telegram_id OR (c.telegram_id IS NULL AND c.username<>'' AND lower(c.username)=lower(m.username))) AS directory_accounts,u.username account_username,u.status account_status,u.expires_at,u.max_sessions,i.invite_code,i.status invite_status FROM bot_members m LEFT JOIN users u ON u.id=m.account_id LEFT JOIN invites i ON i.id=m.invite_id WHERE m.telegram_id LIKE ?1 OR m.name LIKE ?1 OR m.username LIKE ?1 OR u.username LIKE ?1 OR i.invite_code LIKE ?1 ORDER BY m.updated_at DESC LIMIT 50 OFFSET ?2`, search, (page - 1) * 50);
    return json2({ success: true, members: data, page });
  }
  const mm = path.match(/^\/members\/(\d+)(\/timeline)?$/);
  if (mm) {
    const tid = mm[1];
    if (mm[2] && method === "GET")
      return json2({ success: true, events: await rows(env, "SELECT action,detail,created_at,admin_id,telegram_id FROM bot_events WHERE telegram_id=?1 UNION ALL SELECT action,'' AS detail,created_at,admin_user_id AS admin_id,?1 AS telegram_id FROM audit_log WHERE user_id=(SELECT account_id FROM bot_members WHERE telegram_id=?1) ORDER BY created_at DESC LIMIT 100", tid) });
    if (method === "PATCH") {
      const b = await safeJson2(request), m = await q(env, "SELECT * FROM bot_members WHERE telegram_id=?1", tid).first();
      if (!m)
        fail("Member not found.", 404);
      if (b.action === "link") {
        const inv = await q(env, "SELECT * FROM invites WHERE invite_code=?1", String(b.invite_code || "").trim().toUpperCase()).first();
        const user = inv?.redeemed_by_user_id ? await q(env, "SELECT * FROM users WHERE id=?1", inv.redeemed_by_user_id).first() : null;
        if (!inv || user?.role === "admin")
          fail("Enter a valid viewer invitation code.");
        if (m.invite_id || m.account_id)
          fail("Unlink the current record first.");
        try {
          await q(env, "UPDATE bot_members SET invite_id=?1,account_id=?2,ever_assigned=1 WHERE telegram_id=?3", inv.id, inv.redeemed_by_user_id, tid).run();
        } catch {
          fail("That invitation or account is already linked.", 409);
        }
      } else if (b.action === "unlink")
        await q(env, "UPDATE bot_members SET invite_id=NULL,account_id=NULL,ever_assigned=1 WHERE telegram_id=?1", tid).run();
      else if (["block", "unblock"].includes(b.action))
        await q(env, "UPDATE bot_members SET blocked=?1 WHERE telegram_id=?2", b.action === "block" ? 1 : 0, tid).run();
      else if (["ban_both", "unban_both"].includes(b.action)) {
        if (!auth.isOwner && !auth.profile.can_suspend)
          fail("Account suspension permission required.", 403);
        const banning = b.action === "ban_both";
        if (banning) {
          await env.DB.batch([q(env, "UPDATE bot_members SET blocked=1 WHERE telegram_id=?1", tid), q(env, "UPDATE invites SET status='disabled' WHERE id=?1 AND status='unused'", m.invite_id), q(env, "UPDATE users SET status='disabled' WHERE id=?1 AND role='user'", m.account_id), q(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", m.account_id)]);
          try {
            await telegram(env, "banChatMember", { chat_id: s.group_id, user_id: Number(tid) });
          } catch (e) {
            await event(env, tid, "ban_partial", "App access blocked; Telegram ban failed", id);
            fail("App access is blocked, but the Telegram ban failed. Check Mr. Charm\u2019s Ban Users permission and try again.", 409);
          }
        } else {
          await telegram(env, "unbanChatMember", { chat_id: s.group_id, user_id: Number(tid), only_if_banned: true });
          await env.DB.batch([q(env, "UPDATE bot_members SET blocked=0 WHERE telegram_id=?1", tid), q(env, "UPDATE users SET status='active' WHERE id=?1 AND role='user' AND (expires_at IS NULL OR expires_at>?2)", m.account_id, now())]);
        }
      } else
        fail("Unknown action.");
      await event(env, tid, b.action, "", id);
      return json2({ success: true });
    }
  }
  if (path === "/support-admins/sync" && method === "POST") {
    const list = await telegram(env, "getChatAdministrators", { chat_id: s.group_id });
    for (const a of list.filter((a2) => !a2.user.is_bot))
      await q(env, "INSERT INTO bot_support_admins(telegram_id,name,username) VALUES(?1,?2,?3) ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name,username=excluded.username", String(a.user.id), [a.user.first_name, a.user.last_name].filter(Boolean).join(" "), a.user.username || "").run();
    await event(env, null, "support_admins_synced", "", id);
    return json2({ success: true });
  }
  if (path === "/support-admins" && method === "GET")
    return json2({ success: true, admins: await rows(env, `SELECT s.*,c.username AS account_contact_username,u.username AS app_username FROM bot_support_admins s LEFT JOIN account_telegram_contacts c ON c.telegram_id=s.telegram_id LEFT JOIN users u ON u.id=c.user_id ORDER BY s.name`) });
  const sa = path.match(/^\/support-admins\/(\d+)$/);
  if (sa && method === "PATCH") {
    const b = await safeJson2(request);
    if (typeof b.enabled !== "boolean")
      fail("Invalid enabled choice.");
    const contact2 = b.contact_username === void 0 ? void 0 : telegramUsername(b.contact_username);
    const result = contact2 === void 0 ? await q(env, "UPDATE bot_support_admins SET enabled=?1 WHERE telegram_id=?2", b.enabled ? 1 : 0, sa[1]).run() : await q(env, "UPDATE bot_support_admins SET enabled=?1,contact_username=?2 WHERE telegram_id=?3", b.enabled ? 1 : 0, contact2, sa[1]).run();
    if (!result.meta.changes)
      fail("Support admin not found.", 404);
    await event(env, null, "support_admin_updated", sa[1], id);
    return json2({ success: true });
  }
  if (path === "/support" && method === "GET")
    return json2({ success: true, tickets: await rows(env, "SELECT t.*,m.name,m.username FROM bot_support t LEFT JOIN bot_members m ON m.telegram_id=t.telegram_id ORDER BY t.id DESC LIMIT 100") });
  const st = path.match(/^\/support\/(\d+)$/);
  if (st && method === "PATCH") {
    const b = await safeJson2(request);
    if (!["open", "in_progress", "closed"].includes(b.status))
      fail("Invalid ticket status.");
    await q(env, "UPDATE bot_support SET status=?1,updated_at=?2 WHERE id=?3", b.status, now(), Number(st[1])).run();
    await event(env, null, "support_updated", st[1], id);
    return json2({ success: true });
  }
  if (path === "/events" && method === "GET")
    return json2({ success: true, events: await rows(env, "SELECT * FROM bot_events ORDER BY id DESC LIMIT 100") });
  if (path === "/broadcast" && method === "POST") {
    const b = await safeJson2(request), c = await content(env, "broadcast");
    if (!s.enabled || !c.enabled || !c.body.trim())
      fail("Enable the bot and save an enabled broadcast first.");
    if (b.revision !== c.revision)
      fail("Broadcast changed. Preview it again.", 409);
    await q(env, "INSERT INTO bot_jobs(kind,chat_id,body,due_at) VALUES('broadcast',?1,?2,?3)", s.group_id, c.body, now()).run();
    await event(env, null, "broadcast_queued", "", id);
    return json2({ success: true });
  }
  const job = path.match(/^\/jobs\/(\d+)$/);
  if (job && method === "DELETE") {
    const r = await q(env, "UPDATE bot_jobs SET status='canceled' WHERE id=?1 AND status='pending'", Number(job[1])).run();
    if (!r.meta.changes)
      fail("This message already started or finished sending.", 409);
    return json2({ success: true });
  }
  if (path === "/connect" && method === "POST") {
    if (!auth.isOwner)
      fail("Only the owner can connect Telegram.", 403);
    if (!s.enabled)
      fail("Save and enable valid bot settings first.");
    await telegram(env, "setWebhook", { url: url.origin + "/telegram/webhook", secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query", "chat_join_request", "chat_member", "my_chat_member"], max_connections: 1, drop_pending_updates: false });
    await event(env, null, "webhook_connected", "", id);
    return json2({ success: true });
  }
  if (path === "/discover-groups" && method === "GET") {
    if (!auth.isOwner)
      fail("Only the owner can set up the bot.", 403);
    if (!env.TELEGRAM_BOT_TOKEN)
      fail("The bot token is not saved. Save TELEGRAM_BOT_TOKEN as a Cloudflare secret first.");
    try {
      const me = await telegram(env, "getMe", {});
      if (s.bot_username && me.username.toLowerCase() !== s.bot_username.toLowerCase())
        fail("The saved token belongs to @" + me.username + ", not @" + s.bot_username + ". Save the correct BotFather token.");
      const w = await telegram(env, "getWebhookInfo", {});
      if (w.url) {
        if (s.group_id) {
          const chat = await telegram(env, "getChat", { chat_id: s.group_id });
          return json2({ success: true, groups: [{ id: String(chat.id), title: chat.title }] });
        }
        fail("Telegram is connected to another bot service. Its connection must be reviewed before this panel can discover your group.");
      }
      const updates = await telegram(env, "getUpdates", { timeout: 0, allowed_updates: ["message", "my_chat_member", "chat_member", "chat_join_request"] });
      const groups = /* @__PURE__ */ new Map();
      for (const u of updates) {
        const chat = u.message?.chat || u.my_chat_member?.chat || u.chat_member?.chat || u.chat_join_request?.chat;
        if (chat && ["group", "supergroup"].includes(chat.type))
          groups.set(String(chat.id), { id: String(chat.id), title: chat.title });
      }
      const channel = updates.some((u) => (u.my_chat_member?.chat || u.channel_post?.chat)?.type === "channel");
      return json2({ success: true, groups: [...groups.values()], message: channel ? "Telegram detected a broadcast channel. Add Mr. Charm to the discussion group where members can type messages." : "No group found yet. Add @" + me.username + " as an administrator, send Mr Charm Help in the group, then click Find my Telegram group again." });
    } catch (e) {
      if (e.telegramCode === 401 || e.telegramCode === 404)
        fail("Telegram rejected the saved bot token. Copy the full token from BotFather and replace TELEGRAM_BOT_TOKEN in Cloudflare.");
      if (e.telegramCode === 409)
        fail("Another service is checking this bot\u2019s messages. Stop that service, then try Find my Telegram group again.");
      if (e.telegramCode === 429)
        fail("Telegram is temporarily limiting requests. Wait a minute, then try again.");
      if (e.status && e.status < 500)
        throw e;
      fail("Could not reach Telegram" + (e.telegramCode ? " (error " + e.telegramCode + ")" : "") + ". Please try again; if it continues, tell me this message.");
    }
  }
  if (path === "/connection" && method === "GET") {
    const me = await telegram(env, "getMe", {}), w = await telegram(env, "getWebhookInfo", {});
    return json2({ success: true, username: me.username, url: w.url, pending: w.pending_update_count, last_error: w.last_error_message || "" });
  }
  fail("Not found.", 404);
}
__name(botAdmin, "botAdmin");
__name2(botAdmin, "botAdmin");
var PROFILE_KEYS = ["enabled", ...ADMIN_FLAGS, ...Object.keys(ADMIN_LIMITS)];
var USER_SORTS = { newest: "u.created_at DESC,u.id", oldest: "u.created_at,u.id", alphabetical: "u.username COLLATE NOCASE,u.id", alphabetical_desc: "u.username COLLATE NOCASE DESC,u.id", expires_soon: "u.expires_at IS NULL,u.expires_at,u.id", most_time: "u.expires_at IS NULL DESC,u.expires_at DESC,u.id", last_login: "u.last_login_at DESC,u.id" };
var INVITE_SORTS = { newest: "i.created_at DESC,i.id", oldest: "i.created_at,i.id", expires_soon: "i.expires_at IS NULL,i.expires_at,i.id", duration: "i.account_duration_days IS NULL,i.account_duration_days,i.id", creator: "creator.username COLLATE NOCASE,i.created_at DESC,i.id" };
var ADMIN_SORTS = { newest: "u.created_at DESC,u.id", oldest: "u.created_at,u.id", alphabetical: "u.username COLLATE NOCASE,u.id", accounts_created: "st.accounts_created DESC,u.id", last_login: "u.last_login_at DESC,u.id" };
var stmt = /* @__PURE__ */ __name2((env, sql, values = []) => values.length ? env.DB.prepare(sql).bind(...values) : env.DB.prepare(sql), "stmt");
var rows2 = /* @__PURE__ */ __name2(async (env, sql, values = []) => (await stmt(env, sql, values).all()).results || [], "rows");
var first = /* @__PURE__ */ __name2((env, sql, values = []) => stmt(env, sql, values).first(), "first");
var changes = /* @__PURE__ */ __name2((result) => Number(result?.meta?.changes || 0), "changes");
var allowedBody = /* @__PURE__ */ __name2((body, keys) => {
  for (const key of Object.keys(body))
    if (!keys.includes(key))
      throw policyError(`Unsupported field: ${key}`, 400);
}, "allowedBody");
var permissionProfile = /* @__PURE__ */ __name2((row) => Object.fromEntries(PROFILE_KEYS.map((key) => [key, Number(row[key])])), "permissionProfile");
async function resolveAdminAccess(env, user) {
  if (user.role !== "admin")
    throw policyError("Administrator permission required.");
  const profile = await first(env, "SELECT p.*, CASE WHEN o.user_id=p.user_id THEN 1 ELSE 0 END AS is_owner FROM admin_profiles p LEFT JOIN admin_owner o ON o.user_id=p.user_id WHERE p.user_id=?1", [user.id]);
  if (!profile || profile.enabled !== 1)
    throw policyError("This administrator's panel access is disabled. Contact the owner.");
  return { user, profile, isOwner: profile.is_owner === 1 };
}
__name(resolveAdminAccess, "resolveAdminAccess");
__name2(resolveAdminAccess, "resolveAdminAccess");
function scope(auth, alias, values) {
  if (auth.isOwner || auth.profile.can_manage_all)
    return "1=1";
  values.push(auth.user.id);
  return `${alias}=?${values.length}`;
}
__name(scope, "scope");
__name2(scope, "scope");
async function paged(env, options, from, where, values, columns) {
  const count = Number((await first(env, `SELECT COUNT(*) AS count ${from} WHERE ${where.join(" AND ")}`, values))?.count || 0);
  const pages = Math.max(1, Math.ceil(count / options.pageSize));
  const page = Math.min(options.page, pages);
  const data = await rows2(env, `SELECT ${columns} ${from} WHERE ${where.join(" AND ")} ORDER BY ${options.orderBy} LIMIT ?${values.length + 1} OFFSET ?${values.length + 2}`, [...values, options.pageSize, (page - 1) * options.pageSize]);
  return { data, pagination: { page, page_size: options.pageSize, total: count, pages } };
}
__name(paged, "paged");
__name2(paged, "paged");
function searchWhere(options, where, values, columns) {
  if (!options.search)
    return;
  values.push(options.pattern);
  where.push(`(${columns.map((column) => `${column} LIKE ?${values.length} ESCAPE '\\'`).join(" OR ")})`);
}
__name(searchWhere, "searchWhere");
__name2(searchWhere, "searchWhere");
function creatorWhere(url, auth, where, values, column) {
  const creator = url.searchParams.get("creator");
  if (!creator)
    return;
  if (!auth.isOwner && !auth.profile.can_manage_all && creator !== auth.user.id)
    throw policyError("Other administrators' accounts are outside your scope.");
  if (creator === "unattributed")
    where.push(`${column} IS NULL`);
  else {
    values.push(creator);
    where.push(`${column}=?${values.length}`);
  }
}
__name(creatorWhere, "creatorWhere");
__name2(creatorWhere, "creatorWhere");
async function targetUser(env, auth, id) {
  const row = await first(env, "SELECT u.*,a.admin_user_id AS creator_id,a.origin FROM users u LEFT JOIN admin_user_attribution a ON a.user_id=u.id WHERE u.id=?1 AND u.role='user'", [id]);
  if (!row || !auth.isOwner && !auth.profile.can_manage_all && row.creator_id !== auth.user.id)
    throw policyError("User not found in your permitted accounts.", 404);
  if (deletionDue(row))
    throw policyError("The 30-day recovery period has ended. This account can no longer be reactivated.", 410);
  return row;
}
__name(targetUser, "targetUser");
__name2(targetUser, "targetUser");
async function targetInvite(env, auth, id) {
  const row = await first(env, "SELECT * FROM invites WHERE id=?1", [id]);
  if (!row || !auth.isOwner && !auth.profile.can_manage_all && row.created_by_user_id !== auth.user.id)
    throw policyError("Invitation not found in your permitted accounts.", 404);
  return row;
}
__name(targetInvite, "targetInvite");
__name2(targetInvite, "targetInvite");
async function ownerRecheck(auth, body, verifyPassword2) {
  if (!auth.isOwner)
    throw policyError("Only the owner can manage administrators.");
  if (!body.owner_password || !await verifyPassword2(String(body.owner_password), auth.user.password_hash))
    throw policyError("Confirm this action with your current owner password.");
}
__name(ownerRecheck, "ownerRecheck");
__name2(ownerRecheck, "ownerRecheck");
async function handleAdminRequest(request, env, helpers) {
  const { requireUser: requireUser2, json: json2, safeJson: safeJson2, publicUser: publicUser2, hashPassword: hashPassword2, verifyPassword: verifyPassword2, audit: audit2, deleteAccountData: deleteAccountData2 } = helpers;
  const session = await requireUser2(request, env, { panel: true });
  if (!session.ok)
    return session.response;
  const auth = { ...session, ...await resolveAdminAccess(env, session.user) };
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (path.startsWith("/admin/announcements"))
    return announcementAdmin(request, env, auth, helpers);
  const now2 = Math.floor(Date.now() / 1e3);
  if (path === "/admin/app-settings")
    return appControlsAdmin(request, env, auth, helpers);
  if (path.startsWith("/admin/bot/"))
    return botAdmin(request, env, auth, helpers);
  if (path === "/admin/me" && method === "GET")
    return json2({ success: true, admin: { ...publicUser2(auth.user), is_owner: auth.isOwner, permissions: permissionProfile(auth.profile) } });
  const contactRoute = path.match(/^\/admin\/(users|admins)\/([^/]+)\/telegram$/);
  if (contactRoute && ["GET", "PUT"].includes(method)) {
    const isAdmin = contactRoute[1] === "admins", targetId = contactRoute[2];
    if (isAdmin) {
      if (!auth.isOwner)
        throw policyError("Only the owner can manage administrator Telegram contacts.");
      if (!await first(env, "SELECT id FROM users WHERE id=?1 AND role='admin'", [targetId]))
        throw policyError("Administrator not found.", 404);
    } else {
      await targetUser(env, auth, targetId);
      demandPermission(auth, "can_manage_bot");
    }
    if (method === "GET")
      return json2({ success: true, ...await accountContact(env, targetId, url.searchParams.has("username") ? url.searchParams.get("username") : void 0), support_members: isAdmin ? await rows2(env, "SELECT telegram_id,name,username FROM bot_support_admins ORDER BY name") : [] });
    const body = await safeJson2(request);
    allowedBody(body, ["username", "telegram_id", "owner_password"]);
    if (isAdmin)
      await ownerRecheck(auth, body, verifyPassword2);
    const result = await saveAccountContact(env, targetId, body);
    await audit2(env, isAdmin ? null : targetId, auth.user.id, "telegram_contact_updated", isAdmin ? JSON.stringify({ admin_id: targetId }) : null);
    return json2({ success: true, ...result, message: "Telegram contact saved. Verified account and token links are unchanged." });
  }
  if (path === "/admin/creators" && method === "GET") {
    const list = await rows2(env, `SELECT u.id,u.username FROM users u JOIN admin_profiles p ON p.user_id=u.id WHERE ${auth.isOwner || auth.profile.can_manage_all ? "1=1" : "u.id=?1"} ORDER BY u.username`, auth.isOwner || auth.profile.can_manage_all ? [] : [auth.user.id]);
    return json2({ success: true, creators: list });
  }
  if (path === "/admin/users" && method === "GET") {
    const options = listingOptions(url, USER_SORTS), values = [now2], where = ["?1>=0", "u.role='user'", scope(auth, "a.admin_user_id", values)];
    searchWhere(options, where, values, ["u.username", "u.email", "tm.username", "tm.telegram_id", "ti.invite_code", "tc.username", "tc.telegram_id"]);
    creatorWhere(url, auth, where, values, "a.admin_user_id");
    const status = url.searchParams.get("status") || "all";
    if (["active", "disabled", "expired"].includes(status)) {
      values.push(status);
      where.push(`u.status=?${values.length}`);
    } else if (status === "unlimited")
      where.push("u.expires_at IS NULL");
    else if (["expiring7", "expiring14", "expiring30"].includes(status)) {
      values.push(now2 + Number(status.slice(8)) * DAY);
      where.push(`u.expires_at>?1 AND u.expires_at<=?${values.length}`);
    } else if (status !== "all")
      throw policyError("Invalid account status filter.", 400);
    const result = await paged(
      env,
      options,
      "FROM users u LEFT JOIN admin_user_attribution a ON a.user_id=u.id LEFT JOIN users creator ON creator.id=a.admin_user_id LEFT JOIN account_telegram_contacts tc ON tc.user_id=u.id LEFT JOIN bot_members tm ON tm.account_id=u.id LEFT JOIN invites ti ON ti.id=tm.invite_id",
      where,
      values,
      "tc.username AS telegram_contact_username,tc.telegram_id AS telegram_contact_id,tm.telegram_id,tm.username AS telegram_username,tm.name AS telegram_name,tm.status AS telegram_status,u.id,u.username,u.email,u.role,u.status,u.max_sessions,u.created_at,u.activated_at,u.expires_at,u.last_login_at,(SELECT MAX(s.last_activity_at) FROM sessions s WHERE s.user_id=u.id) AS last_active_at,a.admin_user_id AS created_by_admin_id,a.origin,creator.username AS created_by_admin_name,(SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.revoked=0 AND s.expires_at>?1) AS active_sessions"
    );
    return json2({ success: true, users: result.data, pagination: result.pagination });
  }
  if (path === "/admin/invites" && method === "GET") {
    const options = listingOptions(url, INVITE_SORTS), values = [], where = [scope(auth, "i.created_by_user_id", values)];
    searchWhere(options, where, values, ["i.invite_code", "redeemer.username", "tm.username", "tm.telegram_id"]);
    creatorWhere(url, auth, where, values, "i.created_by_user_id");
    const status = url.searchParams.get("status") || "all";
    if (["unused", "used", "disabled", "expired"].includes(status)) {
      values.push(now2);
      const timestamp = `?${values.length}`;
      if (status === "unused")
        where.push(`i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>${timestamp})`);
      else if (status === "expired")
        where.push(`(i.status='expired' OR (i.status='unused' AND i.expires_at<=${timestamp}))`);
      else {
        values.pop();
        values.push(status);
        where.push(`i.status=?${values.length}`);
      }
    } else if (status !== "all")
      throw policyError("Invalid invitation status filter.", 400);
    const result = await paged(
      env,
      options,
      "FROM invites i LEFT JOIN users creator ON creator.id=i.created_by_user_id LEFT JOIN users redeemer ON redeemer.id=i.redeemed_by_user_id LEFT JOIN bot_members tm ON tm.invite_id=i.id",
      where,
      values,
      "tm.telegram_id,tm.username AS telegram_username,tm.name AS telegram_name,i.id,i.invite_code,i.status,i.account_duration_days,i.max_sessions,i.created_at,i.expires_at,i.redeemed_at,i.redeemed_by_user_id,i.created_by_user_id,creator.username AS created_by_admin_name,redeemer.username AS redeemed_by_username,redeemer.status AS redeemed_user_status,redeemer.role AS redeemed_user_role"
    );
    return json2({ success: true, invites: result.data.map((i) => ({ ...i, status: i.status === "unused" && i.expires_at != null && i.expires_at <= now2 ? "expired" : i.status })), pagination: result.pagination });
  }
  if (path === "/admin/invites" && method === "POST") {
    const body = await safeJson2(request);
    allowedBody(body, ["account_duration_days", "max_sessions", "invite_expires_days"]);
    const { duration, sessions, validDays } = invitationTerms(body, auth);
    const id = crypto.randomUUID(), code = `CHARM-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const expiry = validDays === null ? null : now2 + validDays * DAY;
    const admission = auth.isOwner ? "1=1" : `EXISTS(SELECT 1 FROM admin_profiles p JOIN admin_account_stats st ON st.admin_user_id=p.user_id
      WHERE p.user_id=?6 AND p.enabled=1 AND p.revision=?9 AND p.can_create_invites=1
      AND (SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=p.user_id AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?7)) < p.max_pending_invites
      AND st.accounts_created+(SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=p.user_id AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?7)) < p.max_accounts_total
      AND (SELECT COUNT(*) FROM admin_user_attribution a JOIN users u ON u.id=a.user_id WHERE a.admin_user_id=p.user_id AND a.origin='admin_invite' AND (u.expires_at IS NULL OR u.expires_at>?7))
        +(SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=p.user_id AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?7)) < p.max_open_accounts)`;
    const values = [id, code, duration, sessions, expiry, auth.user.id, now2, "unused", ...auth.isOwner ? [] : [auth.profile.revision]];
    const inserted = await stmt(env, `INSERT INTO invites(id,invite_code,account_duration_days,max_sessions,expires_at,created_by_user_id,created_at,status)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE ${admission}`, values).run();
    if (!changes(inserted))
      throw policyError("Your account/invitation budget is full, or your permissions changed. Contact the owner.", 409);
    await audit2(env, null, auth.user.id, "invite_created", null);
    return json2({ success: true, invite: { id, invite_code: code, account_duration_days: duration, max_sessions: sessions, created_at: now2, expires_at: expiry, created_by_admin_name: auth.user.username } }, 201);
  }
  const userMatch = path.match(/^\/admin\/users\/([^/]+)(?:\/(logout|reset-password|recovery|activity))?$/);
  if (userMatch) {
    const user = await targetUser(env, auth, userMatch[1]);
    if (userMatch[2] === "activity" && method === "GET")
      return userActivity(env, auth, user, url, json2);
    if (userMatch[2] === "recovery" && method === "POST") {
      demandPermission(auth, "can_reset_password");
      const body = await safeJson2(request);
      if (body.ownership_verified !== true || !await verifyPassword2(String(body.admin_password || ""), auth.user.password_hash))
        throw policyError("Verify the owner and confirm with your current administrator password.");
      return json2({ success: true, recovery: await issueRecoveryGrant(env, user, auth.user.id, body.reason) }, 201);
    }
    if (!userMatch[2] && method === "GET") {
      const safe = Object.fromEntries(["id", "username", "email", "role", "status", "max_sessions", "created_at", "activated_at", "expires_at", "last_login_at"].map((key) => [key, user[key]]));
      const tm = await first(env, "SELECT telegram_id,username AS telegram_username,name AS telegram_name,status AS telegram_status FROM bot_members WHERE account_id=?1", [user.id]);
      return json2({ success: true, user: { ...safe, ...tm } });
    }
    if (userMatch[2] === "logout" && method === "POST") {
      demandPermission(auth, "can_force_logout");
      await stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [user.id]).run();
      await audit2(env, user.id, auth.user.id, "force_logout", null);
      return json2({ success: true, message: "All sessions revoked." });
    }
    if (userMatch[2] === "reset-password" && method === "POST") {
      demandPermission(auth, "can_reset_password");
      const body = await safeJson2(request), password = String(body.new_password || "");
      allowedBody(body, ["new_password"]);
      if (password.length < 8 || password.length > 256)
        throw policyError("Use a password of 8\u2013256 characters.", 400);
      await env.DB.batch([stmt(env, "UPDATE users SET password_hash=?1 WHERE id=?2 AND role='user'", [await hashPassword2(password), user.id]), stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [user.id])]);
      await audit2(env, user.id, auth.user.id, "password_reset_by_admin", null);
      return json2({ success: true, message: "Password changed and sessions revoked." });
    }
    if (!userMatch[2] && method === "DELETE") {
      demandPermission(auth, "can_delete_users");
      if ((await safeJson2(request)).confirmation !== user.username)
        throw policyError("Type the username to confirm permanent deletion.", 400);
      await deleteAccountData2(env, user.id, "admin_deleted");
      return json2({ success: true, message: "User and personal data permanently deleted." });
    }
    if (!userMatch[2] && method === "PATCH") {
      const body = await safeJson2(request);
      allowedBody(body, ["status", "max_sessions", "expires_at", "extend_days"]);
      if (!Object.keys(body).length)
        throw policyError("No changes supplied.", 400);
      let status = user.status, sessions = Number(user.max_sessions), expiry = user.expires_at;
      if (body.status !== void 0) {
        if (!["active", "disabled", "expired"].includes(body.status))
          throw policyError("Invalid status.", 400);
        demandPermission(auth, body.status === "expired" ? "can_delete_users" : "can_suspend");
        status = body.status;
      }
      if (body.max_sessions !== void 0) {
        demandPermission(auth, "can_change_sessions");
        sessions = integer(body.max_sessions, 1, auth.isOwner ? 20 : auth.profile.max_sessions, "Simultaneous sessions");
      }
      if (body.expires_at !== void 0 && body.extend_days !== void 0)
        throw policyError("Choose an expiry date or an extension, not both.", 400);
      if (body.expires_at !== void 0 || body.extend_days !== void 0) {
        demandPermission(auth, "can_change_time");
        if (!auth.isOwner && user.expires_at === null)
          throw policyError("Only the owner can change an unlimited account's time.");
        if (body.expires_at === null && !auth.isOwner)
          throw policyError("Only the owner can grant unlimited accounts.");
        expiry = body.extend_days !== void 0 ? Math.max(Number(user.expires_at || now2), now2) + integer(body.extend_days, 1, 3650, "Extension days") * DAY : body.expires_at === null ? null : integer(body.expires_at, 1, now2 + 3650 * DAY, "Expiration timestamp");
        if (!auth.isOwner && (expiry === null || expiry > now2 + auth.profile.max_duration_days * DAY))
          throw policyError("The resulting time remaining exceeds your owner-assigned limit. Repeated extensions cannot bypass it.");
      }
      if (status === "expired" || expiry !== null && expiry <= now2) {
        if (expiredViewer(user, now2) && body.status !== "expired" && (body.extend_days !== void 0 || body.expires_at !== void 0) && (expiry === null || expiry > now2)) {
          demandPermission(auth, "can_suspend");
          status = "active";
        } else {
          if (expiredViewer(user, now2) && body.status === "active")
            throw policyError("Add time or set a future expiration to reactivate this account.", 400);
          demandPermission(auth, "can_delete_users");
          if (url.searchParams.get("confirm_expire") !== "yes")
            throw policyError("Confirm expiration. Access stops now; the account is retained for 30 days before permanent deletion.", 400);
          expiry = body.status === "expired" && !expiredViewer(user, now2) ? now2 : expiredViewer(user, now2) ? user.expires_at : expiry;
          if (expiry !== null && expiry <= now2 - EXPIRED_RETENTION_SECONDS)
            throw policyError("Choose a more recent expiration date. That date is already beyond the 30-day recovery window.", 400);
          await stmt(env, "UPDATE users SET status='expired',expires_at=?2 WHERE id=?1 AND role='user'", [user.id, expiry ?? now2]).run();
          await retainExpiredViewer(env, user.id, now2);
          await audit2(env, user.id, auth.user.id, "account_expired_retained", JSON.stringify({ delete_after: (expiry ?? now2) + EXPIRED_RETENTION_SECONDS }));
          return json2({ success: true, message: "Account expired. It can be reactivated for 30 days after expiration, then it is permanently deleted." });
        }
      }
      if (expiredViewer(user, now2) && status === "active") {
        demandPermission(auth, "can_suspend");
        demandPermission(auth, "can_change_time");
        if (!auth.isOwner) {
          const capacity = await first(env, "SELECT p.max_open_accounts,(SELECT COUNT(*) FROM admin_user_attribution a JOIN users u ON u.id=a.user_id WHERE a.admin_user_id=p.user_id AND a.origin='admin_invite' AND (u.expires_at IS NULL OR u.expires_at>?2)) AS open_accounts FROM admin_profiles p WHERE p.user_id=?1", [user.creator_id, now2]);
          if (capacity && user.origin === "admin_invite" && capacity.open_accounts >= capacity.max_open_accounts)
            throw policyError("Reactivation would exceed the creating administrator\u2019s open-account limit. Ask the owner to increase it.");
        }
      }
      await env.DB.batch([
        stmt(env, "UPDATE users SET status=?1,max_sessions=?2,expires_at=?3 WHERE id=?4 AND role='user'", [status, sessions, expiry, user.id]),
        stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1 AND (?2!='active' OR id IN (SELECT id FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?3 ORDER BY created_at,id LIMIT MAX(0,(SELECT COUNT(*) FROM sessions WHERE user_id=?1 AND revoked=0 AND expires_at>?3)-?4)))", [user.id, status, now2, sessions])
      ]);
      await audit2(env, user.id, auth.user.id, "user_updated", JSON.stringify({ status, max_sessions: sessions, expires_at: expiry }));
      return json2({ success: true, message: expiredViewer(user, now2) && status === "active" ? "Account reactivated. The user can sign in with their existing credentials." : "User updated." });
    }
  }
  const inviteMatch = path.match(/^\/admin\/invites\/([^/]+)(?:\/(revoke))?$/);
  if (inviteMatch) {
    const invitation = await targetInvite(env, auth, inviteMatch[1]);
    if (inviteMatch[2] === "revoke" && method === "POST") {
      demandPermission(auth, "can_revoke_invites");
      if (invitation.status === "used")
        throw policyError("A used invitation cannot be revoked.", 409);
      const result = await stmt(env, "UPDATE invites SET status='disabled' WHERE id=?1 AND status!='used'", [invitation.id]).run();
      if (!changes(result))
        throw policyError("Invitation state changed. Refresh the list.", 409);
      await audit2(env, null, auth.user.id, "invite_revoked", null);
      return json2({ success: true, message: "Invitation revoked." });
    }
    if (!inviteMatch[2] && method === "DELETE") {
      demandPermission(auth, "can_delete_invites");
      await stmt(env, "DELETE FROM invites WHERE id=?1", [invitation.id]).run();
      await audit2(env, null, auth.user.id, "invite_deleted", null);
      return json2({ success: true, message: "Invitation history deleted. Existing accounts and creator attribution are unchanged." });
    }
  }
  if (path === "/admin/dashboard" && method === "GET") {
    const values = [now2], where = ["u.role='user'", scope(auth, "a.admin_user_id", values)];
    const counts = await first(env, `SELECT COUNT(*) AS total_users,COALESCE(SUM(u.status='active' AND (u.expires_at IS NULL OR u.expires_at>?1)),0) AS active_users,COALESCE(SUM(u.status='disabled'),0) AS disabled_users,COALESCE(SUM(u.status='expired' OR u.expires_at<=?1),0) AS retained_expired_users,
      COALESCE(SUM(u.expires_at IS NOT NULL AND u.expires_at>?1 AND u.expires_at<=?1+14*86400),0) AS expiring_soon,
      COALESCE(SUM((SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.revoked=0 AND s.expires_at>?1)),0) AS active_sessions
      FROM users u LEFT JOIN admin_user_attribution a ON a.user_id=u.id WHERE ${where.join(" AND ")}`, values);
    const inviteValues = [now2], inviteScope = scope(auth, "i.created_by_user_id", inviteValues);
    const pending = await first(env, `SELECT COUNT(*) AS count FROM invites i WHERE i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?1) AND ${inviteScope}`, inviteValues);
    const statsValues = [], statsScope = scope(auth, "admin_user_id", statsValues);
    const totals = await first(env, `SELECT COALESCE(SUM(accounts_expired),0) AS expired_users,COALESCE(SUM(accounts_canceled),0) AS canceled_users,COALESCE(SUM(accounts_deleted),0) AS deleted_users FROM admin_account_stats WHERE ${statsScope}`, statsValues);
    return json2({ success: true, dashboard: { ...counts, ...totals, unused_invites: Number(pending.count) } });
  }
  if (path === "/admin/activity" && method === "GET") {
    demandPermission(auth, "can_view_audit");
    const options = listingOptions(url, { newest: "l.created_at DESC,l.id", oldest: "l.created_at,l.id" }), values = [], where = [];
    if (!auth.isOwner) {
      values.push(auth.user.id);
      where.push("l.admin_user_id=?1");
    } else
      where.push("1=1");
    const result = await paged(env, options, "FROM audit_log l LEFT JOIN users actor ON actor.id=l.admin_user_id LEFT JOIN users target ON target.id=l.user_id", where, values, "l.id,l.action,l.created_at,actor.username AS admin_name,target.username AS account_name");
    return json2({ success: true, activity: result.data, pagination: result.pagination });
  }
  if (path === "/admin/admins" && method === "GET") {
    if (!auth.isOwner)
      throw policyError("Only the owner can view and manage the administrator directory.");
    const options = listingOptions(url, ADMIN_SORTS), values = [now2], where = ["?1>=0", "u.role='admin'"];
    searchWhere(options, where, values, ["u.username", "u.email", "tc.username", "tc.telegram_id"]);
    const status = url.searchParams.get("status") || "all";
    if (["enabled", "disabled"].includes(status)) {
      values.push(status === "enabled" ? 1 : 0);
      where.push(`p.enabled=?${values.length}`);
    } else if (status !== "all")
      throw policyError("Invalid administrator filter.", 400);
    const result = await paged(
      env,
      options,
      "FROM users u LEFT JOIN account_telegram_contacts tc ON tc.user_id=u.id JOIN admin_profiles p ON p.user_id=u.id JOIN admin_account_stats st ON st.admin_user_id=u.id LEFT JOIN admin_owner o ON o.user_id=u.id",
      where,
      values,
      `tc.username AS telegram_contact_username,tc.telegram_id AS telegram_contact_id,u.id,u.username,u.email,u.status,u.created_at,u.last_login_at,u.expires_at,u.max_sessions AS viewer_max_sessions,p.*,st.accounts_created,st.accounts_expired,st.accounts_canceled,st.accounts_deleted,st.invites_created,st.tracking_started_at,CASE WHEN o.user_id=u.id THEN 1 ELSE 0 END AS is_owner,
      (SELECT COUNT(*) FROM admin_user_attribution a JOIN users v ON v.id=a.user_id WHERE a.admin_user_id=u.id AND a.origin='admin_invite' AND v.status='active' AND (v.expires_at IS NULL OR v.expires_at>?1)) AS active_accounts,
      (SELECT COUNT(*) FROM admin_user_attribution a JOIN users v ON v.id=a.user_id WHERE a.admin_user_id=u.id AND a.origin='admin_invite' AND v.status='disabled') AS disabled_accounts,
      (SELECT COUNT(*) FROM admin_user_attribution a WHERE a.admin_user_id=u.id AND a.origin='referral') AS referred_accounts,
      (SELECT COUNT(*) FROM invites i WHERE i.created_by_user_id=u.id AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?1)) AS pending_invites`
    );
    return json2({ success: true, admins: result.data.map((row) => ({ ...row, permissions: permissionProfile(row) })), pagination: result.pagination });
  }
  if (path === "/admin/admins" && method === "POST") {
    const body = await safeJson2(request);
    await ownerRecheck(auth, body, verifyPassword2);
    allowedBody(body, ["username", "email", "password", "owner_password", "permissions", "existing_username", "viewing_days"]);
    if (body.existing_username !== void 0) {
      if (["username", "email", "password", "viewing_days"].some((key) => Object.hasOwn(body, key)))
        throw policyError("Choose an existing account or a new account, not both.", 400);
      const existing = await first(env, "SELECT * FROM users WHERE username=?1 COLLATE NOCASE", [String(body.existing_username).trim()]);
      if (!existing)
        throw policyError("Existing user not found. Enter their current Charming MediaLab username.", 404);
      if (existing.role !== "user")
        throw policyError("This account already has an administrator identity. Use its Permissions or Viewing access button.", 409);
      const profile2 = normalizeAdminProfile(body.permissions || {});
      await env.DB.batch([
        stmt(env, "UPDATE users SET role='admin' WHERE id=?1 AND role='user'", [existing.id]),
        stmt(env, "INSERT INTO admin_profiles(user_id,viewer_access," + PROFILE_KEYS.join(",") + ") VALUES(?1,1," + PROFILE_KEYS.map((_, i) => "?" + (i + 2)).join(",") + ")", [existing.id, ...PROFILE_KEYS.map((key) => profile2[key])]),
        stmt(env, "INSERT INTO admin_account_stats(admin_user_id) VALUES(?1)", [existing.id]),
        stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [existing.id])
      ]);
      await audit2(env, null, auth.user.id, "existing_user_granted_admin", JSON.stringify({ admin_id: existing.id }));
      return json2({ success: true, message: "Admin access added. Use the same username and password in the app and panel. Viewing time is unchanged; please sign in again.", admin: { id: existing.id, username: existing.username } }, 201);
    }
    const username = String(body.username || "").trim().toLowerCase(), email = String(body.email || "").trim().toLowerCase(), password = String(body.password || "");
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256)
      throw policyError("Enter a valid username/email and an administrator password of 12\u2013256 characters.", 400);
    const profile = normalizeAdminProfile(body.permissions || {}), id = crypto.randomUUID();
    if (await first(env, "SELECT id FROM users WHERE username=?1 OR email=?2", [username, email]))
      throw policyError("That username or email already belongs to an account. Choose Use existing user to add admin access to it.", 409);
    const viewingDays = body.viewing_days === void 0 ? void 0 : body.viewing_days === null ? null : integer(body.viewing_days, 1, 3650, "Viewing days");
    await env.DB.batch([
      stmt(env, "INSERT INTO users(id,username,email,password_hash,role,status,max_sessions,created_at,activated_at) VALUES(?1,?2,?3,?4,'admin',?5,2,?6,?6)", [id, username, email, await hashPassword2(password), "active", now2]),
      stmt(env, `INSERT INTO admin_profiles(user_id,${PROFILE_KEYS.join(",")}) VALUES(?1,${PROFILE_KEYS.map((_, i) => `?${i + 2}`).join(",")})`, [id, ...PROFILE_KEYS.map((key) => profile[key])]),
      stmt(env, "INSERT INTO admin_account_stats(admin_user_id) VALUES(?1)", [id]),
      ...viewingDays === void 0 ? [] : [
        stmt(env, "UPDATE admin_profiles SET viewer_access=1 WHERE user_id=?1", [id]),
        stmt(env, "UPDATE users SET expires_at=?2 WHERE id=?1", [id, viewingDays === null ? null : now2 + viewingDays * DAY])
      ]
    ]);
    await audit2(env, null, auth.user.id, "admin_created", JSON.stringify({ admin_id: id }));
    return json2({ success: true, message: "Administrator created with only the selected permissions.", admin: { id, username } }, 201);
  }
  const adminMatch = path.match(/^\/admin\/admins\/([^/]+)(?:\/(password|viewing))?$/);
  if (adminMatch && (method === "PATCH" || method === "POST")) {
    const body = await safeJson2(request);
    await ownerRecheck(auth, body, verifyPassword2);
    if (adminMatch[1] === auth.user.id)
      throw policyError("The owner account cannot be disabled or changed through delegated-admin controls.");
    const existing = await first(env, "SELECT p.* FROM admin_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=?1 AND u.role='admin'", [adminMatch[1]]);
    if (!existing)
      throw policyError("Administrator not found.", 404);
    if (adminMatch[2] === "viewing" && method === "PATCH") {
      allowedBody(body, ["owner_password", "viewer_access", "expires_at", "max_sessions"]);
      const enabled = integer(body.viewer_access, 0, 1, "Viewing access");
      const expiry = body.expires_at === null ? null : integer(body.expires_at, 1, now2 + 3650 * DAY, "Viewing expiration");
      const sessions = integer(body.max_sessions, 1, 20, "Viewing sessions");
      await env.DB.batch([
        stmt(env, "UPDATE admin_profiles SET viewer_access=?2,revision=revision+1,updated_at=?3 WHERE user_id=?1", [existing.user_id, enabled, now2]),
        stmt(env, "UPDATE users SET expires_at=?2,max_sessions=?3,status='active' WHERE id=?1", [existing.user_id, expiry, sessions]),
        stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [existing.user_id])
      ]);
      await audit2(env, null, auth.user.id, "admin_viewing_updated", JSON.stringify({ admin_id: existing.user_id }));
      return json2({ success: true, message: "Viewing access updated. Panel permissions are unchanged. Sign in again using the same login." });
    } else if (adminMatch[2] === "password" && method === "POST") {
      allowedBody(body, ["owner_password", "new_password"]);
      const password = String(body.new_password || "");
      if (password.length < 12 || password.length > 256)
        throw policyError("Administrator passwords require 12\u2013256 characters.", 400);
      await env.DB.batch([stmt(env, "UPDATE users SET password_hash=?1 WHERE id=?2", [await hashPassword2(password), existing.user_id]), stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [existing.user_id])]);
      await audit2(env, null, auth.user.id, "admin_password_reset", JSON.stringify({ admin_id: existing.user_id }));
    } else if (!adminMatch[2] && method === "PATCH") {
      allowedBody(body, ["owner_password", "permissions"]);
      const profile = normalizeAdminProfile(body.permissions || {}, existing);
      await env.DB.batch([
        stmt(env, `UPDATE admin_profiles SET ${PROFILE_KEYS.map((key, i) => `${key}=?${i + 1}`).join(",")},revision=revision+1,updated_at=?${PROFILE_KEYS.length + 1} WHERE user_id=?${PROFILE_KEYS.length + 2}`, [...PROFILE_KEYS.map((key) => profile[key]), now2, existing.user_id]),
        stmt(env, "UPDATE sessions SET revoked=1 WHERE user_id=?1", [existing.user_id])
      ]);
      await audit2(env, null, auth.user.id, "admin_permissions_updated", JSON.stringify({ admin_id: existing.user_id, permissions: profile }));
    } else
      throw policyError("Method not allowed.", 405);
    return json2({ success: true, message: "Administrator updated. Existing admin sessions were revoked; viewer accounts were not changed." });
  }
  return json2({ success: false, error: "Admin route not found." }, 404);
}
__name(handleAdminRequest, "handleAdminRequest");
__name2(handleAdminRequest, "handleAdminRequest");
var REFERRAL_LIMIT = 2;
var REFERRAL_ACTIVE_LIMIT = 6;
var REFERRAL_INVITE_LIFETIME_SECONDS = 3 * 24 * 60 * 60;
function addUtcMonths(timestampSeconds, months) {
  const source = new Date(timestampSeconds * 1e3);
  const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + months) / 12);
  const targetMonth = ((source.getUTCMonth() + months) % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(source.getUTCDate(), lastDay),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds()
  ) / 1e3);
}
__name(addUtcMonths, "addUtcMonths");
__name2(addUtcMonths, "addUtcMonths");
function referralCycleFor(createdAtSeconds, nowSeconds) {
  let start = Number(createdAtSeconds);
  const now2 = Number(nowSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(now2) || start <= 0) {
    throw new Error("A valid account start time and server time are required.");
  }
  if (now2 < start)
    return { startedAt: start, endsAt: addUtcMonths(start, 6) };
  const source = new Date(start * 1e3);
  const current = new Date(now2 * 1e3);
  const monthDistance = (current.getUTCFullYear() - source.getUTCFullYear()) * 12 + current.getUTCMonth() - source.getUTCMonth();
  let cycles = Math.max(0, Math.floor(monthDistance / 6));
  let candidate = addUtcMonths(start, cycles * 6);
  while (candidate > now2 && cycles > 0) {
    cycles -= 1;
    candidate = addUtcMonths(start, cycles * 6);
  }
  let end = addUtcMonths(start, (cycles + 1) * 6);
  while (end <= now2) {
    cycles += 1;
    candidate = end;
    end = addUtcMonths(start, (cycles + 1) * 6);
  }
  return { startedAt: candidate, endsAt: end };
}
__name(referralCycleFor, "referralCycleFor");
__name2(referralCycleFor, "referralCycleFor");
function referralAvailability(slots, networkSlots = []) {
  const used = slots.filter((slot) => slot.consumed_at != null).length;
  const active2 = slots.filter((slot) => slot.invite_id != null).length;
  const occupiedNetwork = networkSlots.filter((slot) => slot.invite_id != null).length;
  const allowanceAvailable = Math.max(0, REFERRAL_LIMIT - used - active2);
  const networkAvailable = Math.max(0, REFERRAL_ACTIVE_LIMIT - occupiedNetwork);
  return {
    limit: REFERRAL_LIMIT,
    active_limit: REFERRAL_ACTIVE_LIMIT,
    used,
    active: active2,
    occupied: occupiedNetwork,
    network_available: networkAvailable,
    available: Math.min(allowanceAvailable, networkAvailable)
  };
}
__name(referralAvailability, "referralAvailability");
__name2(referralAvailability, "referralAvailability");
function referralInviteExpiry(nowSeconds) {
  return Number(nowSeconds) + REFERRAL_INVITE_LIFETIME_SECONDS;
}
__name(referralInviteExpiry, "referralInviteExpiry");
__name2(referralInviteExpiry, "referralInviteExpiry");
var INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var END_STATUSES = /* @__PURE__ */ new Set(["disabled", "code_expired", "account_expired", "canceled"]);
function makeInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const characters = Array.from(bytes, (value) => INVITE_ALPHABET[value % INVITE_ALPHABET.length]);
  return `CHARM-${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}
__name(makeInviteCode, "makeInviteCode");
__name2(makeInviteCode, "makeInviteCode");
function changed(result) {
  return Number(result?.meta?.changes || 0);
}
__name(changed, "changed");
__name2(changed, "changed");
async function readAllowanceSlots(env, ownerUserId) {
  const result = await env.DB.prepare(`
    SELECT s.*, i.status AS invite_status, i.expires_at AS invite_expires_at,
      i.grant_expires_at AS invite_grant_expires_at
    FROM referral_slots s
    LEFT JOIN referral_invites i ON i.id = s.invite_id
    WHERE s.owner_user_id = ?1
    ORDER BY s.slot_number
  `).bind(ownerUserId).all();
  return result.results || [];
}
__name(readAllowanceSlots, "readAllowanceSlots");
__name2(readAllowanceSlots, "readAllowanceSlots");
async function readNetworkSlots(env, ownerUserId) {
  const result = await env.DB.prepare(`
    SELECT n.*, i.status AS invite_status
    FROM referral_network_slots n
    LEFT JOIN referral_invites i ON i.id = n.invite_id
    WHERE n.owner_user_id = ?1
    ORDER BY n.slot_number
  `).bind(ownerUserId).all();
  return result.results || [];
}
__name(readNetworkSlots, "readNetworkSlots");
__name2(readNetworkSlots, "readNetworkSlots");
async function expireUnusedInvites(env, ownerUserId, now2) {
  const expired = await env.DB.prepare(`
    SELECT id FROM referral_invites
    WHERE owner_user_id = ?1 AND status = 'unused'
      AND (expires_at <= ?2 OR (grant_expires_at IS NOT NULL AND grant_expires_at <= ?2))
  `).bind(ownerUserId, now2).all();
  for (const invitation of expired.results || []) {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE referral_invites SET status = 'code_expired', ended_at = ?2,
          end_reason = 'unused_code_expired'
        WHERE id = ?1 AND status = 'unused'
      `).bind(invitation.id, now2),
      env.DB.prepare(`UPDATE referral_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`).bind(ownerUserId, invitation.id),
      env.DB.prepare(`UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`).bind(ownerUserId, invitation.id)
    ]);
  }
}
__name(expireUnusedInvites, "expireUnusedInvites");
__name2(expireUnusedInvites, "expireUnusedInvites");
async function ensureFixedSlots(env, user, cycle) {
  await env.DB.batch(Array.from({ length: REFERRAL_LIMIT }, (_, index) => env.DB.prepare(`
    INSERT OR IGNORE INTO referral_slots (
      owner_user_id, slot_number, invite_id, consumed_at, cycle_started_at, cycle_ends_at
    ) VALUES (?1, ?2, NULL, NULL, ?3, ?4)
  `).bind(user.id, index + 1, cycle.startedAt, cycle.endsAt)));
  await env.DB.batch(Array.from({ length: REFERRAL_ACTIVE_LIMIT }, (_, index) => env.DB.prepare(`
    INSERT OR IGNORE INTO referral_network_slots (owner_user_id, slot_number, invite_id)
    VALUES (?1, ?2, NULL)
  `).bind(user.id, index + 1)));
}
__name(ensureFixedSlots, "ensureFixedSlots");
__name2(ensureFixedSlots, "ensureFixedSlots");
async function syncReferralSlots(env, user, now2) {
  const cycle = referralCycleFor(Number(user.created_at), now2);
  await ensureFixedSlots(env, user, cycle);
  await expireUnusedInvites(env, user.id, now2);
  let allowanceSlots = await readAllowanceSlots(env, user.id);
  const allowanceRepairs = [];
  for (const slot of allowanceSlots) {
    const cycleChanged = Number(slot.cycle_started_at) !== cycle.startedAt;
    const liveUnusedCode = slot.invite_id != null && slot.invite_status === "unused" && Number(slot.invite_expires_at) > now2 && (slot.invite_grant_expires_at == null || Number(slot.invite_grant_expires_at) > now2);
    if (cycleChanged) {
      allowanceRepairs.push(env.DB.prepare(`
        UPDATE referral_slots SET invite_id = ?3, consumed_at = NULL,
          cycle_started_at = ?4, cycle_ends_at = ?5
        WHERE owner_user_id = ?1 AND slot_number = ?2
      `).bind(user.id, slot.slot_number, liveUnusedCode ? slot.invite_id : null, cycle.startedAt, cycle.endsAt));
    } else if (slot.invite_id != null && !liveUnusedCode) {
      allowanceRepairs.push(env.DB.prepare(`
        UPDATE referral_slots SET invite_id = NULL
        WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id = ?3
      `).bind(user.id, slot.slot_number, slot.invite_id));
    }
  }
  if (allowanceRepairs.length)
    await env.DB.batch(allowanceRepairs);
  const networkSlots = await readNetworkSlots(env, user.id);
  const networkRepairs = networkSlots.filter((slot) => slot.invite_id != null && !["unused", "active"].includes(slot.invite_status)).map((slot) => env.DB.prepare(`
      UPDATE referral_network_slots SET invite_id = NULL
      WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id = ?3
    `).bind(user.id, slot.slot_number, slot.invite_id));
  if (networkRepairs.length)
    await env.DB.batch(networkRepairs);
  allowanceSlots = await readAllowanceSlots(env, user.id);
  return { cycle, allowanceSlots, networkSlots: await readNetworkSlots(env, user.id) };
}
__name(syncReferralSlots, "syncReferralSlots");
__name2(syncReferralSlots, "syncReferralSlots");
async function releaseReferralForAccount(env, redeemedUserId, reason, now2) {
  const invitation = await env.DB.prepare(`
    SELECT id, owner_user_id FROM referral_invites
    WHERE redeemed_by_user_id = ?1 AND status = 'active'
    ORDER BY redeemed_at DESC LIMIT 1
  `).bind(redeemedUserId).first();
  if (!invitation)
    return false;
  const status = reason === "account_expired" ? "account_expired" : "canceled";
  const ended = await env.DB.prepare(`
    UPDATE referral_invites SET status = ?2, redeemed_by_user_id = NULL,
      ended_at = ?3, end_reason = ?4
    WHERE id = ?1 AND status = 'active'
  `).bind(invitation.id, status, now2, reason).run();
  if (changed(ended) !== 1)
    return false;
  await env.DB.batch([
    env.DB.prepare(`UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`).bind(invitation.owner_user_id, invitation.id),
    env.DB.prepare(`
      UPDATE referral_slots SET consumed_at = NULL
      WHERE owner_user_id = ?1 AND slot_number = (
        SELECT slot_number FROM referral_slots
        WHERE owner_user_id = ?1 AND consumed_at IS NOT NULL AND invite_id IS NULL
        ORDER BY consumed_at DESC LIMIT 1
      )
    `).bind(invitation.owner_user_id)
  ]);
  return true;
}
__name(releaseReferralForAccount, "releaseReferralForAccount");
__name2(releaseReferralForAccount, "releaseReferralForAccount");
async function releaseEndedAccountsForOwner(env, ownerUserId, now2) {
  const result = await env.DB.prepare(`
    SELECT i.redeemed_by_user_id
    FROM referral_invites i
    LEFT JOIN users u ON u.id = i.redeemed_by_user_id
    WHERE i.owner_user_id = ?1 AND i.status = 'active'
      AND (u.id IS NULL OR u.status != 'active' OR (u.expires_at IS NOT NULL AND u.expires_at <= ?2))
  `).bind(ownerUserId, now2).all();
  for (const row of result.results || []) {
    if (row.redeemed_by_user_id) {
      await releaseReferralForAccount(env, row.redeemed_by_user_id, "account_expired", now2);
    }
  }
}
__name(releaseEndedAccountsForOwner, "releaseEndedAccountsForOwner");
__name2(releaseEndedAccountsForOwner, "releaseEndedAccountsForOwner");
async function buildReferralSummary(env, user, now2) {
  await syncReferralSlots(env, user, now2);
  await releaseEndedAccountsForOwner(env, user.id, now2);
  const { cycle, allowanceSlots, networkSlots } = await syncReferralSlots(env, user, now2);
  const availability = referralAvailability(allowanceSlots, networkSlots);
  const inviteResult = await env.DB.prepare(`
    SELECT i.id, i.invite_code, i.status, i.network_slot_number, i.created_at,
      i.expires_at, i.redeemed_at, i.ended_at, i.end_reason,
      CASE WHEN i.status = 'active' THEN u.expires_at ELSE NULL END AS account_expires_at
    FROM referral_invites i
    LEFT JOIN users u ON u.id = i.redeemed_by_user_id
    WHERE i.owner_user_id = ?1
    ORDER BY COALESCE(i.network_slot_number, 99), i.created_at DESC
    LIMIT 50
  `).bind(user.id).all();
  const invitations = inviteResult.results || [];
  return {
    ...availability,
    ...user.role === "admin" && !user.viewer_access || user.expires_at == null ? {
      available: 0,
      generation_disabled_reason: "Family-and-friend invites are disabled for unlimited accounts and accounts without TV access."
    } : {},
    active_accounts: invitations.filter((item) => item.status === "active").length,
    cycle_started_at: cycle.startedAt,
    renews_at: cycle.endsAt,
    invitations
  };
}
__name(buildReferralSummary, "buildReferralSummary");
__name2(buildReferralSummary, "buildReferralSummary");
async function reserveSlot(env, tableName, userId, inviteId, slots) {
  for (const slot of slots) {
    if (slot.invite_id != null || tableName === "referral_slots" && slot.consumed_at != null)
      continue;
    const allowanceClause = tableName === "referral_slots" ? "AND consumed_at IS NULL" : "";
    const result = await env.DB.prepare(`
      UPDATE ${tableName} SET invite_id = ?3
      WHERE owner_user_id = ?1 AND slot_number = ?2 AND invite_id IS NULL ${allowanceClause}
    `).bind(userId, slot.slot_number, inviteId).run();
    if (changed(result) === 1)
      return Number(slot.slot_number);
  }
  return null;
}
__name(reserveSlot, "reserveSlot");
__name2(reserveSlot, "reserveSlot");
async function createReferralInvitation(env, user, now2) {
  if (user.role === "admin" && !user.viewer_access || user.expires_at == null)
    throw policyError("Family-and-friend invites are disabled for unlimited accounts and accounts without TV access.");
  if (user.status !== "active" || !Number.isSafeInteger(Number(user.expires_at)) || Number(user.expires_at) <= now2)
    throw policyError("Only an active timed account can generate an invitation.", 410);
  const state = await syncReferralSlots(env, user, now2);
  if (referralAvailability(state.allowanceSlots, state.networkSlots).available < 1) {
    const error = new Error("You have no invitations available right now.");
    error.status = 409;
    throw error;
  }
  const invitationId = crypto.randomUUID();
  const networkSlotNumber = await reserveSlot(env, "referral_network_slots", user.id, invitationId, state.networkSlots);
  if (networkSlotNumber == null) {
    const error = new Error("All six invited-account positions are currently in use.");
    error.status = 409;
    throw error;
  }
  const allowanceSlotNumber = await reserveSlot(env, "referral_slots", user.id, invitationId, state.allowanceSlots);
  if (allowanceSlotNumber == null) {
    await env.DB.prepare(`UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`).bind(user.id, invitationId).run();
    const error = new Error("You have no invitations available right now.");
    error.status = 409;
    throw error;
  }
  const expiresAt = referralInviteExpiry(now2);
  let invitation = null;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = makeInviteCode();
      try {
        await env.DB.prepare(`
          INSERT INTO referral_invites (
            id, invite_code, owner_user_id, status, network_slot_number,
            max_sessions, grant_expires_at, created_at, expires_at
          ) VALUES (?1, ?2, ?3, 'unused', ?4, ?5, ?6, ?7, ?8)
        `).bind(
          invitationId,
          inviteCode,
          user.id,
          networkSlotNumber,
          Math.max(1, Number(user.max_sessions || 1)),
          user.expires_at == null ? null : Number(user.expires_at),
          now2,
          expiresAt
        ).run();
        invitation = {
          id: invitationId,
          invite_code: inviteCode,
          status: "unused",
          network_slot_number: networkSlotNumber,
          created_at: now2,
          expires_at: expiresAt,
          redeemed_at: null,
          ended_at: null,
          account_expires_at: null
        };
        break;
      } catch (error) {
        if (attempt === 4)
          throw error;
      }
    }
  } finally {
    if (!invitation) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE referral_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`).bind(user.id, invitationId),
        env.DB.prepare(`UPDATE referral_network_slots SET invite_id = NULL WHERE owner_user_id = ?1 AND invite_id = ?2`).bind(user.id, invitationId)
      ]);
    }
  }
  return invitation;
}
__name(createReferralInvitation, "createReferralInvitation");
__name2(createReferralInvitation, "createReferralInvitation");
async function deleteReferralHistory(env, ownerUserId, invitationId) {
  const invitation = await env.DB.prepare(`
    SELECT id, status FROM referral_invites WHERE id = ?1 AND owner_user_id = ?2 LIMIT 1
  `).bind(invitationId, ownerUserId).first();
  if (!invitation)
    return { ok: false, status: 404, error: "Invitation not found." };
  if (!END_STATUSES.has(invitation.status)) {
    return { ok: false, status: 409, error: "Only expired, canceled, or disabled invitation history can be deleted." };
  }
  await env.DB.prepare(`DELETE FROM referral_invites WHERE id = ?1 AND owner_user_id = ?2`).bind(invitationId, ownerUserId).run();
  return { ok: true };
}
__name(deleteReferralHistory, "deleteReferralHistory");
__name2(deleteReferralHistory, "deleteReferralHistory");
async function registerInvitedAccount(request, env, helpers) {
  const { safeJson: safeJson2, json: json2, hashPassword: hashPassword2, issueSession: issueSession2, publicUser: publicUser2, audit: audit2 } = helpers;
  const body = await safeJson2(request);
  const code = String(body.invite_code || "").trim().toUpperCase();
  const username = String(body.username || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!code)
    throw policyError("Invitation code is required.", 400);
  if (!/^[a-z0-9._-]{3,32}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw policyError("Enter a valid username and email.", 400);
  if (password.length < 8 || password.length > 256)
    throw policyError("Use a password of 8\u2013256 characters.", 400);
  const adminInvite = await env.DB.prepare("SELECT * FROM invites WHERE invite_code=?1").bind(code).first();
  const referral = adminInvite ? null : await env.DB.prepare("SELECT * FROM referral_invites WHERE invite_code=?1").bind(code).first();
  const invitation = adminInvite || referral;
  if (!invitation)
    throw policyError("Invalid invitation code.", 404);
  const recipient = adminInvite ? await env.DB.prepare("SELECT telegram_id,blocked FROM bot_members WHERE invite_id=?1").bind(invitation.id).first() : null;
  let challengeHash = null;
  if (recipient) {
    if (!body.challenge_token)
      return json2({ success: false, error: "Approve this registration in Telegram using the latest app. Update the app if this option is missing.", code: "TELEGRAM_APPROVAL_REQUIRED" }, 403);
    const challenge = await loadChallenge(env, body.challenge_token), details = JSON.parse(challenge.payload);
    if (recipient.blocked || challenge.kind !== "registration" || challenge.status !== "approved" || challenge.telegram_id !== recipient.telegram_id || details.invite_id !== invitation.id || details.username !== username || details.email !== email)
      throw policyError("This registration has not been approved by its Telegram recipient.", 403);
    challengeHash = await securityHash(body.challenge_token);
  }
  let now2 = Math.floor(Date.now() / 1e3);
  if (invitation.status !== "unused")
    throw policyError("This invitation is no longer available.", 409);
  if (invitation.expires_at !== null && invitation.expires_at <= now2)
    throw policyError("This invitation has expired.", 410);
  if (referral) {
    const inviter = await env.DB.prepare("SELECT u.*,COALESCE(p.viewer_access,0) viewer_access FROM users u LEFT JOIN admin_profiles p ON p.user_id=u.id WHERE u.id=?1").bind(referral.owner_user_id).first();
    referralAccess(referral, inviter, now2);
    await syncReferralSlots(env, inviter, now2);
  }
  const id = crypto.randomUUID(), hash = await hashPassword2(password);
  now2 = Math.floor(Date.now() / 1e3);
  const parameters = [id, username, email, hash, now2, invitation.id];
  let statements;
  if (adminInvite) {
    statements = [
      env.DB.prepare(`INSERT INTO users(id,username,email,password_hash,role,status,max_sessions,created_at,activated_at,expires_at)
        SELECT ?1,?2,?3,?4,'user','active',i.max_sessions,?5,?5,
          CASE WHEN i.account_duration_days IS NULL THEN NULL ELSE ?5+i.account_duration_days*${DAY} END
        FROM invites i JOIN users creator ON creator.id=i.created_by_user_id
        JOIN admin_profiles p ON p.user_id=creator.id JOIN admin_account_stats st ON st.admin_user_id=creator.id
        LEFT JOIN admin_owner o ON o.user_id=creator.id
        WHERE i.id=?6 AND i.status='unused' AND (i.expires_at IS NULL OR i.expires_at>?5)
          AND creator.role='admin' AND p.enabled=1
          AND (NOT EXISTS(SELECT 1 FROM bot_members WHERE invite_id=i.id) OR EXISTS(
            SELECT 1 FROM account_challenges c JOIN bot_members m ON m.telegram_id=c.telegram_id
            WHERE c.token_hash=?7 AND c.kind='registration' AND c.status='approved' AND c.expires_at>?5
              AND m.invite_id=i.id AND m.blocked=0 AND m.account_id IS NULL
              AND json_extract(c.payload,'$.invite_id')=i.id AND json_extract(c.payload,'$.username')=?2 AND json_extract(c.payload,'$.email')=?3))
          AND (o.user_id IS NOT NULL OR (p.can_create_invites=1
            AND i.account_duration_days IS NOT NULL AND i.account_duration_days BETWEEN 1 AND p.max_duration_days
            AND i.max_sessions BETWEEN 1 AND p.max_sessions
            AND i.expires_at IS NOT NULL AND i.expires_at-i.created_at<=p.max_invite_valid_days*${DAY}
            AND st.accounts_created<p.max_accounts_total
            AND (SELECT COUNT(*) FROM admin_user_attribution a JOIN users u ON u.id=a.user_id
              WHERE a.admin_user_id=p.user_id AND a.origin='admin_invite' AND (u.expires_at IS NULL OR u.expires_at>?5))<p.max_open_accounts))`).bind(...parameters, challengeHash),
      env.DB.prepare("UPDATE invites SET status='used',redeemed_by_user_id=?1,redeemed_at=?2 WHERE id=?3 AND status='unused' AND EXISTS(SELECT 1 FROM users WHERE id=?1)").bind(id, now2, invitation.id),
      env.DB.prepare(`INSERT INTO admin_user_attribution(user_id,admin_user_id,origin,created_at)
        SELECT ?1,created_by_user_id,'admin_invite',?2 FROM invites WHERE id=?3 AND redeemed_by_user_id=?1`).bind(id, now2, invitation.id)
    ];
  } else {
    statements = [
      env.DB.prepare(`INSERT INTO users(id,username,email,password_hash,role,status,max_sessions,created_at,activated_at,expires_at)
        SELECT ?1,?2,?3,?4,'user','active',MIN(i.max_sessions,u.max_sessions),?5,?5,MIN(i.grant_expires_at,u.expires_at)
        FROM referral_invites i JOIN users u ON u.id=i.owner_user_id
        WHERE i.id=?6 AND i.status='unused' AND i.expires_at>?5
          AND (u.role='user' OR EXISTS(SELECT 1 FROM admin_profiles p WHERE p.user_id=u.id AND p.viewer_access=1)) AND u.status='active' AND u.expires_at IS NOT NULL AND u.expires_at>?5
          AND i.grant_expires_at IS NOT NULL AND i.grant_expires_at>?5
          AND EXISTS(SELECT 1 FROM referral_slots s WHERE s.owner_user_id=u.id AND s.invite_id=i.id AND s.consumed_at IS NULL)
          AND EXISTS(SELECT 1 FROM referral_network_slots n WHERE n.owner_user_id=u.id AND n.invite_id=i.id)`).bind(...parameters),
      env.DB.prepare("UPDATE referral_invites SET status='active',redeemed_by_user_id=?1,redeemed_at=?2 WHERE id=?3 AND status='unused' AND EXISTS(SELECT 1 FROM users WHERE id=?1)").bind(id, now2, invitation.id),
      env.DB.prepare(`UPDATE referral_slots SET invite_id=NULL,consumed_at=?2 WHERE invite_id=?3
        AND EXISTS(SELECT 1 FROM referral_invites WHERE id=?3 AND redeemed_by_user_id=?1)`).bind(id, now2, invitation.id),
      env.DB.prepare(`INSERT INTO admin_user_attribution(user_id,admin_user_id,origin,created_at)
        SELECT ?1,a.admin_user_id,'referral',?2 FROM referral_invites i JOIN admin_user_attribution a ON a.user_id=i.owner_user_id
        WHERE i.id=?3 AND i.redeemed_by_user_id=?1`).bind(id, now2, invitation.id)
    ];
  }
  let results;
  if (challengeHash)
    statements.push(env.DB.prepare("UPDATE account_challenges SET status='consumed',completion_id=?1 WHERE token_hash=?2 AND status='approved' AND EXISTS(SELECT 1 FROM users WHERE id=?1)").bind(id, challengeHash));
  try {
    results = await env.DB.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint failed: users\.(username|email)/i.test(String(error.message)))
      throw policyError("That username or email is already registered.", 409);
    throw error;
  }
  if (Number(results[0]?.meta?.changes || 0) !== 1)
    throw policyError("This code is no longer available, or its issuer's access or limits changed. Request another invitation.", 409);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id=?1").bind(id).first();
  const issued = await issueSession2(env, user, now2, "account_registered");
  return json2({ success: true, token: issued.token, session_expires_at: issued.expiresAt, user: publicUser2(user) }, 201);
}
__name(registerInvitedAccount, "registerInvitedAccount");
__name2(registerInvitedAccount, "registerInvitedAccount");
var DAY2 = 86400;
var SESSION_DAYS = 30;
var PBKDF2_ITERATIONS = 6e4;
var MANAGED_SOURCE_SLOTS = [
  { id: "primary", playlist: "M3U_URL", epg: "EPG_URL", required: true },
  { id: "secondary", playlist: "M3U_URL_2", epg: "EPG_URL_2", required: true },
  { id: "tertiary", playlist: "M3U_URL_3", epg: "EPG_URL_3", required: false },
  { id: "quaternary", playlist: "M3U_URL_4", epg: "EPG_URL_4", required: false }
];
function accountAdminHelpers() {
  return { json, safeJson, publicUser, hashPassword, verifyPassword, audit, deleteAccountData };
}
__name(accountAdminHelpers, "accountAdminHelpers");
__name2(accountAdminHelpers, "accountAdminHelpers");
var worker_default = {
  async fetch(request, env, ctx) {
    try {
      if (request.method === "OPTIONS")
        return corsResponse(null, 204);
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/public/app-release" && request.method === "GET")
        return json({ success: true, release: await releaseConfig(env) });
      if (path === "/me/activity" && request.method === "POST") {
        const auth = await requireUser(request, env);
        if (!auth.ok)
          return auth.response;
        return usageHeartbeat(request, env, auth, { json, safeJson });
      }
      if (path === "/telegram/webhook")
        return await webhook(request, env);
      if (path.startsWith("/announcements")) {
        const auth = await requireUser(request, env);
        if (!auth.ok)
          return auth.response;
        return await announcementClient(request, env, auth, { json, safeJson });
      }
      if (path.startsWith("/auth/challenges") || ["/auth/community", "/auth/reset-password", "/auth/registration-policy", "/me/password", "/me/security"].includes(path)) {
        const response = await securityApi(request, env, { json, safeJson, requireUser, verifyPassword, hashPassword, audit });
        if (response)
          return response;
      }
      await purgeExpiredAccounts(env, 50);
      if (path === "/" && request.method === "GET") {
        return json({ success: true, service: "Charming MediaLab Account API", status: "online", referral_active_limit: 6 });
      }
      if (path === "/health" && request.method === "GET") {
        const sources = managedSourceConfiguration(env);
        return json({
          success: true,
          database: !!env.DB,
          admin_controls_version: 1,
          shared_admin_login_version: 1,
          content_sources_ready: sources.ready,
          configured_source_count: sources.configured.length,
          content_sources: Object.fromEntries(sources.slots.map((source) => [source.id, source.state === "configured"]))
        });
      }
      if (path === "/setup-admin" && request.method === "POST")
        return await setupAdmin(request, env);
      if (path === "/auth/register" && request.method === "POST")
        return await registerWithInvite(request, env);
      if (path === "/auth/login" && request.method === "POST")
        return await login(request, env);
      if (path === "/auth/logout" && request.method === "POST") {
        const auth = await requireUser(request, env, { panel: true });
        if (!auth.ok)
          return auth.response;
        await env.DB.batch([
          env.DB.prepare("UPDATE sessions SET revoked=1 WHERE id=?1").bind(auth.session.id),
          env.DB.prepare("INSERT INTO audit_log(user_id,admin_user_id,action,details,created_at) VALUES(?1,NULL,\'logout\',NULL,?2)").bind(auth.user.id, unixNow())
        ]);
        return json({ success: true, message: "Logged out." });
      }
      if (path === "/me" && request.method === "GET") {
        const auth = await requireUser(request, env);
        if (!auth.ok)
          return auth.response;
        return json({ success: true, user: publicUser(auth.user) });
      }
      if (path === "/content/access" && request.method === "GET")
        return await createContentAccess(request, env);
      if (path === "/me" && request.method === "DELETE") {
        const auth = await requireUser(request, env);
        if (!auth.ok)
          return auth.response;
        if (auth.user.role === "admin")
          return json({ success: false, error: "Administrator accounts cannot be canceled in the app." }, 400);
        const body = await safeJson(request);
        if (String(body.confirmation || "").trim().toLowerCase() !== "please cancel me") {
          return json({ success: false, error: 'Type "please cancel me" to confirm permanent deletion.' }, 400);
        }
        if (!body.password || !await verifyPassword(String(body.password), auth.user.password_hash)) {
          return json({ success: false, error: "Your current password is incorrect." }, 403);
        }
        await deleteAccountData(env, auth.user.id, "user_canceled");
        return json({ success: true, message: "Account and personal data permanently deleted." });
      }
      if (path === "/referrals" && request.method === "GET") {
        const auth = await requireUser(request, env);
        if (!auth.ok)
          return auth.response;
        return json({ success: true, referral: await buildReferralSummary(env, auth.user, unixNow()) });
      }
      if (path === "/referrals/invites" && request.method === "POST") {
        const auth = await requireUser(request, env);
        if (!auth.ok)
          return auth.response;
        const invitation = await createReferralInvitation(env, auth.user, unixNow());
        await audit(env, auth.user.id, auth.user.id, "referral_invite_created", null);
        return json({ success: true, invitation, referral: await buildReferralSummary(env, auth.user, unixNow()) }, 201);
      }
      const referralDeleteMatch = path.match(/^\/referrals\/invites\/([^/]+)$/);
      if (referralDeleteMatch && request.method === "DELETE") {
        const auth = await requireUser(request, env);
        if (!auth.ok)
          return auth.response;
        const deleted = await deleteReferralHistory(env, auth.user.id, referralDeleteMatch[1]);
        if (!deleted.ok)
          return json({ success: false, error: deleted.error }, deleted.status);
        return json({ success: true, referral: await buildReferralSummary(env, auth.user, unixNow()) });
      }
      if (path.startsWith("/admin/"))
        return await handleAdminRequest(request, env, {
          requireUser,
          json,
          safeJson,
          publicUser,
          hashPassword,
          verifyPassword,
          audit,
          deleteAccountData
        });
      return json({ success: false, error: "Route not found." }, 404);
    } catch (error) {
      const status = Number(error?.status || 500);
      if (status >= 500) {
        console.error(JSON.stringify({ event: "account_service_error", status }));
        if (ctx)
          ctx.waitUntil(recordServiceError(env));
        else
          await recordServiceError(env);
      }
      return json({ success: false, error: status >= 500 ? "The account service could not complete this request." : error.message }, status);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(purgeExpiredAccounts(env, 1e3));
    ctx.waitUntil(botScheduled(env));
  }
};
async function setupAdmin(request, env) {
  if (!env.ADMIN_SETUP_KEY)
    return json({ success: false, error: "ADMIN_SETUP_KEY has not been configured." }, 500);
  const supplied = request.headers.get("X-Setup-Key");
  if (!supplied || !constantTimeEqual(supplied, env.ADMIN_SETUP_KEY))
    return json({ success: false, error: "Invalid setup key." }, 403);
  if (await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first()) {
    return json({ success: false, error: "An administrator already exists. Initial setup is disabled." }, 409);
  }
  const body = await safeJson(request);
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!validUsername(username) || !validEmail(email) || password.length < 8) {
    return json({ success: false, error: "Enter a valid username, email, and password of at least 8 characters." }, 400);
  }
  const id = crypto.randomUUID();
  const now2 = unixNow();
  await env.DB.prepare(`INSERT INTO users
    (id, username, email, password_hash, role, status, max_sessions, created_at, activated_at)
    VALUES (?1, ?2, ?3, ?4, 'admin', 'active', 5, ?5, ?5)`).bind(id, username, email, await hashPassword(password), now2).run();
  await audit(env, id, id, "initial_admin_created", null);
  return json({ success: true, message: "Charming MediaLab administrator created successfully.", admin: { id, username, email } }, 201);
}
__name(setupAdmin, "setupAdmin");
__name2(setupAdmin, "setupAdmin");
async function registerWithInvite(request, env) {
  return registerInvitedAccount(request, env, { json, safeJson, hashPassword, issueSession, publicUser, audit });
}
__name(registerWithInvite, "registerWithInvite");
__name2(registerWithInvite, "registerWithInvite");
async function login(request, env) {
  const body = await safeJson(request);
  const loginValue = String(body.login ?? body.username ?? body.email ?? "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!loginValue || !password)
    return json({ success: false, error: "Username/email and password are required." }, 400);
  const user = await env.DB.prepare("SELECT * FROM users WHERE lower(username) = ?1 OR lower(email) = ?1 LIMIT 1").bind(loginValue).first();
  if (!user || !await verifyPassword(password, user.password_hash)) {
    if (user) await audit(env, user.id, null, "login_failed", null);
    return json({ success: false, error: "Invalid username/email or password." }, 401);
  }
  const now2 = unixNow();
  if (user.role !== "admin" && user.status === "disabled")
    return json({ success: false, error: "This Charming MediaLab account has been disabled." }, 403);
  if (user.role !== "admin" && (user.status === "expired" || user.expires_at !== null && Number(user.expires_at) <= now2)) {
    await retainExpiredViewer(env, user.id, now2);
    return json({ success: false, error: "This Charming MediaLab account has expired. Contact an administrator to reactivate it within 30 days of expiration." }, 403);
  }
  await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1 AND revoked = 0 AND expires_at <= ?2").bind(user.id, now2).run();
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked = 0 AND expires_at > ?2").bind(user.id, now2).first();
  const activeCount = Number(countRow?.count || 0);
  const maxSessions = Math.max(1, Number(user.max_sessions || 1));
  if (activeCount >= maxSessions) {
    const oldest = await env.DB.prepare(`SELECT id FROM sessions WHERE user_id = ?1 AND revoked = 0 AND expires_at > ?2
      ORDER BY last_activity_at ASC LIMIT ?3`).bind(user.id, now2, activeCount - maxSessions + 1).all();
    for (const session of oldest.results || []) {
      await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?1").bind(session.id).run();
    }
  }
  const issued = await issueSession(env, user, now2);

  return json({ success: true, token: issued.token, session_expires_at: issued.expiresAt, user: publicUser(user) });
}
__name(login, "login");
__name2(login, "login");
async function issueSession(env, user, now2, action = "login") {
  const token = secureToken(48);
  const expiresAt = now2 + SESSION_DAYS * DAY2;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions
      (id, user_id, token_hash, created_at, last_activity_at, expires_at, revoked)
      VALUES (?1, ?2, ?3, ?4, ?4, ?5, 0)`).bind(crypto.randomUUID(), user.id, await sha256(token), now2, expiresAt),
    env.DB.prepare("UPDATE users SET last_login_at=?1 WHERE id=?2").bind(now2, user.id),
    env.DB.prepare("INSERT INTO audit_log(user_id,admin_user_id,action,details,created_at) VALUES(?1,NULL,?2,NULL,?3)").bind(user.id, action, now2)
  ]);
  user.last_login_at = now2;
  return { token, expiresAt };
}
__name(issueSession, "issueSession");
__name2(issueSession, "issueSession");
async function deleteAccountData(env, userId, reason, expiredBefore = null) {
  const user = await env.DB.prepare("SELECT id,role FROM users WHERE id = ?1 LIMIT 1").bind(userId).first();
  if (!user)
    return false;
  if (user.role !== "user")
    throw statusError("Administrator accounts cannot be deleted through viewer-account controls.", 403);
  const now2 = unixNow();
  const guard = expiredBefore === null ? "" : ` AND EXISTS(SELECT 1 FROM users retained WHERE retained.id=?1 AND retained.role='user' AND retained.expires_at<=${Number(expiredBefore)})`;
  const referralCleanup = [];
  if (expiredBefore === null)
    await releaseReferralForAccount(env, userId, reason, now2);
  else {
    const invitation = await env.DB.prepare("SELECT id,owner_user_id FROM referral_invites WHERE redeemed_by_user_id=?1 AND status='active' ORDER BY redeemed_at DESC LIMIT 1").bind(userId).first();
    if (invitation) {
      referralCleanup.push(
        env.DB.prepare("UPDATE referral_network_slots SET invite_id=NULL WHERE owner_user_id=?2 AND invite_id=?3" + guard).bind(userId, invitation.owner_user_id, invitation.id),
        env.DB.prepare("UPDATE referral_slots SET consumed_at=NULL WHERE owner_user_id=?2 AND slot_number=(SELECT slot_number FROM referral_slots WHERE owner_user_id=?2 AND consumed_at IS NOT NULL AND invite_id IS NULL ORDER BY consumed_at DESC LIMIT 1)" + guard).bind(userId, invitation.owner_user_id),
        env.DB.prepare("UPDATE referral_invites SET status='account_expired',redeemed_by_user_id=NULL,ended_at=?3,end_reason='account_expired' WHERE id=?2 AND status='active'" + guard).bind(userId, invitation.id, now2)
      );
    }
  }
  await env.DB.batch([
    ...referralCleanup,
    env.DB.prepare("UPDATE admin_user_attribution SET end_reason=?2 WHERE user_id=?1" + guard).bind(userId, reason),
    env.DB.prepare("UPDATE invites SET redeemed_by_user_id=NULL WHERE redeemed_by_user_id=?1" + guard).bind(userId),
    env.DB.prepare("UPDATE invites SET created_by_user_id=NULL WHERE created_by_user_id=?1" + guard).bind(userId),
    env.DB.prepare("DELETE FROM audit_log WHERE (user_id=?1 OR admin_user_id=?1)" + guard).bind(userId),
    env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id=?1" + guard).bind(userId),
    env.DB.prepare("DELETE FROM user_preferences WHERE user_id=?1" + guard).bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id=?1" + guard).bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id=?1 AND role='user'" + guard).bind(userId)
  ]);
  return true;
}
__name(deleteAccountData, "deleteAccountData");
__name2(deleteAccountData, "deleteAccountData");
async function purgeExpiredAccounts(env, limit2) {
  const at = unixNow(), cutoff = at - EXPIRED_RETENTION_SECONDS;
  const result = await env.DB.prepare(`SELECT id FROM users WHERE role='user' AND (expires_at<=?1 OR (status!='expired' AND expires_at<=?2) OR (status='expired' AND (expires_at IS NULL OR expires_at>?2))) ORDER BY expires_at,id LIMIT ?3`).bind(cutoff, at, limit2).all();
  for (const user of result.results || []) {
    await retainExpiredViewer(env, user.id, at);
    const retained = await env.DB.prepare("SELECT expires_at FROM users WHERE id=?1").bind(user.id).first();
    if (retained?.expires_at !== null && retained?.expires_at <= cutoff)
      await deleteAccountData(env, user.id, "account_expired", cutoff);
  }
  const endedAdmins = await env.DB.prepare("SELECT u.id FROM users u JOIN referral_invites i ON i.redeemed_by_user_id=u.id AND i.status='active' WHERE u.role='admin' AND u.expires_at IS NOT NULL AND u.expires_at<=?1 LIMIT ?2").bind(unixNow(), limit2).all();
  for (const user of endedAdmins.results || [])
    await releaseReferralForAccount(env, user.id, "account_expired", unixNow());
  return (result.results || []).length;
}
__name(purgeExpiredAccounts, "purgeExpiredAccounts");
__name2(purgeExpiredAccounts, "purgeExpiredAccounts");
async function requireUser(request, env, { panel = false } = {}) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer "))
    return { ok: false, response: json({ success: false, error: "Authentication required." }, 401) };
  const hash = await sha256(header.slice(7).trim());
  const now2 = unixNow();
  const session = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?1 LIMIT 1").bind(hash).first();
  if (!session || session.revoked || Number(session.expires_at) <= now2)
    return { ok: false, response: json({ success: false, error: "Your session has expired or was logged out." }, 401) };
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?1 LIMIT 1").bind(session.user_id).first();
  if (!user)
    return { ok: false, response: json({ success: false, error: "Account not found." }, 401) };
  if (user.role === "admin") {
    const access = await env.DB.prepare("SELECT p.viewer_access,CASE WHEN o.user_id=p.user_id THEN 1 ELSE 0 END is_owner FROM admin_profiles p LEFT JOIN admin_owner o ON o.user_id=p.user_id WHERE p.user_id=?1").bind(user.id).first();
    user.viewer_access = Number(access?.viewer_access || 0);
    if (!panel && !access?.is_owner && !user.viewer_access)
      return { ok: false, response: json({ success: false, error: "TV access is not enabled for this account. Ask the owner to enable Viewing access." }, 401) };
  }
  if (!(panel && user.role === "admin")) {
    if (user.expires_at !== null && Number(user.expires_at) <= now2) {
      if (user.role !== "admin")
        await retainExpiredViewer(env, user.id, now2);
      return { ok: false, response: json({ success: false, error: user.role === "admin" ? "Your TV access expired. Your administrator panel access is unchanged." : "This account has expired. Contact an administrator to reactivate it within 30 days of expiration." }, 401) };
    }
    if (user.status !== "active")
      return { ok: false, response: json({ success: false, error: "This viewing account is not active." }, 403) };
  }
  if (now2 - Number(session.last_activity_at || 0) >= 300)
    await env.DB.prepare("UPDATE sessions SET last_activity_at = ?1 WHERE id = ?2").bind(now2, session.id).run();
  return { ok: true, user, session };
}
__name(requireUser, "requireUser");
__name2(requireUser, "requireUser");
async function createContentAccess(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok)
    return auth.response;
  const sources = managedSourceConfiguration(env);
  if (!sources.ready) {
    return json({ success: false, error: "The supplied Charming MediaLab playlist and Guide sources are not fully configured." }, 503);
  }
  const expiresAt = Number(auth.session.expires_at);
  const contentSources = sources.configured.map((configured) => ({
    id: configured.id,
    playlist_url: configured.playlistUrl,
    epg_url: configured.epgUrl
  }));
  const named = Object.fromEntries(contentSources.map(({ id, playlist_url, epg_url }) => [id, { playlist_url, epg_url }]));
  const controls = await appControls(env), announcement = await legacyAnnouncementUpdate(env, auth.user.id);
  return json({
    success: true,
    content: {
      expires_at: expiresAt,
      app_policy: { ...controls, update: { ...controls.update, message: richPlain(controls.update.message) }, ...announcement ? { update: announcement } : {}, announcements_supported: true },
      sources: contentSources,
      // Named pairs keep already-issued two-source APKs compatible while the
      // scalable array lets this and future APKs consume up to four slots.
      ...named
    }
  });
}
__name(createContentAccess, "createContentAccess");
__name2(createContentAccess, "createContentAccess");
function managedSourceConfiguration(env) {
  const slots = MANAGED_SOURCE_SLOTS.map((slot) => {
    const playlistValue = String(env[slot.playlist] || "").trim();
    const epgValue = String(env[slot.epg] || "").trim();
    const absent = !playlistValue && !epgValue;
    const configured2 = validManagedSource(playlistValue) && validManagedSource(epgValue);
    return {
      ...slot,
      state: absent ? "missing" : configured2 ? "configured" : "incomplete",
      playlistUrl: configured2 ? playlistValue : "",
      epgUrl: configured2 ? epgValue : ""
    };
  });
  const configured = slots.filter((slot) => slot.state === "configured");
  const requiredReady = slots.filter((slot) => slot.required).every((slot) => slot.state === "configured");
  const noPartialPairs = slots.every((slot) => slot.state !== "incomplete");
  const noSlotGap = slots[3].state !== "configured" || slots[2].state === "configured";
  return { slots, configured, ready: requiredReady && noPartialPairs && noSlotGap };
}
__name(managedSourceConfiguration, "managedSourceConfiguration");
__name2(managedSourceConfiguration, "managedSourceConfiguration");
function validManagedSource(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
__name(validManagedSource, "validManagedSource");
__name2(validManagedSource, "validManagedSource");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, 256);
  return ["pbkdf2-sha256", PBKDF2_ITERATIONS, bytesToBase64(salt), bytesToBase64(new Uint8Array(bits))].join("$");
}
__name(hashPassword, "hashPassword");
__name2(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  try {
    const [algorithm, iterationsText, salt64, expected64] = String(stored).split("$");
    if (algorithm !== "pbkdf2-sha256")
      return false;
    const salt = base64ToBytes(salt64);
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iterationsText), hash: "SHA-256" }, material, 256));
    const expected = base64ToBytes(expected64);
    if (actual.length !== expected.length)
      return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index++)
      difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
}
__name(verifyPassword, "verifyPassword");
__name2(verifyPassword, "verifyPassword");
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
__name2(sha256, "sha256");
function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    max_sessions: Number(user.max_sessions),
    created_at: Number(user.created_at),
    activated_at: user.activated_at === null ? null : Number(user.activated_at),
    expires_at: user.expires_at === null ? null : Number(user.expires_at),
    last_login_at: user.last_login_at === null ? null : Number(user.last_login_at)
  };
}
__name(publicUser, "publicUser");
__name2(publicUser, "publicUser");
async function audit(env, userId, adminId, action, details) {
  await env.DB.prepare(`INSERT INTO audit_log (user_id, admin_user_id, action, details, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5)`).bind(userId, adminId, action, details, unixNow()).run();
}
__name(audit, "audit");
__name2(audit, "audit");
function unixNow() {
  return Math.floor(Date.now() / 1e3);
}
__name(unixNow, "unixNow");
__name2(unixNow, "unixNow");
async function safeJson(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw statusError("A valid JSON object is required.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw statusError("A JSON object is required.", 400);
  return body;
}
__name(safeJson, "safeJson");
__name2(safeJson, "safeJson");
function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}
__name(normalizeUsername, "normalizeUsername");
__name2(normalizeUsername, "normalizeUsername");
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
__name2(normalizeEmail, "normalizeEmail");
function validUsername(value) {
  return /^[a-z0-9._-]{3,32}$/.test(value);
}
__name(validUsername, "validUsername");
__name2(validUsername, "validUsername");
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
__name(validEmail, "validEmail");
__name2(validEmail, "validEmail");
function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
__name(statusError, "statusError");
__name2(statusError, "statusError");
function secureToken(length = 48) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(length))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(secureToken, "secureToken");
__name2(secureToken, "secureToken");
function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length)
    return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left[index] ^ right[index];
  return difference === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
__name2(constantTimeEqual, "constantTimeEqual");
function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes)
    binary += String.fromCharCode(byte);
  return btoa(binary);
}
__name(bytesToBase64, "bytesToBase64");
__name2(bytesToBase64, "bytesToBase64");
function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
__name(base64ToBytes, "base64ToBytes");
__name2(base64ToBytes, "base64ToBytes");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Setup-Key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  } });
}
__name(json, "json");
__name2(json, "json");
function corsResponse(body, status = 204) {
  return new Response(body, { status, headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Setup-Key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400"
  } });
}
__name(corsResponse, "corsResponse");
__name2(corsResponse, "corsResponse");
export {
  accountAdminHelpers,
  worker_default as default
};
//# sourceMappingURL=worker.js.map


async function userActivity(env, auth, user, url, json2) {
  demandPermission(auth, "can_view_audit");
  const period = url.searchParams.get("period") || "30";
  const category = url.searchParams.get("category") || "all";
  const page = Number(url.searchParams.get("page") || 1);
  if (!["1", "7", "30", "all"].includes(period) || !["all", "logins"].includes(category) || !Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw policyError("Invalid activity filter.", 400);
  const at = unixNow(), since = period === "all" ? 0 : Math.floor(at / 86400) * 86400 - (Number(period) - 1) * 86400;
  const loginActions = "'login','login_failed','account_registered','logout','sign_out_all','force_logout','session_limit_replaced'";
  const timeline = `SELECT 'audit:'||a.id event_id,a.created_at,a.action,'recorded' source,actor.username admin_name FROM audit_log a LEFT JOIN users actor ON actor.id=a.admin_user_id
    WHERE a.user_id=?1 AND a.created_at>=?2 AND a.action<>'signin_timestamp_recovered' ${category === "logins" ? `AND a.action IN (${loginActions})` : ""}
    UNION ALL SELECT 'session:'||s.id,s.created_at,'session_created','session_record',NULL FROM sessions s
    WHERE s.user_id=?1 AND s.created_at>=?2 AND NOT EXISTS(SELECT 1 FROM audit_log a WHERE a.user_id=s.user_id AND a.action IN('login','account_registered') AND ABS(a.created_at-s.created_at)<=2)`;
  const totals = await first(env, `SELECT COUNT(*) total FROM (${timeline})`, [user.id, since]);
  const total = Number(totals.total), pages = Math.max(1, Math.ceil(total / 25)), currentPage = Math.min(page, pages);
  const events = await rows2(env, `SELECT * FROM (${timeline}) ORDER BY created_at DESC,event_id DESC LIMIT 25 OFFSET ?3`, [user.id, since, (currentPage - 1) * 25]);
  const recent = await first(env, "SELECT MAX(last_activity_at) last_active_at,COUNT(*) session_count,SUM(CASE WHEN revoked=0 AND expires_at>?2 THEN 1 ELSE 0 END) active_sessions FROM sessions WHERE user_id=?1", [user.id, at]);
  const presence = await first(env, "SELECT MAX(last_seen) last_seen FROM app_presence WHERE user_id=?1", [user.id]);
  const online = await first(env, "SELECT COUNT(*) count FROM app_presence p JOIN sessions s ON s.id=p.session_id WHERE p.user_id=?1 AND p.last_seen>?2 AND p.mode<>'idle' AND s.revoked=0 AND s.expires_at>?3", [user.id, at - 90, at]);
  const recovered = await first(env, "SELECT MAX(created_at) recovered_at FROM audit_log WHERE user_id=?1 AND action='signin_timestamp_recovered'", [user.id]);
  const lastSignIn = await first(env, "SELECT MAX(created_at) at FROM audit_log WHERE user_id=?1 AND action IN('login','account_registered')", [user.id]);
  const sessions = await rows2(env, "SELECT created_at,last_activity_at,expires_at,revoked FROM sessions WHERE user_id=?1 ORDER BY created_at DESC,id DESC LIMIT 50", [user.id]);
  const usage = await first(env, "SELECT COALESCE(SUM(iptv_seconds),0) iptv_seconds,COALESCE(SUM(vod_seconds),0) vod_seconds,COALESCE(SUM(foreground_seconds),0) foreground_seconds,COALESCE(SUM(visits),0) visits FROM app_usage_daily WHERE user_id=?1 AND day>=?2", [user.id, since]);
  const days = await rows2(env, "SELECT day,iptv_seconds,vod_seconds,foreground_seconds,visits FROM app_usage_daily WHERE user_id=?1 AND day>=?2 ORDER BY day DESC LIMIT 90", [user.id, since]);
  const tracking = await first(env, "SELECT started_at FROM app_usage_metadata WHERE id=1", []);
  return json2({ success: true, activity: {
    username: user.username, period, category, since, generated_at: at,
    summary: { last_sign_in_at: user.last_login_at, last_sign_in_recovered: !!recovered.recovered_at && Number(lastSignIn.at || 0) < Number(recovered.recovered_at),
      last_active_at: Math.max(Number(recent.last_active_at || 0), Number(presence.last_seen || 0)) || null,
      online: Number(online.count) > 0 && user.status === "active" && (user.expires_at === null || Number(user.expires_at) > at),
      active_sessions: Number(recent.active_sessions || 0), stored_sessions: Number(recent.session_count || 0) },
    usage, days, usage_tracking_started_at: tracking?.started_at || null,
    sessions: sessions.map(s => ({ ...s, state: s.revoked ? "Revoked" : Number(s.expires_at) <= at ? "Expired" : "Active" })),
    sessions_truncated: Number(recent.session_count || 0) > sessions.length,
    events, pagination: { page: currentPage, pages, total, page_size: 25 }
  } });
}
