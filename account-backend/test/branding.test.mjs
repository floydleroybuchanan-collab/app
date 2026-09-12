import test from 'node:test';
import assert from 'node:assert/strict';
import { brandText, brandedContent, brandedTelegramBody } from '../branding.js';
import { fixture } from './fixture.mjs';
import { botScheduled } from '../bot-telegram.js';
import { q, now } from '../bot-store.js';

test('saved bot branding updates display copy while retaining links, handles and history', async () => {
  const raw = 'CharmIPTV / CHARM IPTV: https://charmiptv.example/CharmIPTV @CharmIPTV_help';
  assert.equal(brandText(raw), 'Charming MediaLab / Charming MediaLab: https://charmiptv.example/CharmIPTV @CharmIPTV_help');
  const row = { body: raw, revision: 8, enabled: 1 };
  assert.equal(brandedContent(row).revision, 8);
  assert.equal(row.body, raw);
  assert.equal(brandText('Your custom support message'), 'Your custom support message');
  const f = fixture();
  await f.request('/admin/bot/content/whats_new', { method: 'PUT', token: f.ownerToken,
    body: { body: raw, enabled: true, revision: 0 } });
  const displayed = await f.request('/admin/bot/content', { token: f.ownerToken });
  assert.equal(displayed.body.content.find(c => c.key === 'whats_new').body, brandText(raw));
  assert.equal(f.db.prepare("SELECT body FROM bot_content WHERE key='whats_new'").get().body, raw);
});

test('pre-upgrade queued announcements are rebranded before delivery and splitting', async () => {
  const f=fixture(), sent=[];
  f.env.TELEGRAM_BOT_TOKEN='test-only';
  f.env.TELEGRAM_FETCH=async(_url,options)=>{sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:71}});};
  await q(f.env,'UPDATE bot_settings SET json=?1',JSON.stringify({enabled:true,group_id:'-100123456789',reminder_enabled:false})).run();
  const old=('CharmIPTV news. ').repeat(350)+' https://charmiptv.example/app @CharmIPTVAssistantBot';
  await q(f.env,"INSERT INTO bot_jobs(kind,chat_id,body,due_at) VALUES('broadcast',?1,?2,?3)",'-100123456789',old,now()-1).run();
  await botScheduled(f.env);
  assert.ok(sent.length>1);
  assert.ok(sent.every(message=>message.text.length<=4000));
  assert.equal(sent.map(message=>message.text).join(''),brandText(old));
  assert.equal(f.db.prepare('SELECT body FROM bot_jobs').get().body,old,'do not rewrite audit history');
  assert.equal(f.db.prepare('SELECT status FROM bot_jobs').get().status,'sent');
});

test('Telegram display fields are normalized while routing, links and callback data remain intact',()=>{
  const body={text:'CharmIPTV',entities:[{type:'bold',offset:0,length:9}],chat_id:123,
    rich_message:{html:'<a href="https://charmiptv.example">CharmIPTV</a>'},
    reply_markup:{inline_keyboard:[[{text:'CharmIPTV help',callback_data:'CharmIPTV',url:'https://charmiptv.example'}]]}};
  const result=brandedTelegramBody(body);
  assert.equal(result.text,'Charming MediaLab');
  assert.equal(result.entities,undefined);
  assert.equal(result.chat_id,123);
  assert.equal(result.rich_message.html,'<a href="https://charmiptv.example">Charming MediaLab</a>');
  assert.equal(result.reply_markup.inline_keyboard[0][0].text,'Charming MediaLab help');
  assert.equal(result.reply_markup.inline_keyboard[0][0].callback_data,'CharmIPTV');
  assert.equal(result.reply_markup.inline_keyboard[0][0].url,'https://charmiptv.example');
  assert.equal(body.text,'CharmIPTV');
});
