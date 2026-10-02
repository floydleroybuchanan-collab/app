import {COMMAND_MENUS} from './bot-menus.js';

// Fixed parents keep navigation request-local: no per-message history writes.
const destinations=new Set(['help','admin','user_commands','account','troubleshooting','contact','usage',...COMMAND_MENUS.map(m=>m.id)]);
export function navigationDestination(command){
 if(!command?.startsWith('nav:'))return null;
 const destination=command.slice(4);
 return destinations.has(destination)?destination:null;
}
export function navigationParent(command){
 if(command==='help')return null;
 if(command==='admin'||command==='user_commands')return 'help';
 const menu=COMMAND_MENUS.find(m=>m.id===command);
 if(menu)return menu.admin?'admin':'user_commands';
 if(command?.startsWith('contact-admin:'))return 'contact';
 if(command?.startsWith('issue:')||command?.startsWith('answer:'))return 'troubleshooting';
 if(command?.startsWith('usage:'))return 'usage';
 if(command?.startsWith('announce:')||command==='notify_update')return 'menu:admin:updates';
 if(command?.startsWith('manage:'))return 'admin';
 if(command?.startsWith('self:'))return 'menu:user:account';
 if(command?.startsWith('flow:')||command==='access_direct')return 'account';
 if(command?.startsWith('linking:'))return command==='linking:user'?'menu:user:recovery':'menu:admin:recovery';
 // Main-menu information returns to Main; specialized commands return to category.
 if(['website','guide','downloads','account','troubleshooting','rules','contact','about','app_help','whats_new','status'].includes(command))return 'help';
 return COMMAND_MENUS.find(m=>m.commands.includes(command))?.id||'help';
}
export function withNavigation(env,id,markup){
 const nav=env.BOT_NAVIGATION;
 if(!nav||String(id)!==nav.userId||env.BOT_PUBLIC_HUMOR||!nav.parent)return markup;
 const rows=(markup?.inline_keyboard||[]).map(row=>row.map(button=>({...button})));
 for(const button of rows.flat()){
  if(button.callback_data===nav.parent){button.text='Back';button.callback_data='nav:'+nav.parent;}
  else if(nav.parent!=='help'&&button.callback_data==='help'){button.text='🏠 Main menu';button.callback_data='nav:help';}
 }
 const buttons=[{text:'Back',callback_data:'nav:'+nav.parent}];
 if(nav.parent!=='help')buttons.push({text:'🏠 Main menu',callback_data:'nav:help'});
 const existing=new Set(rows.flat().map(b=>b.callback_data));
 const missing=buttons.filter(b=>!existing.has(b.callback_data));
 if(missing.length)rows.push(missing);
 return {...markup,inline_keyboard:rows};
}
