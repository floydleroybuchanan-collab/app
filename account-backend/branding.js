/** Display migration: keep URLs, handles, account keys and saved revision history intact. */
export function brandText(value) {
 if(typeof value!=='string')return value;
 return value.replace(/https?:\/\/[^\s<>]+|@[a-z0-9_]+|\bcharm\s*iptv\b/gi,
  text=>/^https?:|^@/i.test(text)?text:'Charming MediaLab');
}
export function brandedContent(row){return row?{...row,body:brandText(row.body)}:row;}

/** Apply display branding at the Telegram boundary, including pre-upgrade queued jobs. */
export function brandedTelegramBody(body){
 const next={...body};
 for(const [field,entities] of [['text','entities'],['caption','caption_entities']]){
  if(typeof next[field]!=='string')continue;
  const value=brandText(next[field]);
  // Explicit entity offsets refer to the old UTF-16 string. Prefer plain text
  // over invalid ranges when a saved message's visible wording changes.
  if(value!==next[field])delete next[entities];
  next[field]=value;
 }
 if(next.rich_message?.html)next.rich_message={...next.rich_message,html:brandText(next.rich_message.html)};
 if(next.reply_markup){
  next.reply_markup={...next.reply_markup};
  for(const key of ['inline_keyboard','keyboard'])if(Array.isArray(next.reply_markup[key]))
   next.reply_markup[key]=next.reply_markup[key].map(row=>row.map(button=>typeof button==='string'?brandText(button):{...button,text:brandText(button.text)}));
 }
 return next;
}
