// One registry supplies Telegram commands, menu buttons and exact aliases.
import {ACCOUNT_COMMANDS,ADMIN_ACCOUNT_COMMANDS} from './bot-account-commands.js';
export const BOT_COMMANDS = [
 ...ACCOUNT_COMMANDS,...ADMIN_ACCOUNT_COMMANDS,
 {id:'help',command:'help',label:'💜 User Commands',description:'Open your private help menu'},
 {id:'guide',command:'guide',label:'📖 User Guide',description:'Read the app guide'},
 {id:'downloads',command:'downloads',label:'📥 Download / update app',description:'Get the latest app and installation help'},
 {id:'account',command:'account',label:'🔑 My Account',description:'Account status and login help'},
 {id:'request_access',command:'request_access',label:'Request App Access',description:'Pair an app access request or apply to join'},
 {id:'forgot_password',command:'forgot_password',label:'Forgot Password',description:'Approve an app password reset'},
 {id:'link_telegram',command:'link_telegram',label:'Link Telegram / recovery',description:'Verify your existing app account link'},
 {id:'token',command:'token',label:'🎟 My app invitation',description:'View your own registration invitation'},
 {id:'troubleshooting',command:'troubleshooting',label:'🛠 Troubleshooting',description:'Get private troubleshooting help'},
 {id:'rules',command:'rules',label:'📜 Rules & information',description:'Read community rules'},
 {id:'contact',command:'contact',label:'👤 Contact an Admin',description:'Get support privately'},
 {id:'about',command:'about',label:'❓ About Mr. Charm',description:'Learn about the assistant'},
 {id:'app_help',command:'sources',label:'▶ Sources & MultiView help',description:'Sources, playback and MultiView help',content:true},
 {id:'whats_new',command:'whats_new',label:'✨ What’s new',description:'Read release notes',content:true},
 {id:'status',command:'status',label:'Service status',description:'View service status',content:true},
 {id:'admin',command:'admin',label:'🛡 Admin Commands',description:'Open authorized admin tools',admin:true},
 {id:'notify_update',command:'notify_update',label:'📣 Notify Update',description:'Privately compose an app update announcement',admin:true},
 {id:'admin_invite',command:'invite',label:'Create personal room invitation',description:'Create a personal join-request invitation',admin:true},
 {id:'admin_invites',command:'invites',label:'Recent room invitations',description:'Review recent room invitations',admin:true},
 {id:'admin_revoke',command:'revoke',label:'Revoke room invitation',description:'Revoke an unused room invitation',admin:true},
];

export function exactCommand(text) {
 const command=text.trim().replace(/^mr\.?\s*charm\s*/i,'').replace(/^\//,'').replace(/@\w+\b/,'').trim().toLowerCase();
 const alias={'request app access':'request_access','forgot password':'forgot_password','link telegram':'link_telegram','notify update':'notify_update','support':'contact','user commands':'help','admin commands':'admin'}[command];
 return alias||BOT_COMMANDS.find(c=>c.command===command||c.id===command)?.id;
}

export async function currentTelegramAdmin(env,id,s,telegram) {
 const m=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(id)});
 return ['administrator','creator'].includes(m.status)&&!m.user?.is_bot;
}

export async function syncCommandMenu(env,id,s,isAdmin,telegram) {
 const commands=BOT_COMMANDS.filter(c=>!c.admin||isAdmin).map(c=>({command:c.command,description:c.description,is_ephemeral:true}));
 // Per-user scopes keep admin command discovery out of ordinary users' menus.
 await telegram(env,'setMyCommands',{commands,scope:{type:'chat',chat_id:Number(id)}});
 if(s.group_id)await telegram(env,'setMyCommands',{commands,scope:{type:'chat_member',chat_id:s.group_id,user_id:Number(id)}});
}
