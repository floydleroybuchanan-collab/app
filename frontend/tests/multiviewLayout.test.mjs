import test from 'node:test';
import assert from 'node:assert/strict';
import {multiviewLayout} from '../src/core/multiviewLayout.ts';
test('adaptive layouts cover the canvas with no overlap or missing area',()=>{
 for(let count=1;count<=4;count++) {
  const boxes=Object.values(multiviewLayout([0,1,2,3].slice(0,count),null));
  assert.ok(Math.abs(boxes.reduce((sum,b)=>sum+b.width*b.height,0)-10000)<.1);
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++) {
   const a=boxes[i],b=boxes[j];
   assert.ok(a.left+a.width<=b.left+.001 || b.left+b.width<=a.left+.001 || a.top+a.height<=b.top || b.top+b.height<=a.top);
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
