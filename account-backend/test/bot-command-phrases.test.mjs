import test from 'node:test';
import assert from 'node:assert/strict';
import {BOT_COMMANDS,exactCommand,commandText,commandButtons,migrateCommandMenus} from '../bot-commands.js';
import {fixture} from './fixture.mjs';
import {member} from '../bot-store.js';

test('every advertised user and admin command is a Mr Charm phrase with a working button route',()=>{
 for(const c of BOT_COMMANDS){
  assert.match(c.label,/^Mr Charm [A-Z]/); assert.ok(!c.label.includes('/'));
  const parsed=BOT_COMMANDS.find(x=>x.id===exactCommand(c.label));
  assert.ok(parsed,c.label); assert.equal(parsed.id,c.id);
  const b=commandButtons({inline_keyboard:[[{text:'old /'+c.command,callback_data:c.id}]]}).inline_keyboard[0][0];
  assert.equal(b.text,c.label); assert.equal(b.callback_data,c.id);
 }
 assert.equal(commandText('Use /help or /link_telegram. Visit https://example.test/help'), 'Use Mr Charm Help or Mr Charm Link My Account. Visit https://example.test/help');
 assert.equal(commandText('Mr. Charm Help'),'Mr Charm Help');
});
test('old Telegram slash menus are cleared in all previous scopes and migration is resumable',async()=>{
 const f=fixture(),calls=[],s={group_id:'-100123456789'};
 await member(f.env,{id:12345,first_name:'Viewer'},'member');
 const telegram=async(_env,method,body)=>{calls.push({method,body});return true;};
 await migrateCommandMenus(f.env,s,telegram);
 assert.deepEqual(new Set(calls.map(c=>c.body.scope.type)),new Set(['default','all_private_chats','all_group_chats','all_chat_administrators','chat','chat_administrators','chat_member']));
 assert.ok(calls.every(c=>c.method==='deleteMyCommands'));
 assert.ok(calls.some(c=>c.body.scope.type==='chat_member'&&c.body.scope.user_id===12345));
 const count=calls.length;await migrateCommandMenus(f.env,s,telegram);assert.equal(calls.length,count);
});
