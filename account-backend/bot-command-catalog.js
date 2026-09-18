import {ACCOUNT_COMMANDS,ADMIN_ACCOUNT_COMMANDS} from './bot-account-commands.js';
const COMMANDS = [
 {id:'linking:user',command:'account_linking',phrase:'Account Linking',label:'🔗 Account Linking Steps',description:'Step-by-step instructions for linking your own app account to Telegram'},
 {id:'linking:admin',command:'admin_account_linking',phrase:'Admin Account Linking',label:'🛡 Admin Account Linking Steps',description:'Private administrator instructions for app and web-panel account linking',admin:true},
 {id:'update_report',command:'update_report',phrase:'Update Report',label:'📄 Update & Link Report',description:'Download a private text file of accounts, reported app versions and Telegram links',admin:true},
 {id:'usage',command:'usage',phrase:'Usage',label:'📊 App Usage',description:'See online viewers, Telegram links and watch-time rankings privately',admin:true},
 {id:'website_release',command:'website_release',phrase:'Website Release',label:'🌐 Website Release',description:'View the published app release and open the release editor',admin:true},
 {id:'website',command:'website',label:'🌐 Website',description:'Open the official website for downloads, installation and account help'},
 ...ACCOUNT_COMMANDS,...ADMIN_ACCOUNT_COMMANDS,
 {id:'user_commands',command:'user_commands',label:'👤 User Commands',description:'Choose a category to find your account and app commands'},
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
const BUTTON_LABELS={"help": "🏠 Main menu", "user_commands": "👤 User Commands", "guide": "📖 Charming MediaLab User Guide", "downloads": "📥 Download Charming MediaLab", "account": "🔑 Account Help", "rules": "📜 Rules & Information", "app_help": "▶ Sources & MultiView Help", "whats_new": "✨ What’s New", "status": "📡 Service Status", "request_access": "🎟 Request App Access", "confirm_registration": "✅ Confirm Registration", "forgot_password": "🔐 Forgot Password", "link_telegram": "🔗 Link My Account", "admin_invite": "🎟 Create room invitation", "admin_invites": "📋 Recent room invitations", "admin_revoke": "🚫 Revoke room invitation"};
const COMMAND_ICONS={"my_account": "👤", "account_status": "📅", "my_sessions": "📱", "sign_out_all": "🚪", "my_security": "🔐", "unlink_my_account": "🔓", "invite_status": "🎟", "search_user": "🔎", "userinfo": "👤", "user_status": "📅", "link_account": "🔗", "relink_account": "🔄", "unlink_account": "🔓", "reset_user_password": "🔐", "signout_user": "🚪", "disable_account": "⏸", "enable_account": "✅", "ban_user": "⛔", "unban_user": "✅", "delete_account": "🗑", "extend_user": "📅", "set_expiration": "📆", "set_limit": "🔢", "user_sessions": "📱", "revoke_sessions": "🚪", "invite_info": "🎟", "cancel_invite": "🚫", "create_app_invite": "🎟", "recent_users": "👥", "recent_links": "🔗", "user_audit": "📋", "bot_status": "📡", "bot_stats": "📊"};
export const BOT_COMMANDS=COMMANDS.map(c=>({...c,buttonLabel:BUTTON_LABELS[c.id]||(/^[^\p{L}\p{N}]/u.test(c.label)?c.label:(COMMAND_ICONS[c.command]||(c.admin?'🛡':'👤'))+' '+c.label),phrase:PHRASES[c.id]||titleCase(c.phrase||c.command.replaceAll('_',' ')),label:'Mr Charm '+(PHRASES[c.id]||titleCase(c.phrase||c.command.replaceAll('_',' ')))}));
export function commandLabel(id){return BOT_COMMANDS.find(c=>c.id===id)?.label;}
export function commandText(value){
 if(typeof value!=='string')return value;
 return value.replace(/\bMr\. Charm\b/g,'Mr Charm').replace(/(^|[\s(])\/([a-z_]+)(?:@\w+)?\b/gi,(whole,prefix,name)=>{const c=BOT_COMMANDS.find(c=>c.command===name.toLowerCase());return c?prefix+c.label:whole;});
}
export function commandButtons(markup){
 if(!markup?.inline_keyboard)return markup;
 return {...markup,inline_keyboard:markup.inline_keyboard.map(row=>row.map(b=>({...b,text:buttonText(b)})))};
}

function buttonText(button){
 const original=commandText(button.text||'');
 // Back and Cancel are navigation labels, even when their destination is a command.
 if(original.startsWith('↩'))return original;
 if(/^(?:back|cancel)\b/i.test(original))return '↩ '+original;
 const command=BOT_COMMANDS.find(c=>c.id===button.callback_data);
 if(command)return command.buttonLabel;
 if(/^[^\p{L}\p{N}]/u.test(original))return original;
 const icon=/^(?:yes|confirm|approve|enable)\b/i.test(original)?'✅':/^(?:no|delete|revoke|disable)\b/i.test(original)?'⛔':button.url?'↗':button.callback_data?.startsWith('issue:')?'🛠':button.callback_data?.startsWith('answer:')?'📺':'›';
 return icon+' '+original;
}
