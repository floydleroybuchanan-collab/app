import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW} from './fixture.mjs';
import {handleUpdate,webhook} from '../bot-telegram.js';
import {createGroupInvite} from '../bot-group-invites.js';
const s={enabled:true,group_id:'-100123456789',bot_username:'TestBot',auto_tokens:true,accounts_enabled:true,token_days:90,connections:2,invite_days:7};
function setup(){
 const f=fixture(),calls=[],state={fail:null,member:false,drop:false};let seq=0;
 f.env.TELEGRAM_BOT_TOKEN='test';f.env.TELEGRAM_WEBHOOK_SECRET='test';
 f.db.prepare('UPDATE bot_settings SET json=?').run(JSON.stringify(s));
 f.env.TELEGRAM_FETCH=async(url,opt)=>{
  const method=url.split('/').pop(),body=JSON.parse(opt.body);calls.push({method,body});
  if(state.fail&&method==='sendMessage'&&body.chat_id===90100&&body.text.includes(state.fail))return Response.json({ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'},{status:403});
  let result=true;
  if(method==='createChatInviteLink')result={invite_link:'https://t.me/+local',creates_join_request:true};
  if(method==='getChatAdministrators')result=[{user:{id:777,first_name:'Owner'}}];
  if(method==='getChatMember')result={status:body.user_id===777?'administrator':state.member?'member':'left',user:{id:body.user_id,first_name:'New user'}};
  if(method==='sendMessage')result=body.ephemeral_message_parameters?{ephemeral_message_id:++seq}:{message_id:++seq};
  if(method==='approveChatJoinRequest'){state.member=true;if(state.drop){state.drop=false;throw Error('lost response');}}
  return Response.json({ok:true,result});
 };
 const request={update_id:1,chat_join_request:{chat:{id:Number(s.group_id)},from:{id:100,first_name:'New user'},date:NOW(),user_chat_id:90100}};
 return {...f,calls,state,request,run:()=>handleUpdate(f.env,request,s)};
}
test('automatic shared join delivers persistently before approval, reuses token and avoids duplicate post-join setup',async()=>{
 const f=setup();await f.run();
 assert.equal(f.db.prepare('SELECT state FROM bot_join_requests').get().state,'approved');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invites').get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,0);
 const approval=f.calls.findIndex(c=>c.method==='approveChatJoinRequest');
 assert.equal(f.calls.slice(0,approval).filter(c=>c.method==='sendMessage'&&c.body.chat_id===90100).length,3);
 await f.run();assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,1);
 await handleUpdate(f.env,{chat_member:{chat:{id:Number(s.group_id)},date:NOW(),old_chat_member:{status:'left'},new_chat_member:{status:'member',user:{id:100}}}},s);
 assert.equal(f.calls.filter(c=>c.method==='sendMessage'&&c.body.chat_id===90100).length,3);
 assert.ok(f.calls.some(c=>c.body.text?.includes('delivered before approval')));
});
test('delivery failure leaves join pending and still reports to admins',async()=>{
 const f=setup();f.state.fail='Hello,';await f.run();
 assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,0);
 assert.equal(f.db.prepare('SELECT welcome_sent FROM bot_join_requests').get().welcome_sent,0);
 assert.ok(f.calls.some(c=>c.body.text?.includes('Not delivered')&&c.body.ephemeral_message_parameters?.receiver_user_id===777));
 f.state.fail=null;await f.run();assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invites').get().n,1);
});
test('interrupted approval checks live membership and never approves twice',async()=>{
 const f=setup();f.state.drop=true;await assert.rejects(f.run(),/lost response/);await f.run();
 assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,1);
 assert.equal(f.db.prepare('SELECT state FROM bot_join_requests').get().state,'approved');
});
test('expired temporary contact window does not approve or generate a token',async()=>{
 const f=setup();f.request.chat_join_request.date=NOW()-301;await f.run();
 assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invites').get().n,0);
});
test('personal invite remains bound to its recipient in the automatic handler',async()=>{
 const f=setup(),invite=await createGroupInvite(f.env,s,{telegram_id:'101',approved:true,expires_at:NOW()+3600},'owner');
 f.request.chat_join_request.invite_link={invite_link:invite.invite_link};await f.run();
 assert.ok(f.calls.some(c=>c.method==='declineChatJoinRequest'));
 assert.equal(f.calls.filter(c=>c.method==='approveChatJoinRequest').length,0);
});
test('ignored webhook text performs no update bookkeeping writes',async()=>{
 const f=setup();const r=await webhook(new Request('https://test/bot',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test'},body:JSON.stringify({update_id:99,message:{chat:{id:Number(s.group_id),type:'supergroup'},from:{id:100},text:'hello everyone'}})}),f.env);
 assert.equal(r.status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_updates').get().n,0);
});
