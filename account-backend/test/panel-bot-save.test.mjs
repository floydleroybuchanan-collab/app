import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('broadcast Save keeps editor mounted/open and Send uses the server-saved revision and text',async()=>{
 const nodes=[],requests=[];let editor,notice;
 const node=(tag,text)=>{const n={tag,text,children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}};nodes.push(n);return n;};
 const c={key:'broadcast',body:'Old message',enabled:1,revision:4};
 const context=vm.createContext({
  el:node,button:(text,action)=>Object.assign(node('button',text),{action}),
  check:()=>({checked:true}),botText:()=>editor={value:c.body},messageCounter:()=>{},message:text=>notice=text,
  openDialog:()=>node('dialog'),$:()=>({close(){}}),
  api:async(path,method='GET',body)=>{
   requests.push({path,method,body});
   if(path==='/admin/bot/settings')return {settings:{}};
   if(method==='GET')return {content:[c]};
   if(method==='PUT')return {content:{...c,body:'Server saved message',revision:8}};
   return {success:true};
  }
 });
 vm.runInContext(readFileSync(new URL('../../admin-panel/bot.client.js',import.meta.url),'utf8'),context);
 context.messageCounter=()=>{};
 context.botText=()=>editor={value:c.body};
 const box=node('section');await vm.runInContext('botContent',context)(box);
 const card=box.children[0];card.open=true;editor.value='New message';
 await nodes.find(n=>n.text==='Save').action();
 assert.equal(box.children[0],card);assert.equal(card.open,true);assert.match(notice,/Saved/);
 await nodes.find(n=>n.text==='Send to group').action();
 assert.ok(nodes.some(n=>n.tag==='pre'&&n.text==='Server saved message'));
 await nodes.find(n=>n.text==='Send saved broadcast').action();
 assert.equal(requests.find(r=>r.path==='/admin/bot/broadcast').body.revision,8);
});
