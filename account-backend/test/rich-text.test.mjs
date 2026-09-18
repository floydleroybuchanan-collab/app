import test from 'node:test';
import assert from 'node:assert/strict';
import {richPack,readRich,richPlain,richAppend,PREFIX} from '../rich-text.js';
import {fixture} from './fixture.mjs';
import {send} from '../bot-telegram.js';
import {validateAnnouncement} from '../announcements.js';
test('rich text preserves styles, numbered lists and escapes literal markup',()=>{
 const value=richPack('<h1>Link account</h1><ol><li><b>Open Settings</b></li><li><mark>Keep passwords private</mark></li></ol>');
 assert.match(richPlain(value),/1\. Open Settings/);assert.match(richPlain(value),/2\. Keep passwords private/);
 assert.match(readRich(value).html,/<mark>/);assert.equal(readRich('a < b').html,'a &lt; b');
 assert.match(richPlain(richAppend(value,'\n\nhttps://example.com')),/https:\/\/example.com/);
});
test('rejects scripts, unsafe links, attributes and malformed rich markup',()=>{
 for(const html of ['<script>alert(1)</script>','<a href="javascript:alert(1)">bad</a>','<p onclick="alert(1)">bad</p>','<b>open','<img src="https://example.com">','<a href="https://user:pass@example.com">bad</a>'])assert.throws(()=>readRich(PREFIX+html));
});
test('rich messages use private delivery and only explicit Telegram format rejection falls back',async()=>{
 const f=fixture(),calls=[];f.env.TELEGRAM_BOT_TOKEN='fake';f.env.BOT_GROUP_REPLY={chat_id:'-100123',user_id:'12345'};
 f.env.TELEGRAM_FETCH=async(url,opt)=>{calls.push({method:url.split('/').pop(),body:JSON.parse(opt.body)});return Response.json({ok:true,result:{ephemeral_message_id:12}});};
 await send(f.env,'12345',richPack('<h1>Hello</h1><p><b>World</b></p>'));
 assert.equal(calls[0].method,'sendRichMessage');assert.equal(calls[0].body.ephemeral_message_parameters.receiver_user_id,12345);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_responses').get().n,1);
});
test('app notices save rich content but enforce visible length',()=>{
 const b={title:'Notice',message:richPack('<b>Welcome</b>'),kind:'general',audience:'all',version_code:0,url:'',sound:false};
 assert.equal(validateAnnouncement(b).message,b.message);
 assert.throws(()=>validateAnnouncement({...b,message:richPack('<b>'+'x'.repeat(3501)+'</b>')}));
});
