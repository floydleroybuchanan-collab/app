import {now,q,fail,assignToken,event} from './bot-store.js';
import {findBotChallenge,confirmBotChallenge} from './account-security.js';
import {telegram,send,isMember} from './bot-telegram.js';
import {createGroupInvite} from './bot-group-invites.js';
const buttons=items=>({inline_keyboard:items.map(([text,data])=>[{text,callback_data:data}])});

async function personalAdmission(env,id,s,applicationId){
 const m=await q(env,'SELECT * FROM bot_members WHERE telegram_id=?1',id).first();
 if(!m||m.blocked)fail('An Admin must review your access.',403);
 if(m.account_id)return send(env,id,'You already have an app account. Sign in, or choose Forgot Password in the app.',buttons([['My Account','account'],['Recovery help','forgot_password']]));
 const live=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(id)});
 if(isMember(live)){
  await q(env,'UPDATE bot_members SET status=?1 WHERE telegram_id=?2',live.status==='restricted'?'restricted_member':live.status,id).run();
  const invitation=await assignToken(env,id,s);
  return send(env,id,invitation?'You are already approved in the room. Your private app registration code is:\n'+invitation.invite_code+'\n\nIn the app choose I Have an Invitation. Approve the registration here when prompted.':'An Admin must check your existing invitation before another account can be created.',buttons([['My app invitation','token'],['Help','help']]));
 }
 let invitation=await q(env,"SELECT * FROM bot_group_invites WHERE telegram_id=?1 AND status IN('active','pending') AND (expires_at IS NULL OR expires_at>?2) ORDER BY created_at DESC LIMIT 1",id,now()).first();
 if(!invitation)invitation=await createGroupInvite(env,s,{telegram_id:id,recipient_label:m.name.slice(0,100)||'New applicant',username:m.username,expires_at:now()+86400,approved:true},'application:'+id,'application:'+applicationId);
 return send(env,id,'Your personal room invitation is ready. Request to join and wait for an Admin to approve you. After approval, choose My app invitation here to get your registration code.\n\nThis link is tied to your Telegram account.',{
  inline_keyboard:[[{text:'Request to join the room',url:invitation.invite_link}],[{text:'Check my app invitation',callback_data:'token'}],[{text:'Help',callback_data:'help'}]]
 });
}

export async function accountFlow(env,id,text,cmd,s){
 const start=text.match(/^\/start(?:@\w+)?\s+flow_([a-f0-9]{48})$/i);
 const phraseCode=text.trim().match(/^mr\.?\s+charm\s+(link my account|forgot password|request app access|confirm registration)\s+((?:[A-Z2-9]{4}[- ]?){2})$/i);
 const code=(phraseCode?.[2]||text.trim()).match(/^(?:[A-Z2-9]{4}[- ]?){2}$/i);
 const callback=cmd.match(/^flow:(yes|no):([a-f0-9-]{36})$/);
 if(callback){
  let c;
  if(callback[1]==='yes'){
   const candidate=await q(env,'SELECT * FROM account_challenges WHERE id=?1',callback[2]).first();
   if(candidate&&['link','registration'].includes(candidate.kind)){
    const live=await telegram(env,'getChatMember',{chat_id:s.group_id,user_id:Number(id)});
    if(!isMember(live))fail('Your room join request must be approved first.',403);
   }
  }
  c=await confirmBotChallenge(env,id,callback[2],callback[1]==='yes');
  if(c.status==='approved'&&c.kind==='access')await personalAdmission(env,id,s,c.id);
  else await send(env,id,c.status==='denied'?'Request declined. No account changes were authorized.':c.kind==='reset'?'Approved. Return to the app and choose your new password. Never send your password to Telegram.':c.kind==='link'?'Telegram is verified and linked. Return to Settings in the app.':'Registration approved. Return to the app to finish creating your account.',buttons([['Help','help']]));
  return true;
 }
 if(start||code){
  if(env.BOT_GROUP_REPLY){await send(env,id,'Open Mr. Charm privately to enter your app request code.',{inline_keyboard:[[{text:'Continue privately',url:'https://t.me/'+s.bot_username+'?start=help'}]]});return true;}
  const c=await findBotChallenge(env,id,start?.[1]||code[0]);
  if(phraseCode && c.kind!==({'link my account':'link','forgot password':'reset','request app access':'access','confirm registration':'registration'}[phraseCode[1].toLowerCase()]))fail('Use the full Mr Charm command shown with this request in your app.',400);
  if(c.status==='approved'){
   if(c.kind==='access')await personalAdmission(env,id,s,c.id);
   else await send(env,id,'Already approved. Return to the app to continue.');
   return true;
  }
  if(!c.telegram_id){
   const m=await q(env,'SELECT blocked,account_id FROM bot_members WHERE telegram_id=?1',id).first();
   if(m?.blocked)fail('An Admin must review your access.',403);
   if(c.kind==='link'&&m?.account_id&&m.account_id!==c.user_id)fail('This Telegram account already belongs to another app account.',409);
   const bound=await q(env,"UPDATE account_challenges SET telegram_id=?1 WHERE id=?2 AND telegram_id IS NULL AND status='waiting'",id,c.id).run();
   if(!bound.meta.changes)fail('This request was opened by another account. Start again in the app.',409);
  }
  const payload=JSON.parse(c.payload),label={reset:'reset your app password',link:'link Telegram to your signed-in app account',access:'request room and app access',registration:'register the app username '+payload.username}[c.kind];
  await send(env,id,'Did you just '+label+'?\n\nApprove only if you started this request on your own device. Approval expires with the app request after ten minutes.',buttons([['Yes, this is my request','flow:yes:'+c.id],['No, decline','flow:no:'+c.id]]));
  return true;
 }
 if(cmd==='access_direct'){await personalAdmission(env,id,s,crypto.randomUUID());return true;}
 if(['request_access','forgot_password','link_telegram','confirm_registration'].includes(cmd)){
  const instructions=cmd==='confirm_registration'?'In the app choose I Have an Invitation and begin registration. Then send Mr Charm Confirm Registration followed by the request code shown in the app.':cmd==='request_access'?'On the app sign-in screen choose Request App Access. Scan its QR code or send Mr Charm Request App Access followed by its request code.':cmd==='forgot_password'?'On the app sign-in screen choose Forgot Password. Enter your username, then scan its QR or send Mr Charm Forgot Password followed by the request code. Use the Telegram account already linked to your app account.':'In the app open Settings → Account → Link Telegram and verify your current app password. Scan its QR or send Mr Charm Link My Account followed by the request code. Lost your original Telegram account or cannot sign in? Contact an Admin for verified recovery.';
  await send(env,id,instructions,buttons([...(cmd==='request_access'?[['Apply here without a TV code','access_direct']]:[]),['Contact an Admin','contact'],['Help','help']]));return true;
 }
 return false;
}
