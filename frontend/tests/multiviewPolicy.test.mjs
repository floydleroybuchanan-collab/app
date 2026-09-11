import test from 'node:test';
import assert from 'node:assert/strict';
import { multiviewAdmission, nextAudiblePane } from '../src/core/multiviewPolicy.ts';

const channel = (id, provider='a') => ({id, playlist_id:provider});
const pane = (id, provider='a') => ({channel:channel(id,provider),revision:1});
test('multiview enforces four slots and rejects duplicate channels', () => {
  const panes=[pane('1'),pane('2'),pane('3'),null];
  assert.equal(multiviewAdmission(panes,3,channel('4')),null);
  assert.ok(multiviewAdmission(panes,4,channel('5')));
  assert.ok(multiviewAdmission(panes,-1,channel('5')));
  assert.ok(multiviewAdmission(panes,1.5,channel('5')));
  assert.ok(multiviewAdmission(panes,3,channel('1')));
});
test('replacement keeps its provider connection while other providers have separate limits', () => {
  const panes=[pane('1'),pane('2','b'),pane('3','b'),null];
  assert.equal(multiviewAdmission(panes,0,channel('4'),1),null);
  assert.ok(multiviewAdmission(panes,3,channel('4'),1));
  assert.equal(multiviewAdmission(panes,1,channel('5','b'),2),null);
  assert.equal(multiviewAdmission(panes,3,channel('6','c'),1),null);
});
test('unknown provider limit remains usable and removing a pane preserves audible channel', () => {
  assert.equal(multiviewAdmission([pane('1'),null,null,null],1,channel('2'),0),null);
  assert.equal(nextAudiblePane([null,pane('2'),pane('3'),null],2),2);
  assert.equal(nextAudiblePane([null,pane('2'),pane('3'),null],0),1);
  assert.equal(nextAudiblePane([null,null,null,null],0),-1);
});
