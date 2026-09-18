// Uses the same allowlisted codec as the backend; no pasted HTML is trusted.
const {readRich,richPlain,richPack,escape:richEscape}=window.CharmRich;
function richPreview(value){const box=document.createElement('div');box.className='rich-preview';box.innerHTML=readRich(value).html;box.querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});return box;}
function richEditor(input){
 if(input.dataset.richEditor)return;input.dataset.richEditor='true';
 const initial=input.value,wrap=document.createElement('div');wrap.className='rich-editor';
 const tools=document.createElement('div');tools.className='rich-toolbar';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','Text formatting');
 const edit=document.createElement('div');edit.className='rich-edit';edit.contentEditable='true';edit.setAttribute('role','textbox');edit.setAttribute('aria-multiline','true');edit.setAttribute('aria-label',input.closest('label')?.firstChild?.textContent||'Message');edit.innerHTML=readRich(initial).html;
 const count=document.createElement('small');count.className='rich-count';count.setAttribute('aria-live','polite');
 let selection=null;
 const saveSelection=()=>{const s=window.getSelection();if(s?.rangeCount&&edit.contains(s.anchorNode)&&edit.contains(s.focusNode))selection=s.getRangeAt(0).cloneRange();};
 edit.addEventListener('keyup',saveSelection);edit.addEventListener('mouseup',saveSelection);edit.addEventListener('focusout',saveSelection);
 const restore=()=>{saveSelection();edit.focus();if(selection&&edit.contains(selection.commonAncestorContainer)){const s=window.getSelection();s.removeAllRanges();s.addRange(selection);}};
 function serialize(node){
  if(node.nodeType===3)return richEscape(node.nodeValue);
  if(node.nodeType!==1)return '';
  let tag=node.tagName.toLowerCase();if(['script','style','iframe','img','object','svg','video','audio'].includes(tag))return '';
  const inside=[...node.childNodes].map(serialize).join('');
  if(tag==='div')tag='p';if(tag==='strong')tag='b';if(tag==='em')tag='i';if(tag==='strike'||tag==='del')tag='s';
  if(tag==='span'||tag==='font'){
   let value=inside;
   if(node.style.fontWeight==='bold'||Number(node.style.fontWeight)>=600)value='<b>'+value+'</b>';
   if(node.style.fontStyle==='italic')value='<i>'+value+'</i>';
   if(node.style.textDecorationLine.includes('underline'))value='<u>'+value+'</u>';
   if(node.style.backgroundColor&&node.style.backgroundColor!=='transparent')value='<mark>'+value+'</mark>';
   return value;
  }
  if(tag==='a'){try{const u=new URL(node.getAttribute('href'));if(['https:','http:','mailto:'].includes(u.protocol)&&!u.username&&!u.password)return '<a href="'+richEscape(u.href)+'">'+inside+'</a>';}catch{}return inside;}
  if(tag==='br')return '<br>';
  return ['p','b','i','u','s','mark','h1','h2','h3','ul','ol','li','blockquote'].includes(tag)?'<'+tag+'>'+inside+'</'+tag+'>':inside;
 }
 const value=()=>{const html=[...edit.childNodes].map(serialize).join('');return richPlain(richPack(html)).trim()?richPack(html):'';};
 function update(){try{const text=richPlain(value()),limit=input.maxLength>0?input.maxLength:50000;count.textContent=text.length.toLocaleString()+' / '+limit.toLocaleString()+' characters';count.classList.toggle('error',text.length>limit);input.setCustomValidity(text.length>limit?'Message exceeds its character limit.':'');input.dispatchEvent(new Event('input',{bubbles:true}));}catch(e){count.textContent=e.message;input.setCustomValidity(e.message);}}
 Object.defineProperty(input,'value',{get:value,set(v){edit.innerHTML=readRich(String(v||'')).html;selection=null;update();},configurable:true});
 const tool=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.title=label;b.addEventListener('mousedown',e=>e.preventDefault());b.onclick=()=>{restore();action();saveSelection();update();};tools.append(b);return b;};
 const command=(name,arg=null)=>document.execCommand(name,false,arg);
 tool('Bold',()=>command('bold'));tool('Italic',()=>command('italic'));tool('Underline',()=>command('underline'));tool('Strike',()=>command('strikeThrough'));
 tool('Highlight',()=>command('hiliteColor','#f2d675'));
 const style=document.createElement('select');style.setAttribute('aria-label','Text size');for(const [v,t] of [['p','Normal text'],['h1','Large heading'],['h2','Heading'],['h3','Small heading']]){const o=document.createElement('option');o.value=v;o.textContent=t;style.append(o);}style.onchange=()=>{restore();command('formatBlock',style.value);saveSelection();update();};tools.append(style);
 tool('1. Steps',()=>command('insertOrderedList'));tool('• List',()=>command('insertUnorderedList'));
 const linkRow=document.createElement('div');linkRow.className='rich-link-row';linkRow.hidden=true;const linkInput=document.createElement('input');linkInput.type='url';linkInput.placeholder='https://example.com';linkInput.setAttribute('aria-label','Link destination');const linkSave=document.createElement('button');linkSave.type='button';linkSave.textContent='Apply link';linkSave.onclick=()=>{try{const u=new URL(linkInput.value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error();restore();command('createLink',u.href);linkRow.hidden=true;saveSelection();update();}catch{count.textContent='Enter a valid HTTP or HTTPS link without credentials.';}};linkRow.append(linkInput,linkSave);tool('Link',()=>{linkRow.hidden=!linkRow.hidden;if(!linkRow.hidden)linkInput.focus();});
 const emojis=document.createElement('div');emojis.className='rich-emoji';emojis.hidden=true;for(const emoji of ['👑','💜','📺','🎬','📣','🔗','🔑','✅','⚠️','🛡️','📱','📥','🤖','❤️','⭐','🆓']){const b=document.createElement('button');b.type='button';b.textContent=emoji;b.onclick=()=>{restore();command('insertText',emoji);emojis.hidden=true;saveSelection();update();};emojis.append(b);}tool('Emoji',()=>{emojis.hidden=!emojis.hidden;});
 tool('Clear style',()=>{command('removeFormat');command('formatBlock','p');});tool('Undo',()=>command('undo'));tool('Redo',()=>command('redo'));
 const preview=document.createElement('div');preview.hidden=true;tool('Preview',()=>{preview.replaceChildren(richPreview(value()));preview.hidden=!preview.hidden;});
 edit.addEventListener('input',update);
 edit.addEventListener('paste',e=>{e.preventDefault();const html=e.clipboardData.getData('text/html'),text=e.clipboardData.getData('text/plain');if(html){const doc=new DOMParser().parseFromString(html,'text/html');const safe=[...doc.body.childNodes].map(serialize).join('');command('insertHTML',readRich(richPack(safe)).html);}else command('insertText',text);saveSelection();update();});
 input.hidden=true;input.required=false;input.parentNode.insertBefore(wrap,input.nextSibling);wrap.append(tools,linkRow,emojis,edit,count,preview);update();
}
function enhanceMessages(root=document){root.querySelectorAll('textarea:not([data-rich-editor]),input[name="update_message"]:not([data-rich-editor])').forEach(richEditor);}
new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1)))enhanceMessages();}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',()=>enhanceMessages());
