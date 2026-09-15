import {ACCOUNT_COMMANDS,ADMIN_ACCOUNT_COMMANDS} from './bot-account-commands.js';
const COMMANDS = [
 ...ACCOUNT_COMMANDS,...ADMIN_ACCOUNT_COMMANDS,
 {id:'help',command:'help',label:'💜 User Commands',description:'Open your private help menu'},
 {id:'guide',command:'guide',label:'📖 User Guide',description:'Read the app guide'},
 {id:'downloads',command:'downloads',label:'📥 Download / update app',description:'Get the latest app and installation help'},
 {id:'account',command:'account',label:'🔑 My Account',description:'Account status and login help'},
 {id:'request_access',command:'request_access',label:'Request App Access',description:'Pair an app access request or apply to join'},
 {id:'confirm_registration',command:'confirm_registration',label:'Confirm Registration',description:'Confirm your app registration request'},
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

const PHRASES={my_sessions:"My Sessions",my_security:"My Security",manage_userinfo:"User Information",manage_user_status:"User Account Status",manage_user_sessions:"User Sessions",manage_signout_user:"Sign Out User",manage_extend_user:"Extend Account",manage_set_limit:"Set Login Limit",manage_bot_stats:"Account Statistics",manage_user_audit:"Account Audit",confirm_registration:'Confirm Registration',help:'Help',guide:'User Guide',downloads:'Download App',account:'Account Help',request_access:'Request App Access',forgot_password:'Forgot Password',link_telegram:'Link My Account',token:'My App Invitation',troubleshooting:'Troubleshooting',rules:'Rules',contact:'Contact Admin',about:'About',app_help:'Playback Help',whats_new:'Whats New',status:'Service Status',admin:'Admin Commands',notify_update:'Notify Update',admin_invite:'Invite',admin_invites:'Invites',admin_revoke:'Revoke'};
const titleCase=value=>value.replace(/\b[a-z]/g,c=>c.toUpperCase());
export const BOT_COMMANDS=COMMANDS.map(c=>({...c,phrase:PHRASES[c.id]||titleCase(c.phrase||c.command.replaceAll('_',' ')),label:'Mr Charm '+(PHRASES[c.id]||titleCase(c.phrase||c.command.replaceAll('_',' ')))}));
export function commandLabel(id){return BOT_COMMANDS.find(c=>c.id===id)?.label;}
export function commandText(value){
 if(typeof value!=='string')return value;
 return value.replace(/\bMr\. Charm\b/g,'Mr Charm').replace(/(^|[\s(])\/([a-z_]+)(?:@\w+)?\b/gi,(whole,prefix,name)=>{const c=BOT_COMMANDS.find(c=>c.command===name.toLowerCase());return c?prefix+c.label:whole;});
}
export function commandButtons(markup){
 if(!markup?.inline_keyboard)return markup;
 return {...markup,inline_keyboard:markup.inline_keyboard.map(row=>row.map(b=>({...b,text:commandLabel(b.callback_data)||commandText(b.text)})))};
}
