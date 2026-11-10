# Local onboarding prototype

Run PORT=3021 pnpm dev --host 127.0.0.1 and open /onboarding.
Also available on the password-protected Model Ant preview. No inference is used.

## One world, two scales

Each session uses seed rustic-ember-1253 and the ordinary Maze generator:
31 × 31 cells, 10% loops, one 100-ant colony, two sources of 250 food each,
and Fast playback (60 ticks/second).
A seeded random index selects the player ant. All start at the nest, as in
Maze. Tick and deliveries start at zero; all pheromone arrays start empty.
No warm-up, painted trails, repositioned ants or authored mill.

Level 1 uses shared manual-ant commands and close-up rendering. A six-cell
local window is default; the original two-cell view is also selectable.
The other 99 ants forage immediately. Their trails emerge through ordinary
laying and evaporation. Only the player's own delivery unlocks level 2.
Hints explain signals and traffic, not a solution path.

Level 2 receives the exact same Simulation object. The only transition command
releases manual control. The maze, seed/RNG, tick, food, scores, ant positions
and targets, and all fields are preserved. The view switches to the whole maze
and pauses for orientation; Resume continues the same colony. Settings are
read from the existing doctrine and use normal setDoctrine commands.

A mill is not guaranteed. The route objective requires six actual returns
along one loop-erased route within 1500 ticks and 35% of ants using that route
for 200 ticks. This allows several food routes to coexist. Tracking starts at
level 2; partial returns already under way are ignored. Earlier deliveries
alone cannot complete it. No optimality claim or hidden controller is provided.

Restart this maze starts level 1 with the same seed and player identity.
Refresh starts over on rustic-ember-1253.

Tests verify empty initial fields, random/reproducible selection, emerging
trails, personal pickup/delivery, exact state preservation at zoom-out, and
route completion with live physics. Test-only BFS is never given to the UI.

Level 2 is open-ended: confirmed highways never stop playback or hide settings.
Distinct loop-erased delivered routes are counted once each as milestones.
Players can fade old trails, encourage exploration and reinforce a new route.
Food remains finite; exhaustion is shown explicitly and does not stop the clock.

The onboarding food positions are deliberate: (22,13), the original marked
source, and (15,18), on another branch. Nest distances are 61 and 73 steps;
the sources are 36 steps apart. This overrides only food placement, not maze
terrain, ant behavior or trails. Both levels retain these same sources.
