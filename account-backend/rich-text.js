// Shared browser/server codec. Only this small allowlist may reach a rendered message.
const PREFIX='[[CHARM_RICH_V1]]';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const decode=s=>s.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,(m,k)=>{const map={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(map[k])return map[k];const n=k.startsWith('#x')?parseInt(k.slice(2),16):Number(k.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
const tags=new Set(['p','br','b','i','u','s','mark','h1','h2','h3','ul','ol','li','blockquote','a']);
export const isRich=s=>typeof s==='string'&&s.startsWith(PREFIX);
export function readRich(value){
 if(typeof value!=='string')throw Object.assign(Error('Message must be text.'),{status:400});
 if(!isRich(value))return {html:escape(value).replaceAll('\n','<br>'),text:value};
 if(value.length>200000)throw Object.assign(Error('Formatted message is too large.'),{status:400});
 const source=value.slice(PREFIX.length),stack=[],lists=[];let html='',text='',count=0;
 const bad=()=>{throw Object.assign(Error('Unsupported message formatting. Clear formatting and try again.'),{status:400});};
 for(const token of source.match(/<[^>]*>|[^<]+|</g)||[]){
  if(!token.startsWith('<')){const t=decode(token);html+=escape(t);text+=t;continue;}
  const m=token.match(/^<(\/)?([a-z0-9]+)(?: href="([^"]*)")?\s*(\/?)>$/);if(!m||!tags.has(m[2])||++count>2000)bad();
  const [,closing,tag,href]=m;
  if(closing){if(href||stack.pop()!==tag)bad();html+='</'+tag+'>';if(['p','h1','h2','h3','blockquote','li'].includes(tag))text+='\n';if(tag==='ol'||tag==='ul')lists.pop();continue;}
  if(tag==='a'){let u;try{u=new URL(decode(href||''));}catch{bad();}if(!['https:','http:','mailto:'].includes(u.protocol)||u.username||u.password)bad();html+='<a href="'+escape(u.href)+'">';}
  else {if(href)bad();html+='<'+tag+'>';}
  if(tag==='br')text+='\n';else{stack.push(tag);if(stack.length>16)bad();}
  if(['p','h1','h2','h3','blockquote'].includes(tag)&&text&&!text.endsWith('\n'))text+='\n';
  if(tag==='ul'||tag==='ol')lists.push({tag,n:0});
  if(tag==='li'){const l=lists.at(-1);text+='\n'+(l?.tag==='ol'?++l.n+'. ':'• ');}
 }
 if(stack.length)bad();return {html,text:text.replace(/\n{3,}/g,'\n\n').trim()};
}
export const richPlain=s=>readRich(s).text;
export const richLength=s=>richPlain(s).length;
export const richAppend=(s,suffix)=>isRich(s)?PREFIX+readRich(s).html+'<p>'+escape(suffix)+'</p>':s+suffix;
export const richPack=html=>{const value=PREFIX+html;readRich(value);return value;};
export {PREFIX,escape};
