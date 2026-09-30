import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('mobile Guide selectors never render above the TV preview',()=>{
 const tv=read('../app/(tabs)/guide.tsx');
 const mobile=read('../src/components/MobileLiveGuide.tsx');
 assert.doesNotMatch(tv,/<GuideSelectors\b/);
 assert.match(tv,/<PurpleGuideGroupDrawer\b/);
 assert.match(mobile,/<GuideSelectors mobile\b/);
 assert.ok(mobile.indexOf('<GuideSelectors') < mobile.indexOf('<FlatList key='), 'Mobile selectors precede channel cards');
});

