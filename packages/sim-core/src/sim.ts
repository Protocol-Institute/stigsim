import {
  CELL, V, ARRIVE_THRESH, DEPOSIT_RATE,
  DIRS4, TRIP_WINDOW,
} from "./constants";
import type {
  Ant, Colony, FieldSet, FoodSource, Occupancy, SimParams,
  SimulationOptions, WorldSpec,
} from "./types";
import type { RunConfig } from "./types";
import { inBounds } from "./world";
import { mazeWorld } from "./maze";
import { makeRng, shuffleInPlace, type Rng } from "./rng";
import type { Command, TimedCommand } from "./commands";
import { fingerprint, FINGERPRINT_INTERVAL } from "./fingerprint";
import {
  DEFAULT_DOCTRINE, DOCTRINE_CHANNELS, cloneDoctrine,
  type AdoptionMode, type Doctrine, type DoctrineChannel, type Role,
} from "./doctrine";
import { DEFAULT_TOPOLOGY, cloneTopology, type Topology } from "./topology";
import { chooseNext } from "./score";

export const cellCenter = (gx: number, gy: number) => ({ px: gx * CELL + CELL / 2, py: gy * CELL + CELL / 2 });

export function openNeighbours(occ: Occupancy, x: number, y: number, exX?: number, exY?: number): [number, number][] {
  // isOpen reports out-of-bounds cells as closed, so the explicit bounds test
  // this used to carry is folded into the lookup.
  return DIRS4
    .map(([dx, dy]) => [x + dx, y + dy] as [number, number])
    .filter(([nx, ny]) => occ.isOpen(nx, ny) && !(nx === exX && ny === exY));
}

export class Simulation {
  readonly config: RunConfig;
  numAnts: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
  params: SimParams;
  loopRate: number;
  readonly world: WorldSpec;
  readonly occupancy: Occupancy;
  /** Dimensions of the world being simulated. */
  readonly bounds: { cols: number; rows: number };
  colonies: Colony[];
  foodSources: FoodSource[];
  private antsRng: Rng;
  tick = 0;
  manualAntIndex: number | null = null;
  /** Incremented whenever a wall opens or closes, so caches can invalidate. */
  gridVersion = 0;
  /** When a doctrine change reaches the ants. Set by the setAdoption command. */
  adoption: AdoptionMode = "instant";
  /** How layers are read and written across colonies. Set by the setTopology command. */
  topology: Topology = DEFAULT_TOPOLOGY;
  readonly fingerprints: { t: number; h: string }[] = [];
  private pending: Command[] = [];
  private recorded: TimedCommand[] = [];
  private schedule: Map<number, Command[]> | null = null;

  constructor(config: RunConfig, options: SimulationOptions = {}) {
    const world = options.world ?? mazeWorld(config.loopRate, makeRng(config.seeds.maze));
    this.config = config;
    this.numAnts = config.numAnts;
    this.params = { ...config.params };
    this.loopRate = config.loopRate;
    this.numColonies = config.numColonies;
    this.numFoodSources = config.numFoodSources;
    this.foodPerSource = config.foodPerSource;
    this.antsRng = makeRng(config.seeds.ants);
    this.world = world;
    this.occupancy = world.occupancy;
    const bounds = this.occupancy.bounds;
    if (bounds === null) {
      throw new RangeError("Simulation needs a bounded world: placing food and fingerprinting both walk one.");
    }
    this.bounds = bounds;
    this.colonies = this._initColonies();
    this.foodSources = this._placeFoodSources(makeRng(config.seeds.food));
  }

  private _initColonies(): Colony[] {
    return Array.from({ length: this.numColonies }, (_, id) => {
      const [nestX, nestY] = this.world.nests[id];
      this.occupancy.setOpen(nestX, nestY, true);
      const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
      const colony: Colony = {
        id,
        nestX,
        nestY,
        field: this.world.createField(),
        ants: [],
        foodCollected: 0,
        discoveredSources: new Set<number>(),
        recentTrips: [],
        doctrine,
        doctrineVersion: 0,
        doctrines: new Map([[0, doctrine]]),
        doctrineRefs: new Map([[0, 0]]),
        received: new Map(),
      };
      colony.ants = Array.from({ length: this.numAnts }, (_, i) => this._newAnt(colony, i, this.numAnts));
      return colony;
    });
  }

  /** A fresh ant at the nest, holding the colony's current doctrine, roled by index. */
  private _newAnt(colony: Colony, index: number, total: number): Ant {
    const { px, py } = cellCenter(colony.nestX, colony.nestY);
    this._ref(colony, colony.doctrineVersion, +1);
    return {
      x: px, y: py,
      cx: colony.nestX, cy: colony.nestY,
      tx: colony.nestX, ty: colony.nestY,
      prevCx: colony.nestX, prevCy: colony.nestY,
      state: "searching",
      hasFood: false,
      tank: this.params.tankMax,
      colonyId: colony.id,
      stepsSinceNest: 0,
      lastSourceX: null,
      lastSourceY: null,
      role: this._roleFor(colony, index, total),
      doctrineVersion: colony.doctrineVersion,
    };
  }

  /** Spoilers are the first floor(fraction * total) ants by index. No draw is spent. */
  private _roleFor(colony: Colony, index: number, total: number): Role {
    return index < Math.floor(colony.doctrine.spoilerFraction * total) ? "spoiler" : "forager";
  }

  /** The nest event: adopt the current doctrine and take the role the index implies. */
  private _nestEvent(ant: Ant, colony: Colony, index: number) {
    this._adopt(ant, colony);
    ant.role = this._roleFor(colony, index, colony.ants.length);
  }

  /**
   * Deposits into the cell being left, once per transit frame. Channels go in
   * a fixed order — home then food, own then mimic — so the tank drains the
   * same way on every engine. Mimicry costs foraging deposition: both draw
   * on one tank and both stop when it is empty.
   */
  private _lay(ant: Ant, colony: Colony) {
    if (ant.tank <= 0) return;
    const doctrine = this.doctrineFor(ant, colony);
    const row = doctrine[ant.role].lay[ant.state];
    const mimicRate = Math.min(doctrine.mimicRate, this.topology.maxMimicRate);
    for (const ch of DOCTRINE_CHANNELS) {
      const entry = row[ch];
      if (entry.own > 0 && ant.tank > 0) {
        const amount = Math.min(ant.tank, entry.own * DEPOSIT_RATE);
        colony.field.add(ch, ant.cx, ant.cy, amount);
        ant.tank -= amount;
      }
      if (entry.mimic === 1 && ant.tank > 0) {
        const amount = Math.min(ant.tank, mimicRate * DEPOSIT_RATE);
        if (amount > 0) {
          this._depositMimic(colony, ch, ant.cx, ant.cy, amount);
          ant.tank -= amount;
        }
      }
    }
  }

  /**
   * Where a mimic deposit lands is the topology's call; the tank is charged
   * either way. Under `shared` there is one chemical, so mimicking it is laying
   * it. With more than two colonies the amount is split equally.
   */
  private _depositMimic(colony: Colony, ch: DoctrineChannel, cx: number, cy: number, amount: number) {
    const { read, mimicEnemy, provenance } = this.topology;
    if (!mimicEnemy || read === "private") return;
    if (read === "shared") { colony.field.add(ch, cx, cy, amount); return; }
    const others = this.colonies.filter(c => c !== colony);
    if (others.length === 0) return;
    const share = amount / others.length;
    for (const other of others) {
      other.field.add(ch, cx, cy, share);
      if (provenance) this._receivedFrom(other, colony.id).add(ch, cx, cy, share);
    }
  }

  /** The sublayer recording what `from` laid into `target`, allocated on first use. */
  private _receivedFrom(target: Colony, from: number): FieldSet {
    let sub = target.received.get(from);
    if (!sub) {
      sub = this.world.createField();
      target.received.set(from, sub);
    }
    return sub;
  }

  /**
   * Adjusts the holder count of one doctrine version. A version nobody holds
   * is dropped unless it is the current one, which the next arrival adopts.
   */
  private _ref(colony: Colony, version: number, delta: number) {
    const next = (colony.doctrineRefs.get(version) ?? 0) + delta;
    if (next <= 0 && version !== colony.doctrineVersion) {
      colony.doctrineRefs.delete(version);
      colony.doctrines.delete(version);
    } else {
      colony.doctrineRefs.set(version, next);
    }
  }

  /** Re-stamps an ant with the colony's current doctrine. The nest event. */
  private _adopt(ant: Ant, colony: Colony) {
    if (ant.doctrineVersion === colony.doctrineVersion) return;
    this._ref(colony, ant.doctrineVersion, -1);
    ant.doctrineVersion = colony.doctrineVersion;
    this._ref(colony, ant.doctrineVersion, +1);
  }

  /** The doctrine an ant is running, which under nest adoption need not be the colony's current one. */
  doctrineFor(ant: Ant, colony: Colony): Doctrine {
    return colony.doctrines.get(ant.doctrineVersion)!;
  }

  private _placeFoodSources(rng: Rng): FoodSource[] {
    const { cols, rows } = this.bounds;
    const nestSet = new Set(this.colonies.map(c => c.nestY * cols + c.nestX));
    // Minimum Manhattan distance from any nest
    const minDist = Math.floor(Math.min(cols, rows) / 4);
    const open: [number, number][] = [];
    for (let y = 2; y < rows - 2; y++) {
      for (let x = 2; x < cols - 2; x++) {
        if (!this.occupancy.isOpen(x, y)) continue;
        if (nestSet.has(y * cols + x)) continue;
        const farEnough = this.colonies.every(
          c => Math.abs(c.nestX - x) + Math.abs(c.nestY - y) >= minDist
        );
        if (farEnough) open.push([x, y]);
      }
    }
    shuffleInPlace(open, rng);
    const count = Math.min(this.numFoodSources, open.length);
    return open.slice(0, count).map(([x, y]) => ({
      x, y,
      remaining: this.foodPerSource,
      total: this.foodPerSource,
    }));
  }

  get allAnts(): Ant[] {
    return this.colonies.flatMap(c => c.ants);
  }

  setAntCount(n: number) {
    for (const colony of this.colonies) {
      if (n > colony.ants.length) {
        for (let i = colony.ants.length; i < n; i++) colony.ants.push(this._newAnt(colony, i, n));
      } else if (n < colony.ants.length) {
        const removed = colony.ants.splice(n);
        for (const ant of removed) this._ref(colony, ant.doctrineVersion, -1);
      }
    }
    this.numAnts = n;
    this._reindexManualAnt();
  }

  /**
   * Re-derives `manualAntIndex` from the `manual` flag.
   *
   * `manualAntIndex` addresses `allAnts`, which is every colony's ants
   * concatenated, so resizing colony 0 shifts every index after it. The flag
   * rides on the ant object and survives the move, which makes it — not the
   * index — the durable record of which ant the caller chose. A shrink that
   * drops the flagged ant leaves no flag to find, and control clears with it.
   */
  private _reindexManualAnt() {
    if (this.manualAntIndex === null) return;
    const idx = this.allAnts.findIndex(ant => ant.manual);
    this.manualAntIndex = idx < 0 ? null : idx;
  }

  get totalFoodCollected(): number {
    return this.colonies.reduce((s, c) => s + c.foodCollected, 0);
  }

  get commandLog(): readonly TimedCommand[] {
    return this.recorded;
  }

  /** Draws taken from the ant stream. Part of the run's continuation state. */
  get antsDraws(): number {
    return this.antsRng.draws;
  }

  enqueue(cmd: Command) {
    this.pending.push(cmd);
  }

  /**
   * Applies queued commands immediately, without advancing time, so a paused
   * edit shows up on screen right away. Recorded one tick ahead of the
   * current tick: a paused edit happens after tick N's physics has already
   * run, and replay drains a tick's commands at the top of that tick, before
   * its physics runs. Stamping the command `t: N + 1` is what makes replay
   * apply it at the same point in the run where it actually happened — the
   * top of the next tick, which is exactly where nothing else occurs between
   * the pause and the resume.
   */
  flushPending() {
    if (this.schedule) return;
    const cmds = this.pending.splice(0, this.pending.length);
    for (const cmd of cmds) {
      this.apply(cmd);
      this.recorded.push({ t: this.tick + 1, cmd });
    }
  }

  /** Switches the simulation from live input to a recorded command schedule. */
  loadSchedule(cmds: TimedCommand[]) {
    this.schedule = new Map();
    for (const { t, cmd } of cmds) {
      const at = this.schedule.get(t);
      if (at) at.push(cmd);
      else this.schedule.set(t, [cmd]);
    }
    this.pending = [];
    this._runCommandsFor(this.tick);
  }

  private _runCommandsFor(tick: number) {
    const cmds = this.schedule
      ? this.schedule.get(tick) ?? []
      : this.pending.splice(0, this.pending.length);
    for (const cmd of cmds) {
      this.apply(cmd);
      this.recorded.push({ t: tick, cmd });
    }
  }

  apply(cmd: Command) {
    switch (cmd.kind) {
      case "setWall":       this._applySetWall(cmd.x, cmd.y, cmd.open); break;
      case "setFood":       this._applySetFood(cmd.x, cmd.y, cmd.amount); break;
      case "setAntCount":   this.setAntCount(cmd.n); break;
      case "setManualAnt":  this._applySetManualAnt(cmd.index); break;
      case "moveManualAnt": this._applyMoveManualAnt(cmd.dx, cmd.dy); break;
      case "setDoctrine":   this._applySetDoctrine(cmd.colony, cmd.doctrine); break;
      case "setAdoption":   this.adoption = cmd.mode; break;
      case "setTopology":   this.topology = cloneTopology(cmd.topology); break;
    }
  }

  private _applySetWall(gx: number, gy: number, open: boolean) {
    if (!inBounds(this.occupancy, gx, gy)) return;
    if (this.colonies.some(c => c.nestX === gx && c.nestY === gy)) return;
    if (this.foodSources.some(s => s.x === gx && s.y === gy)) return;
    this.occupancy.setOpen(gx, gy, open);
    this.gridVersion++;
    if (!open) {
      for (const colony of this.colonies) {
        for (const ant of colony.ants) {
          if (ant.tx === gx && ant.ty === gy) { ant.tx = ant.cx; ant.ty = ant.cy; }
        }
      }
    }
  }

  private _applySetFood(gx: number, gy: number, amount: number) {
    if (!inBounds(this.occupancy, gx, gy)) return;
    if (!this.occupancy.isOpen(gx, gy)) return;
    if (this.colonies.some(c => c.nestX === gx && c.nestY === gy)) return;

    const srcIdx = this.foodSources.findIndex(s => s.x === gx && s.y === gy);
    if (amount <= 0) {
      if (srcIdx < 0) return;
      this.foodSources.splice(srcIdx, 1);
      for (const colony of this.colonies) {
        const updated = new Set<number>();
        for (const idx of colony.discoveredSources) {
          if (idx === srcIdx) continue;
          updated.add(idx > srcIdx ? idx - 1 : idx);
        }
        colony.discoveredSources = updated;
      }
      return;
    }
    if (srcIdx >= 0) {
      this.foodSources[srcIdx].remaining = amount;
      this.foodSources[srcIdx].total = amount;
      return;
    }
    this.foodSources.push({ x: gx, y: gy, remaining: amount, total: amount });
  }

  private _applySetDoctrine(index: number, doctrine: Doctrine) {
    const colony = this.colonies[index];
    if (!colony) return;
    const previous = colony.doctrineVersion;
    const version = previous + 1;
    const copy = cloneDoctrine(doctrine);
    colony.doctrines.set(version, copy);
    colony.doctrineRefs.set(version, 0);
    colony.doctrine = copy;
    colony.doctrineVersion = version;
    if (this.adoption === "instant") {
      colony.ants.forEach((ant, i) => {
        this._adopt(ant, colony);
        ant.role = this._roleFor(colony, i, colony.ants.length);
      });
    }
    // A colony with no ants, or one whose ants all re-stamped, has no holder
    // of the previous version left; _adopt drops it as the last holder leaves,
    // and this covers the case where there was no holder to begin with.
    if ((colony.doctrineRefs.get(previous) ?? 0) <= 0) {
      colony.doctrineRefs.delete(previous);
      colony.doctrines.delete(previous);
    }
  }

  private _applySetManualAnt(index: number | null) {
    const all = this.allAnts;
    for (const ant of all) ant.manual = false;
    this.manualAntIndex = null;
    if (index === null) return;
    const ant = all[index];
    if (!ant) return;
    ant.manual = true;
    this.manualAntIndex = index;
  }

  private _applyMoveManualAnt(dx: number, dy: number) {
    if (this.manualAntIndex === null) return;
    const ant = this.allAnts[this.manualAntIndex];
    if (!ant) return;
    const nx = ant.cx + dx, ny = ant.cy + dy;
    if (!this.occupancy.isOpen(nx, ny)) return;
    ant.prevCx = ant.cx;
    ant.prevCy = ant.cy;
    ant.tx = nx;
    ant.ty = ny;
  }

  step() {
    this.tick++;
    this._runCommandsFor(this.tick);

    for (const colony of this.colonies) {
      colony.field.decay(1 - colony.doctrine.evapRate);
      for (const sub of colony.received.values()) sub.decay(1 - colony.doctrine.evapRate);
      for (let i = 0; i < colony.ants.length; i++) this._moveAnt(colony.ants[i], colony, i);
    }

    if (this.tick % FINGERPRINT_INTERVAL === 0) {
      this.fingerprints.push({ t: this.tick, h: fingerprint(this) });
    }
  }

  private _moveAnt(ant: Ant, colony: Colony, index: number) {
    const { tankMax } = this.params;
    const { px: tpx, py: tpy } = cellCenter(ant.tx, ant.ty);
    const dx = tpx - ant.x, dy = tpy - ant.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > ARRIVE_THRESH) {
      this._lay(ant, colony);
      const scale = V / dist;
      ant.x += dx * scale;
      ant.y += dy * scale;
      return;
    }

    ant.x = tpx; ant.y = tpy;
    ant.cx = ant.tx; ant.cy = ant.ty;
    ant.stepsSinceNest++;

    // Check food sources
    if (ant.state === "searching") {
      const srcIdx = this.foodSources.findIndex(s => s.x === ant.cx && s.y === ant.cy);
      if (srcIdx >= 0) {
        const src = this.foodSources[srcIdx];
        colony.discoveredSources.add(srcIdx);
        if (src.remaining > 0) {
          src.remaining--;
          ant.state = "returning";
          ant.hasFood = true;
          ant.tank = tankMax;
          ant.lastSourceX = src.x;
          ant.lastSourceY = src.y;
          const [ntx, nty] = [ant.prevCx, ant.prevCy];
          ant.prevCx = ant.cx; ant.prevCy = ant.cy;
          ant.tx = ntx; ant.ty = nty;
          return;
        }
        // depleted — fall through, keep searching
      }
    }

    // Check nest
    if (ant.state === "returning" && ant.cx === colony.nestX && ant.cy === colony.nestY) {
      ant.state = "searching";
      this._nestEvent(ant, colony, index);
      ant.hasFood = false;
      ant.tank = tankMax;
      colony.foodCollected++;
      if (ant.lastSourceX !== null && ant.lastSourceY !== null) {
        colony.recentTrips.push({ steps: ant.stepsSinceNest, sx: ant.lastSourceX, sy: ant.lastSourceY });
        if (colony.recentTrips.length > TRIP_WINDOW) colony.recentTrips.shift();
      }
      ant.stepsSinceNest = 0;
      ant.lastSourceX = null;
      ant.lastSourceY = null;
      const [ntx, nty] = [ant.prevCx, ant.prevCy];
      ant.prevCx = ant.cx; ant.prevCy = ant.cy;
      ant.tx = ntx; ant.ty = nty;
      return;
    }

    if (ant.manual) {
      ant.tx = ant.cx; ant.ty = ant.cy;
      return;
    }

    const noBack = openNeighbours(this.occupancy, ant.cx, ant.cy, ant.prevCx, ant.prevCy);
    const candidates = noBack.length > 0 ? noBack : openNeighbours(this.occupancy, ant.cx, ant.cy);
    // An edit can seal every exit from a cell an ant is standing in, which
    // applySetWall permits: it refuses only nest and food cells. The ant waits
    // where it is until something opens up. The server simulation has always
    // had this guard; the client did not, and chooseNext returns undefined on
    // an empty list.
    if (candidates.length === 0) return;

    const table = this.doctrineFor(ant, colony)[ant.role];
    const next = chooseNext(this, colony, table, ant.state, candidates, this.antsRng);

    ant.prevCx = ant.cx; ant.prevCy = ant.cy;
    ant.tx = next[0]; ant.ty = next[1];
  }
}

/** Total pheromone other colonies have laid into this one, across every sublayer and channel. */
export function mimicMassReceived(colony: Colony): number {
  let mass = 0;
  for (const sub of colony.received.values()) {
    for (const layer of sub.layers()) for (let i = 0; i < layer.length; i++) mass += layer[i];
  }
  return mass;
}
