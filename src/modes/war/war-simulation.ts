import {
  ARRIVE_THRESH,
  CELL,
  COLS,
  DEFAULT_PARAMS,
  DenseField,
  Simulation,
  generateMasterSeed,
  makeRng,
  makeSeeds,
  ROWS,
  type Ant,
  type Colony,
  type RunConfig,
  type SimParams,
} from "@stigsim/sim-core";
import {
  DEFAULT_WAR_DOCTRINE,
  copyWarDoctrine,
  type WarDoctrine,
} from "../../../shared/war-doctrine";
export { DEFAULT_WAR_DOCTRINE } from "../../../shared/war-doctrine";
export type { WarDoctrine } from "../../../shared/war-doctrine";

export type WarAntPhase = "searching" | "returning" | "retreating" | "waiting";
export type WarAntRole = "forager" | "spoiler";

export interface WarRules {
  maxEnergy: number;
  retreatEnergy: number;
  minDepartEnergy: number;
  moveEnergyCost: number;
  waitEnergyCost: number;
  energyPerFood: number;
  foodDeliveryValue: number;
  startingReservePerAnt: number;
  reproductionCost: number;
  reproductionCheckSteps: number;
  hatchSteps: number;
  safetyReservePerAnt: number;
  emergencyPopulationLimit: number;
}

export const WAR_RULES: Readonly<WarRules> = {
  maxEnergy: 1600,
  retreatEnergy: 560,
  minDepartEnergy: 1120,
  moveEnergyCost: 1,
  waitEnergyCost: 0.25,
  energyPerFood: 100,
  foodDeliveryValue: 20,
  startingReservePerAnt: 6,
  reproductionCost: 60,
  reproductionCheckSteps: 30,
  hatchSteps: 300,
  safetyReservePerAnt: 4,
  emergencyPopulationLimit: 10_000,
};

export interface WarMatchSettings {
  masterSeed: string;
  startingAnts: number;
  loopRate: number;
  foodSources: number;
  foodPerSource: number;
}

export const DEFAULT_WAR_SETTINGS: WarMatchSettings = {
  masterSeed: "",
  startingAnts: 20,
  loopRate: 0.1,
  foodSources: 1,
  foodPerSource: 500,
};

interface AntRuntime {
  id: number;
  phase: WarAntPhase;
  energy: number;
  doctrine: WarDoctrine;
  doctrineVersion: number;
  role: WarAntRole;
  departure: [number, number] | null;
}

interface ColonyRuntime {
  pendingDoctrine: WarDoctrine;
  doctrineVersion: number;
  foodReserve: number;
  developingAnts: number[];
  reproductionClock: number;
  births: number;
  deaths: number;
  doctrineChanged: boolean;
  mimicDeposited: number;
}

export interface WarAntSnapshot {
  id: number;
  phase: WarAntPhase;
  energy: number;
  doctrine: WarDoctrine;
  doctrineVersion: number;
  role: WarAntRole;
}

export interface WarColonyMetrics {
  population: number;
  foodCollected: number;
  reserve: number;
  hatching: number;
  searching: number;
  carrying: number;
  retreating: number;
  waiting: number;
  lowEnergy: number;
  births: number;
  deaths: number;
  doctrineChanged: boolean;
  doctrineAdopted: number;
  spoilers: number;
  mimicDeposited: number;
}

export type WarResult = number | "draw" | null;

export class WarSimulation {
  readonly simulation: Simulation;
  readonly rules: WarRules;
  readonly settings: WarMatchSettings;
  private readonly antRuntime = new Map<Ant, AntRuntime>();
  private readonly colonyRuntime: ColonyRuntime[];
  private readonly economyRng: ReturnType<typeof makeRng>;
  private readonly mimicProvenance: DenseField[];
  private nextAntId = 0;
  result: WarResult = null;

  constructor(
    settings: Partial<WarMatchSettings> = {},
    doctrines: Array<SimParams | WarDoctrine> = [DEFAULT_WAR_DOCTRINE, DEFAULT_WAR_DOCTRINE],
    ruleOverrides: Partial<WarRules> = {},
  ) {
    this.settings = {
      ...DEFAULT_WAR_SETTINGS,
      ...settings,
      masterSeed: settings.masterSeed || generateMasterSeed(),
    };
    this.rules = { ...WAR_RULES, ...ruleOverrides };
    this.colonyRuntime = [0, 1].map(colonyId => ({
      pendingDoctrine: copyWarDoctrine(doctrines[colonyId] ?? DEFAULT_PARAMS),
      doctrineVersion: 0,
      foodReserve: this.settings.startingAnts * this.rules.startingReservePerAnt,
      developingAnts: [],
      reproductionClock: 0,
      births: 0,
      deaths: 0,
      doctrineChanged: false,
      mimicDeposited: 0,
    }));

    const config: RunConfig = {
      seeds: makeSeeds(this.settings.masterSeed),
      numAnts: this.settings.startingAnts,
      params: { ...DEFAULT_PARAMS },
      loopRate: this.settings.loopRate,
      numColonies: 2,
      numFoodSources: this.settings.foodSources,
      foodPerSource: this.settings.foodPerSource,
    };
    this.economyRng = makeRng(`${config.seeds.ants}:war-survival`);
    this.mimicProvenance = [0, 1].map(() => new DenseField(COLS, ROWS));
    this.simulation = new Simulation(config, {
      policy: {
        paramsForAnt: ant => this.antRuntime.get(ant)?.doctrine
          ?? this.colonyRuntime[ant.colonyId].pendingDoctrine,
        evapRateForColony: colony => this.averageEvaporation(colony),
        navigationForAnt: (ant, colony, defaults) => {
          const runtime = this.antRuntime.get(ant);
          if (runtime?.role !== "spoiler" || ant.state !== "searching") return defaults;
          const opponent = this.simulation.colonies[1 - colony.id];
          return opponent ? { field: opponent.field, channel: "home" } : defaults;
        },
        depositForAnt: (ant, colony, defaults) => {
          const runtime = this.antRuntime.get(ant);
          if (runtime?.role !== "spoiler" || ant.state !== "searching") {
            defaults.field.add(defaults.channel, ant.cx, ant.cy, defaults.amount);
            return defaults.amount;
          }
          const opponent = this.simulation.colonies[1 - colony.id];
          if (!opponent) return 0;
          const amount = defaults.amount * runtime.doctrine.mimicRate;
          opponent.field.add("food", ant.cx, ant.cy, amount);
          this.mimicProvenance[colony.id].add("food", ant.cx, ant.cy, amount);
          this.colonyRuntime[colony.id].mimicDeposited += amount;
          return amount;
        },
      },
    });
    for (const colony of this.simulation.colonies) {
      for (const ant of colony.ants) this.registerAnt(ant, colony.id);
    }
  }

  setDoctrine(colonyId: number, doctrine: SimParams | WarDoctrine): void {
    const state = this.colonyRuntime[colonyId];
    if (!state) return;
    state.pendingDoctrine = copyWarDoctrine(doctrine);
    state.doctrineVersion++;
    state.doctrineChanged = true;
  }

  getDoctrine(colonyId: number): WarDoctrine {
    return copyWarDoctrine(this.colonyRuntime[colonyId].pendingDoctrine);
  }

  getAntSnapshot(ant: Ant): WarAntSnapshot | null {
    const state = this.antRuntime.get(ant);
    return state ? {
      id: state.id,
      phase: state.phase,
      energy: state.energy,
      doctrine: copyWarDoctrine(state.doctrine),
      doctrineVersion: state.doctrineVersion,
      role: state.role,
    } : null;
  }

  getMetrics(colonyId: number): WarColonyMetrics {
    const colony = this.simulation.colonies[colonyId];
    const state = this.colonyRuntime[colonyId];
    const ants = colony.ants.map(ant => this.antRuntime.get(ant)!).filter(Boolean);
    const doctrineAdopted = ants.filter(ant => ant.doctrineVersion === state.doctrineVersion).length;
    return {
      population: colony.ants.length,
      foodCollected: colony.foodCollected,
      reserve: state.foodReserve,
      hatching: state.developingAnts.length,
      searching: ants.filter(ant => ant.phase === "searching").length,
      carrying: ants.filter(ant => ant.phase === "returning").length,
      retreating: ants.filter(ant => ant.phase === "retreating").length,
      waiting: ants.filter(ant => ant.phase === "waiting").length,
      lowEnergy: ants.filter(ant => ant.energy <= this.rules.retreatEnergy).length,
      births: state.births,
      deaths: state.deaths,
      doctrineChanged: state.doctrineChanged && doctrineAdopted < colony.ants.length,
      doctrineAdopted,
      spoilers: ants.filter(ant => ant.role === "spoiler").length,
      mimicDeposited: state.mimicDeposited,
    };
  }

  getMimicLayer(colonyId: number): Float32Array {
    return this.mimicProvenance[colonyId].layer("food");
  }

  step(): void {
    if (this.result !== null) return;
    const deliveriesBefore = this.simulation.colonies.map(colony => colony.foodCollected);

    for (const colony of this.simulation.colonies) {
      const target = this.simulation.colonies[1 - colony.id];
      const targetRate = target ? this.averageEvaporation(target) : DEFAULT_PARAMS.evapRate;
      this.mimicProvenance[colony.id].decay(1 - targetRate);
    }

    for (const colony of this.simulation.colonies) {
      this.prepareColony(colony);
    }

    this.simulation.step();

    for (const colony of this.simulation.colonies) {
      const colonyState = this.colonyRuntime[colony.id];
      colonyState.foodReserve += (colony.foodCollected - deliveriesBefore[colony.id]) * this.rules.foodDeliveryValue;
      this.finishColony(colony);
      this.advanceEconomy(colony);
    }

    const survivors = this.simulation.colonies.filter((colony, id) =>
      colony.ants.length > 0 || this.colonyRuntime[id].developingAnts.length > 0
    );
    if (survivors.length <= 1) this.result = survivors.length === 1 ? survivors[0].id : "draw";
  }

  private registerAnt(ant: Ant, colonyId: number): void {
    const colony = this.colonyRuntime[colonyId];
    const doctrine = copyWarDoctrine(colony.pendingDoctrine);
    ant.tank = doctrine.tankMax;
    this.antRuntime.set(ant, {
      id: this.nextAntId++,
      phase: "searching",
      energy: this.rules.maxEnergy,
      doctrine,
      doctrineVersion: colony.doctrineVersion,
      role: this.roleForAnt(ant, colonyId, doctrine),
      departure: null,
    });
  }

  private roleForAnt(ant: Ant, colonyId: number, doctrine: WarDoctrine): WarAntRole {
    const ants = this.simulation?.colonies[colonyId]?.ants ?? [];
    const index = ants.indexOf(ant);
    return index >= 0 && index < Math.floor(doctrine.spoilerFraction * ants.length)
      ? "spoiler"
      : "forager";
  }

  private averageEvaporation(colony: Colony): number {
    if (colony.ants.length === 0) return this.colonyRuntime[colony.id].pendingDoctrine.evapRate;
    let total = 0;
    for (const ant of colony.ants) {
      total += this.antRuntime.get(ant)?.doctrine.evapRate
        ?? this.colonyRuntime[colony.id].pendingDoctrine.evapRate;
    }
    return total / colony.ants.length;
  }

  private prepareColony(colony: Colony): void {
    const dead = new Set<Ant>();
    for (const ant of colony.ants) {
      const state = this.antRuntime.get(ant)!;
      if (state.phase === "waiting") {
        state.energy -= this.rules.waitEnergyCost;
        if (state.energy <= 0) {
          dead.add(ant);
          continue;
        }
        this.adoptDoctrine(ant, state, colony.id);
        this.refuelAtNest(ant, state, colony.id);
        continue;
      }

      if (state.phase === "searching"
          && state.departure
          && ant.cx === colony.nestX
          && ant.cy === colony.nestY
          && ant.tx === colony.nestX
          && ant.ty === colony.nestY) {
        [ant.tx, ant.ty] = state.departure;
        state.departure = null;
      }

      const targetX = ant.tx * CELL + CELL / 2;
      const targetY = ant.ty * CELL + CELL / 2;
      const dx = targetX - ant.x;
      const dy = targetY - ant.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > ARRIVE_THRESH) state.energy -= this.rules.moveEnergyCost;
      if (state.energy <= 0) {
        dead.add(ant);
        continue;
      }
      // Intentionally react as soon as this step reaches the threshold. The
      // prototype checked before charging movement and therefore sent the ant
      // one extra step away from safety; that timing was incidental, not a
      // designed survival rule.
      if (state.phase === "searching" && state.energy <= this.rules.retreatEnergy) {
        state.phase = "retreating";
        ant.state = "returning";
        ant.hasFood = false;
      }
    }
    this.removeDead(colony, dead);
  }

  private finishColony(colony: Colony): void {
    for (const ant of colony.ants) {
      const state = this.antRuntime.get(ant)!;
      if (state.phase === "searching" && ant.state === "returning" && ant.hasFood) {
        state.phase = "returning";
      }
      if ((state.phase === "returning" || state.phase === "retreating")
          && ant.state === "searching"
          && ant.cx === colony.nestX && ant.cy === colony.nestY) {
        state.departure = [ant.tx, ant.ty];
        this.adoptDoctrine(ant, state, colony.id);
        this.refuelAtNest(ant, state, colony.id);
      }
    }
  }

  private adoptDoctrine(ant: Ant, state: AntRuntime, colonyId: number): void {
    const colony = this.colonyRuntime[colonyId];
    if (state.doctrineVersion === colony.doctrineVersion) return;
    state.doctrine = copyWarDoctrine(colony.pendingDoctrine);
    state.doctrineVersion = colony.doctrineVersion;
    state.role = this.roleForAnt(ant, colonyId, state.doctrine);
  }

  private refuelAtNest(ant: Ant, state: AntRuntime, colonyId: number): void {
    const colony = this.colonyRuntime[colonyId];
    const needed = Math.max(0, this.rules.maxEnergy - state.energy);
    const availableFood = Math.max(0, colony.foodReserve);
    const availableEnergy = availableFood === 0 ? 0 : availableFood * this.rules.energyPerFood;
    const supplied = Math.max(0, Math.min(needed, availableEnergy));
    state.energy += supplied;
    const foodSpent = this.rules.energyPerFood > 0 ? supplied / this.rules.energyPerFood : 0;
    colony.foodReserve = Math.max(0, colony.foodReserve - foodSpent);
    ant.hasFood = false;
    ant.tank = state.doctrine.tankMax;

    if (state.energy >= this.rules.minDepartEnergy) {
      state.phase = "searching";
      ant.state = "searching";
      ant.manual = false;
      return;
    }

    state.phase = "waiting";
    ant.state = "searching";
    ant.manual = true;
    ant.tx = this.simulation.colonies[colonyId].nestX;
    ant.ty = this.simulation.colonies[colonyId].nestY;
  }

  private removeDead(colony: Colony, dead: Set<Ant>): void {
    if (dead.size === 0) return;
    const state = this.colonyRuntime[colony.id];
    colony.ants = colony.ants.filter(ant => {
      if (!dead.has(ant)) return true;
      this.antRuntime.delete(ant);
      state.deaths++;
      return false;
    });
  }

  private advanceEconomy(colony: Colony): void {
    const state = this.colonyRuntime[colony.id];
    const ready = state.developingAnts.map(ticks => ticks - 1).filter(ticks => ticks <= 0).length;
    state.developingAnts = state.developingAnts.map(ticks => ticks - 1).filter(ticks => ticks > 0);
    const hatchCapacity = Math.max(0,
      this.rules.emergencyPopulationLimit - colony.ants.length - state.developingAnts.length
    );
    for (let i = 0; i < Math.min(ready, hatchCapacity); i++) {
      const ant = this.simulation.spawnAnt(colony.id);
      if (ant) {
        this.registerAnt(ant, colony.id);
        state.births++;
      }
    }

    state.reproductionClock++;
    if (state.reproductionClock < this.rules.reproductionCheckSteps || colony.ants.length === 0) return;
    state.reproductionClock = 0;

    const safetyReserve = colony.ants.length * this.rules.safetyReservePerAnt;
    const affordable = Math.max(0, Math.floor((state.foodReserve - safetyReserve) / this.rules.reproductionCost));
    const capacity = Math.max(0,
      this.rules.emergencyPopulationLimit - colony.ants.length - state.developingAnts.length
    );
    const toDevelop = Math.min(affordable, capacity);
    for (let i = 0; i < toDevelop; i++) {
      state.foodReserve -= this.rules.reproductionCost;
      const stagger = Math.floor(this.economyRng() * this.rules.reproductionCheckSteps);
      state.developingAnts.push(this.rules.hatchSteps + stagger);
    }
  }
}
