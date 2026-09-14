import {
  ARRIVE_THRESH,
  CELL,
  DEFAULT_DOCTRINE,
  DEFAULT_PARAMS,
  DEFAULT_TOPOLOGY,
  Simulation,
  cloneDoctrine,
  cloneTopology,
  generateMasterSeed,
  makeRng,
  makeSeeds,
  type Ant,
  type Colony,
  type Doctrine,
  type RunConfig,
  type Topology,
} from "@stigsim/sim-core";

export type WarAntPhase = "searching" | "returning" | "retreating" | "waiting";

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
  tankMax: number;
  topology: Topology;
}

export const DEFAULT_WAR_SETTINGS: WarMatchSettings = {
  masterSeed: "",
  startingAnts: 20,
  loopRate: 0.1,
  foodSources: 1,
  foodPerSource: 500,
  tankMax: DEFAULT_PARAMS.tankMax,
  topology: cloneTopology(DEFAULT_TOPOLOGY),
};

interface AntRuntime {
  id: number;
  phase: WarAntPhase;
  energy: number;
  departure: [number, number] | null;
}

interface ColonyRuntime {
  foodReserve: number;
  developingAnts: number[];
  reproductionClock: number;
  births: number;
  deaths: number;
  doctrineChanged: boolean;
}

export interface WarAntSnapshot {
  id: number;
  phase: WarAntPhase;
  energy: number;
  role: Ant["role"];
  doctrineVersion: number;
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
}

export type WarResult = number | "draw" | null;

export class WarSimulation {
  readonly simulation: Simulation;
  readonly rules: WarRules;
  readonly settings: WarMatchSettings;
  private readonly antRuntime = new Map<Ant, AntRuntime>();
  private readonly colonyRuntime: ColonyRuntime[];
  private readonly economyRng: ReturnType<typeof makeRng>;
  private nextAntId = 0;
  result: WarResult = null;

  constructor(
    settings: Partial<WarMatchSettings> = {},
    doctrines: Doctrine[] = [DEFAULT_DOCTRINE, DEFAULT_DOCTRINE],
    ruleOverrides: Partial<WarRules> = {},
  ) {
    this.settings = {
      ...DEFAULT_WAR_SETTINGS,
      ...settings,
      masterSeed: settings.masterSeed || generateMasterSeed(),
      topology: cloneTopology(settings.topology ?? DEFAULT_WAR_SETTINGS.topology),
    };
    this.rules = { ...WAR_RULES, ...ruleOverrides };
    this.colonyRuntime = [0, 1].map(colonyId => ({
      foodReserve: this.settings.startingAnts * this.rules.startingReservePerAnt,
      developingAnts: [],
      reproductionClock: 0,
      births: 0,
      deaths: 0,
      doctrineChanged: false,
    }));

    const config: RunConfig = {
      seeds: makeSeeds(this.settings.masterSeed),
      numAnts: this.settings.startingAnts,
      params: { tankMax: this.settings.tankMax },
      loopRate: this.settings.loopRate,
      numColonies: 2,
      numFoodSources: this.settings.foodSources,
      foodPerSource: this.settings.foodPerSource,
    };
    this.economyRng = makeRng(`${config.seeds.ants}:war-survival`);
    this.simulation = new Simulation(config, {
      doctrines,
      topology: this.settings.topology,
      adoption: "nest",
    });
    for (const colony of this.simulation.colonies) {
      for (const ant of colony.ants) this.registerAnt(ant, colony.id);
    }
  }

  setDoctrine(colonyId: number, doctrine: Doctrine): void {
    const state = this.colonyRuntime[colonyId];
    if (!state) return;
    state.doctrineChanged = true;
    this.simulation.setColonyDoctrine(colonyId, doctrine);
  }

  getDoctrine(colonyId: number): Doctrine {
    return cloneDoctrine(this.simulation.colonies[colonyId].doctrine);
  }

  getFullDoctrine(colonyId: number): Doctrine {
    return this.getDoctrine(colonyId);
  }

  getAntSnapshot(ant: Ant): WarAntSnapshot | null {
    const state = this.antRuntime.get(ant);
    return state ? {
      id: state.id,
      phase: state.phase,
      energy: state.energy,
      role: ant.role,
      doctrineVersion: ant.doctrineVersion,
    } : null;
  }

  getMetrics(colonyId: number): WarColonyMetrics {
    const colony = this.simulation.colonies[colonyId];
    const state = this.colonyRuntime[colonyId];
    const ants = colony.ants.map(ant => this.antRuntime.get(ant)!).filter(Boolean);
    const doctrineAdopted = colony.ants.filter(ant => ant.doctrineVersion === colony.doctrineVersion).length;
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
    };
  }

  step(): void {
    if (this.result !== null) return;
    const deliveriesBefore = this.simulation.colonies.map(colony => colony.foodCollected);

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
    ant.tank = this.simulation.params.tankMax;
    this.antRuntime.set(ant, {
      id: this.nextAntId++,
      phase: "searching",
      energy: this.rules.maxEnergy,
      departure: null,
    });
  }

  private prepareColony(colony: Colony): void {
    const dead = new Set<Ant>();
    for (const [index, ant] of colony.ants.entries()) {
      const state = this.antRuntime.get(ant)!;
      if (state.phase === "waiting") {
        state.energy -= this.rules.waitEnergyCost;
        if (state.energy <= 0) {
          dead.add(ant);
          continue;
        }
        this.simulation.adoptAntAtNest(ant, index);
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
    for (const [index, ant] of colony.ants.entries()) {
      const state = this.antRuntime.get(ant)!;
      if (state.phase === "searching" && ant.state === "returning" && ant.hasFood) {
        state.phase = "returning";
      }
      if ((state.phase === "returning" || state.phase === "retreating")
          && ant.state === "searching"
          && ant.cx === colony.nestX && ant.cy === colony.nestY) {
        state.departure = [ant.tx, ant.ty];
        this.simulation.adoptAntAtNest(ant, index);
        this.refuelAtNest(ant, state, colony.id);
      }
    }
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
    ant.tank = this.simulation.params.tankMax;

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
    for (const ant of dead) {
      this.antRuntime.delete(ant);
      state.deaths++;
    }
    this.simulation.removeAnts(colony.id, ant => dead.has(ant));
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
