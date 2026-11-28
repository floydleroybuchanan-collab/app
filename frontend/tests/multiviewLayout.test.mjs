import test from 'node:test';
import assert from 'node:assert/strict';
import {multiviewLayout} from '../src/core/multiviewLayout.ts';
test('every tile keeps the 16:9 screen shape, stays on screen and never overlaps',()=>{
 for(let count=1;count<=4;count++) {
  const boxes=Object.values(multiviewLayout([0,1,2,3].slice(0,count),null));
  for(const b of boxes){
   assert.ok(Math.abs(b.width-b.height)<.001,`count ${count}: tile ${b.width}x${b.height} would stretch video`);
   assert.ok(b.left>=0&&b.top>=0&&b.left+b.width<=100.001&&b.top+b.height<=100.001);
  }
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++) {
   const a=boxes[i],b=boxes[j];
   assert.ok(a.left+a.width<=b.left+.001 || b.left+b.width<=a.left+.001 || a.top+a.height<=b.top+.001 || b.top+b.height<=a.top+.001);
  }
 }
});
test('swap and enlarge retain decoder identities and can restore exact positions',()=>{
 const normal=multiviewLayout([3,1,0,2],null);
 const enlarged=multiviewLayout([3,1,0,2],1);
 assert.deepEqual(Object.keys(normal),Object.keys(enlarged));
 assert.equal(enlarged[1].width,100);assert.equal(enlarged[1].left,0);
 assert.equal(enlarged[3].left,-200);
 assert.deepEqual(multiviewLayout([3,1,0,2],null),normal);
});
