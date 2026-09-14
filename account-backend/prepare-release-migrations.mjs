import {mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

// Earlier production schemas were applied manually. Only these new migrations
// belong to this release; Wrangler still records each in d1_migrations.
const root=dirname(fileURLToPath(import.meta.url));
const folder=join(root,'.wrangler','release-migrations');
mkdirSync(folder,{recursive:true});
for(const name of ['0009_bot_response_cleanup.sql','0010_account_security.sql','0011_announcements.sql','0012_verified_recovery.sql'])copyFileSync(join(root,'migrations',name),join(folder,name));
writeFileSync(join(root,'.wrangler','release-migrations.json'),JSON.stringify({
 name:'charmiptv-account-api',compatibility_date:'2026-09-04',
 d1_databases:[{binding:'DB',database_name:'charmiptv-accounts',database_id:'9e4e3e10-d947-467b-a7e5-b8530ceac272',migrations_dir:'./release-migrations'}]
},null,2)+'\n');
console.log('Prepared the four account update migrations; existing account schemas are excluded.');
