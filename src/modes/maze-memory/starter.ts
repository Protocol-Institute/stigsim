import type { Strategy } from "./contract";
export const STARTER: Strategy = {
  format: "stigsim-maze-memory-strategy@1",
  name: "Local JSON marks: least-used passage",
  description:
    "Code updates local JSON passage notes after successful movement; Jev chooses every direction.",
  parent: null,
  source: `// Memory lives in JSON notes on passages, shared from either end; it resets each maze.
// This example uses a visits count, but notes can contain any JSON within size limits.
function prepare(o) {
 const passageUses = {};
 const writes = [];
 for (const d of ['N','E','S','W']) {
   if (!o.exits[d]) continue;
   // Read only nearby open passages. An unmarked passage has zero visits.
   const note = o.environment.passages[d] || {};
   passageUses[d] = note.visits || 0;
   // Propose updates now; the runner commits only the passage Jev successfully crosses.
   writes.push({ target: d, when: 'chosen', value: { ...note, visits: passageUses[d] + 1 } });
 }
 return {
   instructions: 'Choose the OPEN direction with the lowest passageUses count. Ties: N,E,S,W. Never choose a blocked direction.',
   // Give Jev the counts; Jev chooses the direction, not this code.
   context: { passageUses },
   writes
 };
}`,
};
