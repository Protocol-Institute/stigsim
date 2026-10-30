import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExplorationPolicy } from '../../../shared/model-ant-policy';
import type { NotebookCell } from '../../../shared/model-ant';
const cell = (x: number, y: number, visits = 1): NotebookCell => ({ x, y, visits, cell: 'passage' });
test('policy prefers unvisited neighbors in NESW order and scores without overriding', () => {
 const map = [cell(2,2), cell(2,1,0), cell(3,2,0)];
 assert.equal(checkExplorationPolicy(map,{x:2,y:2},'east').expectedDirection,'north');
 assert.equal(checkExplorationPolicy(map,{x:2,y:2},'east').compliant,false);
 assert.equal(checkExplorationPolicy(map,{x:2,y:2},'north').compliant,true);
});
test('policy follows shortest known route, resolving equal routes in NESW order', () => {
 const map = [cell(2,2),cell(2,1),cell(3,2),cell(3,1),cell(4,1,0)];
 assert.equal(checkExplorationPolicy(map,{x:2,y:2},'north').expectedDirection,'north');
 const shorter = [...map,cell(4,2,0)];
 assert.equal(checkExplorationPolicy(shorter,{x:2,y:2},'east').expectedDirection,'east');
});
test('policy cannot route through unknown cells or walls and allows exhausted maps', () => {
 const map = [cell(1,1),cell(3,1),cell(4,1,0),{...cell(2,1),cell:'wall' as const}];
 assert.equal(checkExplorationPolicy(map,{x:1,y:1},'south').compliant,null);
});

test('right-hand rule rotates with heading, reverses at dead ends, and ignores walls', async () => {
 const { checkRightHand } = await import('../../../shared/model-ant-policy');
 const open = { north:'passage',east:'passage',south:'passage',west:'passage' } as const;
 assert.equal(checkRightHand(open,'north','east').compliant,true);
 assert.equal(checkRightHand(open,'east','south').compliant,true);
 assert.equal(checkRightHand({...open,south:'wall'},'east','east').compliant,true);
 assert.equal(checkRightHand({north:'wall',east:'wall',south:'wall',west:'passage'},'east','west').compliant,true);
});
