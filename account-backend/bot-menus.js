// Navigation is separate from executable command phrases and their authorization.
export const HOME_COMMANDS=['website','guide','downloads','account','troubleshooting','rules','contact','about','app_help','whats_new','status'];
export const COMMAND_MENUS=[
 {id:'menu:user:account',label:'👤 My account',description:'Check your account, devices and security.',commands:['my_account','account_status','my_sessions','sign_out_all','my_security']},
 {id:'menu:user:recovery',label:'🔐 Login & recovery',description:'Recover access or manage your Telegram link.',commands:['forgot_password','link_telegram','unlink_my_account']},
 {id:'menu:user:access',label:'🎟 Invitations & access',description:'Request access, confirm registration or check your invitation.',commands:['request_access','confirm_registration','token','invite_status']},
 {id:'menu:user:help',label:'📺 App help',description:'Download the app and get help using it.',commands:['guide','downloads','account','troubleshooting','app_help']},
 {id:'menu:user:community',label:'💬 Community',description:'Find rules, support contacts and service information.',commands:['website','rules','contact','about','whats_new','status']},
 {id:'menu:admin:find',admin:true,label:'🔎 Find accounts',description:'Find members and review account information.',commands:['manage_search_user','manage_userinfo','manage_user_status','manage_recent_users','manage_recent_links','manage_bot_stats','manage_user_audit']},
 {id:'menu:admin:access',admin:true,label:'🛡 Access controls',description:'Enable, disable or remove access with confirmation.',commands:['manage_disable_account','manage_enable_account','manage_ban_user','manage_unban_user','manage_delete_account']},
 {id:'menu:admin:limits',admin:true,label:'📅 Time & login limits',description:'Change account expiration and simultaneous login limits.',commands:['manage_extend_user','manage_set_expiration','manage_set_limit']},
 {id:'menu:admin:sessions',admin:true,label:'📱 Sessions',description:'Review active logins or sign a user out.',commands:['manage_user_sessions','manage_signout_user','manage_revoke_sessions']},
 {id:'menu:admin:recovery',admin:true,label:'🔗 Telegram & recovery',description:'Manage verified Telegram links and password recovery.',commands:['manage_link_account','manage_relink_account','manage_unlink_account','manage_reset_user_password']},
 {id:'menu:admin:invites',admin:true,label:'🎟 Invitations',description:'Manage app registration and Telegram room invitations.',commands:['manage_create_app_invite','manage_invite_info','manage_cancel_invite','admin_invite','admin_invites','admin_revoke']},
 {id:'menu:admin:updates',admin:true,label:'📣 Updates & bot status',description:'Create an app update notice or check bot configuration.',commands:['notify_update','manage_bot_status']},
];
