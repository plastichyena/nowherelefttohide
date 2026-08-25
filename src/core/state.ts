import { assertValidGameConfig, cloneConfig } from './config';
import { hexKey } from './hex';
import { createFixedMap } from './map';
import { SeededRng } from './rng';
import type {
  CardinalDirection,
  CheckpointState,
  FacilityState,
  GameConfig,
  GameState,
  HexCoord,
  InitialFacilityPopulationConfig,
  HumanUnitType,
  UnitState,
  UnitType,
} from './types';

export const GAME_VERSION = '1.0.0';

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function positionKey(position: HexCoord): string {
  return hexKey(position);
}

export function getFacilityState(state: GameState, facilityId: string): FacilityState | undefined {
  return state.facilities.find((facility) => facility.id === facilityId);
}

export function getCheckpointAt(state: GameState, position: HexCoord): CheckpointState | undefined {
  const key = positionKey(position);
  return state.checkpoints.find((checkpoint) => positionKey(checkpoint.position) === key);
}

export function getUnit(state: GameState, unitId: string): UnitState | undefined {
  return state.units.find((unit) => unit.id === unitId);
}

export function getUnitAt(state: GameState, position: HexCoord): UnitState | undefined {
  const key = positionKey(position);
  return state.units.find((unit) => positionKey(unit.position) === key);
}

export function isHumanUnit(unit: UnitState): boolean {
  return unit.type === 'police' || unit.type === 'nationalGuard';
}

export function createUnit(
  state: Pick<GameState, 'config'>,
  id: string,
  type: UnitType,
  position: HexCoord,
  actionState: UnitState['actionState'] = 'ready',
): UnitState {
  const stats = state.config.units[type];
  return {
    id,
    type,
    position: { ...position },
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack,
    movement: stats.movement,
    range: stats.range,
    population: stats.population,
    actionState,
    canAttack: true,
    canMove: type !== 'zombie',
    isPlayerUnit: type !== 'zombie',
    activity: { moved: false, attacked: false, intercepted: false, suppressed: false },
  };
}

/** Keep all denormalized population information in sync after a state change. */
export function synchronizePopulation(state: GameState): void {
  const employed = state.facilities.reduce(
    (total, facility) => total + (facility.owner === 'player' ? facility.workers : 0),
    0,
  );
  const facilityInfected = state.facilities.reduce((total, facility) => total + facility.infected, 0);
  const police = state.units
    .filter((unit) => unit.type === 'police')
    .reduce((total, unit) => total + unit.population, 0);
  const nationalGuard = state.units
    .filter((unit) => unit.type === 'nationalGuard')
    .reduce((total, unit) => total + unit.population, 0);
  const waiting = state.checkpoints.reduce((total, checkpoint) => total + checkpoint.waiting, 0);
  const screening = state.checkpoints.reduce((total, checkpoint) => total + checkpoint.screening, 0);

  state.population.employed = employed;
  state.population.police = police;
  state.population.nationalGuard = nationalGuard;
  state.population.unitPopulation = police + nationalGuard;
  state.population.waitingRefugees = waiting;
  state.population.screeningRefugees = screening;
  state.population.facilityInfected = facilityInfected;
  state.population.facilityWorkers = state.facilities
    .filter((facility) => facility.owner === 'player')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((facility) => ({ facilityId: facility.id, workers: facility.workers }));

  const civilianPopulation = employed + state.population.unemployed;
  state.statistics.maxPopulation = Math.max(state.statistics.maxPopulation, civilianPopulation + police + nationalGuard);
  state.statistics.maxSecuredFacilities = Math.max(
    state.statistics.maxSecuredFacilities,
    state.facilities.filter((facility) => facility.owner === 'player' && facility.status === 'owned').length,
  );
}

export function civilianWorkerCount(state: GameState): number {
  return state.population.employed + state.population.unemployed;
}

export function resourceConsumerPopulation(state: GameState): number {
  return civilianWorkerCount(state) + state.population.unitPopulation;
}

function facilityStateFromDefinition(
  definition: GameState['map']['facilities'][number],
  config: GameConfig,
  securedOrder: number | null,
  rng: SeededRng,
): FacilityState {
  const owned = definition.startingOwned;
  const workerCapacity = config.facilities[definition.type].workerCapacity;
  const populationConfig = config.initialFacilityPopulation[definition.id];
  const { workers: configuredWorkers, infected } = resolveInitialFacilityPopulation(
    definition,
    config,
    populationConfig,
    rng,
  );
  if (configuredWorkers + infected > workerCapacity) {
    throw new Error(`Initial workers exceed capacity for ${definition.id}`);
  }
  return {
    ...definition,
    workerCapacity,
    owner: owned ? 'player' : 'none',
    status: owned ? 'owned' : 'unowned',
    // Disconnected facilities may have isolated survivors or an outbreak.
    // They do not enter the player's economy until captured, but they are
    // still real map population and can be infected/overrun deterministically.
    operationalStatus: infected > 0 ? 'infected' : owned && configuredWorkers > 0 ? 'operational' : 'stopped',
    workers: configuredWorkers,
    infected,
    securedOrder,
    lastAssignedOrder: securedOrder ?? 0,
  };
}

function resolveInitialPopulationValue(
  fixed: number | null,
  range: InitialFacilityPopulationConfig['survivorRange'],
  fallback: number,
  rng: SeededRng,
): number {
  if (range) return rng.nextInt(range.min, range.max);
  return fixed ?? fallback;
}

function resolveInitialFacilityPopulation(
  definition: GameState['map']['facilities'][number],
  config: GameConfig,
  populationConfig: InitialFacilityPopulationConfig,
  rng: SeededRng,
): { workers: number; infected: number } {
  const legacyWorkers = config.economy.initialWorkersByFacility[definition.id] ?? definition.startingWorkers;
  return {
    workers: resolveInitialPopulationValue(
      populationConfig.survivors,
      populationConfig.survivorRange,
      legacyWorkers,
      rng,
    ),
    infected: resolveInitialPopulationValue(
      populationConfig.infected,
      populationConfig.infectedRange,
      definition.startingInfected,
      rng,
    ),
  };
}

function directionFromRng(rng: SeededRng): CardinalDirection {
  return rng.pick(['north', 'east', 'south', 'west'] as const);
}

/**
 * Create the complete, JSON-compatible state used by UI, tests and headless
 * play.  The supplied Config is copied so option changes cannot alter a game
 * that is already in progress.
 */
export function createInitialState(seed: number, config: GameConfig): GameState {
  assertValidGameConfig(config);
  if (config.mapId !== 'fixed-15x15-v1') {
    throw new Error(`Unsupported map id: ${config.mapId}`);
  }
  if (!Number.isSafeInteger(seed)) {
    throw new Error('Seed must be a safe integer');
  }

  const stateConfig = cloneConfig(config);
  const map = createFixedMap();
  const rng = new SeededRng(seed);
  let securedOrder = 0;
  const facilities = map.facilities.map((definition) =>
    facilityStateFromDefinition(
      definition,
      stateConfig,
      definition.startingOwned ? securedOrder++ : null,
      rng,
    ),
  );

  const resources = stateConfig.economy.initialResources;
  const state: GameState = {
    gameVersion: GAME_VERSION,
    config: stateConfig,
    seed,
    rngState: rng.snapshot(),
    turn: 1,
    maxTurns: stateConfig.maxTurns,
    actionsTakenThisTurn: 0,
    phase: 'player',
    mapId: map.id,
    map,
    facilities,
    population: {
      employed: 0,
      unemployed: stateConfig.economy.initialUnemployed,
      police: 0,
      nationalGuard: 0,
      unitPopulation: 0,
      facilityWorkers: [],
      waitingRefugees: 0,
      screeningRefugees: 0,
      facilityInfected: 0,
    },
    resources: {
      food: resources.food,
      civilianGoods: resources.civilianGoods,
      militaryGoods: resources.militaryGoods,
      fuel: resources.fuel,
      electricityCapacity: 0,
      electricityRequired: 0,
      militarySupplyAvailable: true,
    },
    units: [
      createUnit({ config: stateConfig }, 'police-1', 'police', { q: 7, r: 7 }),
      createUnit({ config: stateConfig }, 'national-guard-1', 'nationalGuard', { q: 8, r: 7 }),
      ...map.initialZombiePositions.slice(0, stateConfig.economy.initialZombieCount).map((position, index) =>
        createUnit({ config: stateConfig }, `zombie-${index + 1}`, 'zombie', position),
      ),
    ],
    checkpoints: [],
    pendingAdmissions: [],
    pendingUnitProductions: [],
    nextUnitNumber: 2,
    nextEventNumber: 1,
    nextAssignmentOrder: securedOrder + 1,
    horde: {
      spawnedCount: 0,
      totalSpawned: 0,
      nextDirection: directionFromRng(rng),
      turnsRemaining: stateConfig.horde.cycle,
      nextSpawnTurn: stateConfig.horde.cycle,
      lastSpawnTurn: null,
    },
    events: [],
    statistics: {
      maxPopulation: 0,
      maxSecuredFacilities: 0,
      civilianLosses: 0,
      unitLosses: 0,
      infectionLosses: 0,
      resourceShortageLosses: 0,
      hordeInterceptions: 0,
    },
    gameOver: false,
    result: null,
  };
  synchronizePopulation(state);
  return state;
}

export function nextHumanUnitId(state: GameState, type: HumanUnitType): string {
  const prefix = type === 'police' ? 'police' : 'national-guard';
  const id = `${prefix}-${state.nextUnitNumber}`;
  state.nextUnitNumber += 1;
  return id;
}
