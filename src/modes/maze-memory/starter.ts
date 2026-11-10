import type { Strategy } from "./contract";
export const STARTER: Strategy = {
  format: "stigsim-maze-memory-strategy@1",
  name: "Local JSON marks: least-used passage",
  description:
    "Code updates local JSON passage notes after successful movement; Jev chooses every direction.",
  parent: null,
  source: `// Prefer the least-used open passage. Jev chooses the move; code updates its count.
function prepare(o) {
 const passageUses = {};
 const writes = [];
 for (const d of ['N','E','S','W']) {
   if (!o.exits[d]) continue;
   const note = o.environment.passages[d] || {};
   passageUses[d] = note.visits || 0;
   // Update only the passage Jev successfully crosses.
   writes.push({ target: d, when: 'chosen', value: { ...note, visits: passageUses[d] + 1 } });
 }
 return {
   instructions: 'Choose the OPEN direction with the lowest passageUses count. Ties: N,E,S,W. Never choose a blocked direction.',
   context: { passageUses },
   writes
 };
}`,
};
