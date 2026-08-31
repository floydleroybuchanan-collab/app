import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const vod=resolve(dirname(fileURLToPath(import.meta.url)), '../android/vod');
const hashes=JSON.parse(readFileSync(resolve(vod,'preserved-source-sha256.json'),'utf8'));
const failures=[];
for(const [name,expected] of Object.entries(hashes)) {
  const actual=createHash('sha256').update(readFileSync(resolve(vod,name))).digest('hex');
  if(actual!==expected) failures.push(name);
}
if(failures.length) throw new Error(`Upstream provider/extractor/player/data implementation changed:\n${failures.join('\n')}`);
console.log(`Verified ${Object.keys(hashes).length} VOD implementation files byte-for-byte against upstream ff970d3.`);
