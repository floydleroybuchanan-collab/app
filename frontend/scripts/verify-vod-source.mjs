import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const vod=resolve(dirname(fileURLToPath(import.meta.url)), '../android/vod');
const hashes=JSON.parse(readFileSync(resolve(vod,'preserved-source-sha256.json'),'utf8'));
const reviewed=JSON.parse(readFileSync(resolve(vod,'reviewed-player-sha256.json'),'utf8'));
const prefix='app/src/main/java/com/streamflixreborn/streamflix/';
const allowed=new Set(['models/Video.kt','fragments/player/PlayerMobileFragment.kt',
  'fragments/player/PlayerTvFragment.kt','fragments/player/PlayerViewModel.kt',
  'fragments/player/settings/PlayerSettingsMobileView.kt','fragments/player/settings/PlayerSettingsTvView.kt'].map(name=>prefix+name));
for (const [name,entry] of Object.entries(reviewed)) {
  if (!allowed.has(name) || entry.upstream !== hashes[name] || !/^[a-f0-9]{64}$/.test(entry.sha256) || !entry.reason)
    throw new Error(`Invalid reviewed VOD change: ${name}`);
}
const failures=[];
for(const [name,expected] of Object.entries(hashes)) {
  const actual=createHash('sha256').update(readFileSync(resolve(vod,name))).digest('hex');
  if(actual!==(reviewed[name]?.sha256 ?? expected)) failures.push(name);
}
if(failures.length) throw new Error(`Upstream provider/extractor/player/data implementation changed:\n${failures.join('\n')}`);
console.log(`Verified ${Object.keys(hashes).length} VOD files: unchanged upstream ff970d3 code plus ${Object.keys(reviewed).length} exact reviewed player changes. No provider/extractor exceptions are allowed.`);
