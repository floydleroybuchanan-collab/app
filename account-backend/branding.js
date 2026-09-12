/** Display migration: keep URLs, handles, account keys and saved revision history intact. */
export function brandText(value) {
 if(typeof value!=='string')return value;
 return value.replace(/https?:\/\/[^\s<>]+|@[a-z0-9_]+|\bcharm\s*iptv\b/gi,
  text=>/^https?:|^@/i.test(text)?text:'Charming MediaLab');
}
export function brandedContent(row){return row?{...row,body:brandText(row.body)}:row;}
