# Summer of Stigmergy — verified reading corpus

Working notes for the SIGFPT report that will serve as preread for the
Stigmergy Workshop at Protocol Symposium 2026 (21–22 September). Every citation
below was checked against a primary or publisher source in September 2026. The
Discord threads are the record of what was actually assigned and discussed; this
file is the cleaned-up version of that record.

Scope follows the decision to cover core readings plus recurring touchstones,
rather than every link dropped in chat.

## Session index

### 1 May 2026 — Stigmergy (part I)

Discussion session, no assigned paper. Venkat connects stigmergy to the New
Nature research theme; Kyle Mathews frames protocol engineering as designing the
medium rather than the agent behaviour. Useful for the report's framing, not its
bibliography.

### 15 May 2026 — Stigmergy part II

Discussion session, no assigned paper. Contains the exchange on stigmergic
versus "verbose" systems and the question of necessary and sufficient conditions
for preferring one over the other.

### 29 May 2026 — Stigmergy 3: Pebble Automata

- Blum, M., & Kozen, D. (1978). *On the Power of the Compass (or, Why Mazes are
  Easier to Search than Graphs)*. Proc. 19th Annual Symposium on Foundations of
  Computer Science (FOCS), 132–142. Assigned as the Berkeley ERL tech report:
  <https://www2.eecs.berkeley.edu/Pubs/TechRpts/1978/Archive/ERL-m-78-64.pdf>.
  Two pebbles suffice to search any finite maze; whether one pebble suffices was
  left open.
- Donald, B. R. (2012). *The Compass That Steered Robotics*. In: Logic and
  Program Semantics (LNCS 7230). Posted in-thread as a more approachable
  companion:
  <https://users.cs.duke.edu/~brd/papers/pdf-reprints/compass-dexter12.pdf>.

Venkat's framing question from this session — whether there are equivalents of a
compass in general information environments — recurs later and is worth carrying
into the report.

### 12 June 2026 — Stigmergy workshop brainstorm

Planning session. Origin of the simulator effort; Dan Schmidt's ant maze
prototype and the Northward pebble game both come out of the pebble automata
discussion.

### 26 June 2026 — Robotics crossover

Cross-disciplinary session. This is where the maneuver automata vocabulary
enters the SIG (see verification notes).

### 10 July 2026 — Formal Modeling of Stigmergy (part 1)

- Deneubourg, J.-L., Aron, S., Goss, S., & Pasteels, J. M. (1990). *The
  self-organizing exploratory pattern of the Argentine ant*. Journal of Insect
  Behavior, 3(2), 159–168.
- Goss, S., Aron, S., Deneubourg, J.-L., & Pasteels, J. M. (1989).
  *Self-organized shortcuts in the Argentine ant*. Naturwissenschaften, 76,
  579–581. <https://link.springer.com/article/10.1007/BF00462870>. The double
  bridge experiment.
- Dorigo, M., & Stützle, T. (2004). *Ant Colony Optimization*. MIT Press,
  chapter 1 (first nine pages), assigned as pedagogical background.
- Perna, A., Granovskiy, B., Garnier, S., Nicolis, S. C., Labédan, M.,
  Theraulaz, G., Fourcassié, V., & Sumpter, D. J. T. (2012). *Individual Rules
  for Trail Pattern Formation in Argentine Ants (Linepithema humile)*. PLoS
  Computational Biology, 8(7), e1002592. Tertiary reading; connects individual
  behaviour to the Weber–Fechner law.

### 24 July 2026 — Formal Methods in Stigmergy part 2 (construction stigmergy)

- Theraulaz, G., & Bonabeau, E. (1995). *Coordination in Distributed Building*.
  Science, 269(5224), 686–688.
- Theraulaz, G., & Bonabeau, E. (1995). *Modelling the Collective Building of
  Complex Architectures in Social Insects with Lattice Swarms*. Journal of
  Theoretical Biology, 177(4), 381–400.
- Werfel, J., Petersen, K., & Nagpal, R. (2014). *Designing Collective Behavior
  in a Termite-Inspired Robot Construction Team*. Science, 343(6172), 754–758.
  The TERMES project; assigned as the applied example.

This is the session that introduces qualitative (sematectonic) stigmergy as
distinct from the quantitative, marker-based kind, and the one that produces the
"antermite" idea for the simulator.

### 7 August 2026 — Engineered Stigmergic Algorithms

- Dorigo, M., Birattari, M., & Stützle, T. (2006). *Ant Colony Optimization:
  Artificial Ants as a Computational Intelligence Technique*. IEEE Computational
  Intelligence Magazine, 1(4), 28–39.
- Ye, H., Wang, J., Cao, Z., Liang, H., & Li, Y. (2023). *DeepACO:
  Neural-enhanced Ant Systems for Combinatorial Optimization*. NeurIPS 2023.
  arXiv:2309.14032.
- Secondary, posted in-thread: Meuleau, N., & Dorigo, M. (2002). *Ant colony
  optimization and stochastic gradient descent*. Artificial Life, 8(2), 103–121.
  And an AntNet-lineage routing paper, arXiv:1105.5449.

### 21 August 2026 — Collaborative Search Theory (treasure hunt)

- Bampas, E., Beauquier, J., Burman, J., & Guy-Obé, W. (2023). *Treasure Hunt
  with Volatile Pheromones*. DISC 2023, LIPIcs vol. 281, article 8.
  <https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.DISC.2023.8>.
  Full version with appendices: <https://hal.science/hal-04177364/document>.
- Feinerman, O., & Korman, A. (2017). *The ANTS problem*. Distributed Computing,
  30, 149–168. arXiv:1701.02555. The Ants Nearby Treasure Search framing.
- Pelc, A., & Yadav, R. N. (2021). *Advice complexity of treasure hunt in
  geometric terrains*. Information and Computation, 281, 104705.
- Blum & Kozen (above) is the back-reference for the pebble lineage.

### 4 September 2026 — Stigmergic Fragility and Exploits

- Zhong, W., & Evans, D. (2002). *When Ants Attack: Security Issues for
  Stigmergic Systems*. University of Virginia Technical Report CS-2002-23.
  <https://www.cs.virginia.edu/~evans/pubs/whenantsattack.pdf>. Uses AntNet to
  enumerate attacks on a stigmergic routing system.
- Hunt, E. R., Jones, S., & Hauert, S. (2019). *Testing the limits of pheromone
  stigmergy in high-density robot swarms*. Royal Society Open Science, 6(11),
  190225. At high density a stigmergic avoidance algorithm becomes worse than
  non-interacting random walkers.
- Secondary: Burke, R., Mobasher, B., & Bhaumik, R. (2005). *Recommender
  Systems, Attack Types and Strategies*. AAAI 2005.
  <https://cdn.aaai.org/AAAI/2005/AAAI05-053.pdf>.
- Refresher: Aswale, A., López, A., Ammartayakun, A., & Pinciroli, C. (2022).
  *Hacking the Colony: On the Disruptive Effect of Misleading Pheromone and How
  to Defend Against It*. AAMAS 2022. arXiv:2202.01808. Introduces detractor
  agents and the cautionary pheromone countermeasure.

### 18 September 2026 — Defenses, robustness, and Fault/Byzantine Tolerance

Announced but not yet held. The obvious reading here, and the one the draft
outline's section 6 leans on, is Strobel, V., Pacheco, A., & Dorigo, M. (2023),
*Robot swarms neutralize harmful Byzantine robots using a blockchain-based token
economy*, Science Robotics, 8(79), eabm4636. It has not been assigned yet.

## The corpus by lineage

This is the spine for the narrative bibliography.

**Biology and the origin of the term.** Grassé, P.-P. (1959), *La reconstruction
du nid et les coordinations interindividuelles chez Bellicositermes natalensis
et Cubitermes sp. La théorie de la stigmergie*, Insectes Sociaux, 6, 41–80,
where the word is coined; Deneubourg, Goss and colleagues on the Argentine ant
and the double bridge; Perna et al. on individual rules and Weber's law;
Theraulaz, G., & Bonabeau, E. (1999), *A brief history of stigmergy*, Artificial
Life, 5(2), 97–116, as the standard retrospective.

**Construction stigmergy.** Theraulaz and Bonabeau's lattice swarms, and TERMES
as the engineered descendant. This is the sematectonic branch: agents write
terrain rather than markers.

**Swarm optimization.** Dorigo's ACO lineage, from the 2006 survey through the
Meuleau–Dorigo gradient-descent connection to DeepACO. Also where Max-Min Ant
System and the bounded-pheromone results live.

**Distributed computing and complexity.** Blum and Kozen's pebble automata,
Feinerman and Korman's ANTS problem, Bampas et al. on volatile pheromones, Pelc
and Yadav on advice complexity. This lineage asks what agents with almost no
memory can compute using the environment.

**Adversarial and security.** Zhong and Evans; Aswale et al.; Hunt et al. on
density-induced failure; the recommender-system shilling literature as the
human-scale analogue; Strobel et al. as the defensive frontier.

**AI agent stigmergy.** A recurring touchstone rather than a literature: the
OpenAI/HuggingFace agent incident, in which agents built themselves a message
board twice and coordinated through it. Also the observation that multi-agent RL
systems have been seen to learn stigmergic marker strategies (arXiv:2310.15414).

## Verification notes

Everything in the session index resolved to a real paper with a checkable
source. Three things worth recording.

Maneuver automata is not a bad citation. It is the SIG's own vocabulary,
introduced in the June robotics crossover session and referenced back in the
24 July session announcement alongside pebble automata. If the report uses the
term it should say where it comes from, since a reader outside the SIG will not
place it. The underlying idea is most likely Frazzoli's maneuver automaton from
hybrid motion planning, but I have not confirmed that this is what the SIG meant
and would not assert it without checking.

The ScienceDirect link Venkat posted on 21 August (S0890540121000201) returns a
403 and I could not fetch it. The ISSN belongs to Information and Computation,
and he posted the Pelc and Yadav citation a minute earlier, so it is almost
certainly the same paper. Worth a manual check before it goes in a bibliography.

The AI agent incident has no written primary source in the threads. What the
group actually worked from is a YouTube video Venkat posted on 10 August
(<https://www.youtube.com/watch?v=87DyyMV0kCY>). The naming is also unsettled:
the threads call it the OpenAI/HuggingFace exploit, the HuggingFace thread, and
once the Artifactory incident. For a published post that opens on this incident
we need a citable written account and a settled name, and we should mark clearly
which details are established and which are inference.

## Open items

The draft outline's section 6, on patching the vulnerabilities, rests largely on
the 18 September session, which has not happened. The report either ships before
that material has been discussed, or waits. Worth deciding early, because it
changes how confident section 6 can be.

Section 3, the operationalization of inviolable, immutable and persistent, is
the only original claim in the piece and is not written down anywhere yet.
