import { assertValidGameConfig, cloneConfig } from './config';
import { hexKey } from './hex';
import {
  createFixedMap,
  FIXED_INITIAL_UNIT_POSITIONS,
  FIXED_MAP_ID,
  generateInitialZombiePositions,
} from './map';
import { SeededRng } from './rng';
import { getBranchSupplyRadius, isHexSupplied } from './supply';
import { getPlayerVisionCoverage, getVisibleEnemyUnits } from './visibility';
import type {
  CardinalDirection,
  CheckpointState,
  FacilityState,
  GameConfig,
  GameState,
  HexCoord,
  InitialFacilityPopulationConfig,
  HumanUnitType,
  RejectedRefugeeCounters,
  UnitState,
  UnitType,
} from './types';

export const GAME_VERSION = '2.4.0';

const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];

function emptyRejectedRefugeeCounters(): RejectedRefugeeCounters {
  return { normalRejected: 0, strictRejected: 0, turnedAway: 0 };
}

function emptyRejectedRefugeeCounterByDirection(): Record<CardinalDirection, RejectedRefugeeCounters> {
  return Object.fromEntries(
    CARDINAL_DIRECTIONS.map((direction) => [direction, emptyRejectedRefugeeCounters()]),
  ) as Record<CardinalDirection, RejectedRefugeeCounters>;
}

function emptyDirectionValues<T>(factory: () => T): Record<CardinalDirection, T> {
  return Object.fromEntries(
    CARDINAL_DIRECTIONS.map((direction) => [direction, factory()]),
  ) as Record<CardinalDirection, T>;
}

export function isCityFacility(facility: Pick<FacilityState, 'type'>): boolean {
  return facility.type === 'capital' || facility.type === 'city';
}

export function isProductionFacility(facility: Pick<FacilityState, 'type'>): boolean {
  return ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'powerPlant', 'simpleFarm', 'civilianDroneBase']
    .includes(facility.type);
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function positionKey(position: HexCoord): string {
  return hexKey(position);
}

export function getFacilityState(state: GameState, facilityId: string): FacilityState | undefined {
  return state.facilities.find((facility) => facility.id === facilityId);
}

export function getFacilityAt(state: Pick<GameState, 'facilities'>, position: HexCoord): FacilityState | undefined {
  const key = positionKey(position);
  return state.facilities.find((facility) => positionKey(facility.position) === key);
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

export function isZombieUnit(unit: Pick<UnitState, 'type'>): boolean {
  return unit.type === 'zombie'
    || unit.type === 'hordeZombie'
    || unit.type === 'policeZombie'
    || unit.type === 'soldierZombie';
}

export function facilityZombieTargetValue(
  state: Pick<GameState, 'config'>,
  facility: Readonly<FacilityState>,
): number {
  if (facility.type === 'windPowerPlant') return state.config.facilities.windPowerPlant.zombieTargetValue;
  return facility.workers;
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
    vision: stats.vision,
    population: stats.population,
    currentFuel: type === 'police' || type === 'nationalGuard' ? stats.maxFuel : 0,
    maxFuel: stats.maxFuel,
    currentMilitaryGoods: type === 'police' || type === 'nationalGuard' ? stats.maxMilitaryGoods : 0,
    maxMilitaryGoods: stats.maxMilitaryGoods,
    actionState,
    canAttack: true,
    canMove: !isZombieUnit({ type }),
    isPlayerUnit: !isZombieUnit({ type }),
    inheritedTarget: null,
    noiseTarget: null,
    spawnGroupId: null,
    hordeKind: null,
    activity: { moved: false, attacked: false, intercepted: false, suppressed: false },
  };
}

/** Keep all denormalized population information in sync after a state change. */
export function synchronizePopulation(state: GameState): void {
  const ownedHealthy = state.facilities.filter((facility) => facility.owner === 'player');
  const cityResidents = ownedHealthy
    .filter(isCityFacility)
    .reduce((total, facility) => total + facility.workers, 0);
  const productionWorkers = ownedHealthy
    .filter(isProductionFacility)
    .reduce((total, facility) => total + facility.workers, 0);
  const facilityInfected = state.facilities.reduce((total, facility) => total + facility.infected, 0);
  const police = state.units
    .filter((unit) => unit.type === 'police')
    .reduce((total, unit) => total + unit.population, 0) +
    state.pendingUnitProductions
      .filter((order) => order.unitType === 'police')
      .reduce((total, order) => total + order.population, 0);
  const nationalGuard = state.units
    .filter((unit) => unit.type === 'nationalGuard')
    .reduce((total, unit) => total + unit.population, 0) +
    state.pendingUnitProductions
      .filter((order) => order.unitType === 'nationalGuard')
      .reduce((total, order) => total + order.population, 0);
  const waiting = state.checkpoints.reduce((total, checkpoint) => total + checkpoint.waiting, 0);
  const screening = state.checkpoints.reduce((total, checkpoint) => total + checkpoint.screening, 0);
  const approved = state.checkpoints.reduce((total, checkpoint) => total + checkpoint.approved, 0);
  const checkpointInfected = state.checkpoints.reduce((total, checkpoint) => total + checkpoint.infected, 0);

  state.population.cityResidents = cityResidents;
  state.population.productionWorkers = productionWorkers;
  state.population.healthyCivilians = cityResidents + productionWorkers;
  state.population.police = police;
  state.population.nationalGuard = nationalGuard;
  state.population.unitPopulation = police + nationalGuard;
  state.population.waitingRefugees = waiting;
  state.population.screeningRefugees = screening;
  state.population.approvedRefugees = approved;
  state.population.facilityInfected = facilityInfected;
  state.population.checkpointInfected = checkpointInfected;
  state.population.facilityWorkers = state.facilities
    .filter((facility) => facility.owner === 'player')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((facility) => ({ facilityId: facility.id, workers: facility.workers }));

  state.statistics.maxPopulation = Math.max(
    state.statistics.maxPopulation,
    cityResidents + productionWorkers + waiting + screening + approved + police + nationalGuard,
  );
  state.statistics.maxSecuredFacilities = Math.max(
    state.statistics.maxSecuredFacilities,
    state.facilities.filter((facility) => facility.owner === 'player' && facility.status === 'owned').length,
  );
  state.statistics.maxSuppliedFacilities = Math.max(
    state.statistics.maxSuppliedFacilities,
    state.facilities.filter((facility) => isHexSupplied(state, facility.position)).length,
  );
  state.statistics.maxSupplyRadius = Math.max(
    state.statistics.maxSupplyRadius,
    ...state.roadBranches.map((branch) => getBranchSupplyRadius(state, branch.branchId)),
  );
  state.statistics.maxVisibleZombies = Math.max(
    state.statistics.maxVisibleZombies,
    getVisibleEnemyUnits(state).length,
  );
  for (const checkpoint of state.checkpoints) {
    const branch = state.roadBranches.find(
      (candidate) => candidate.branchId === (checkpoint.branchId ?? checkpoint.direction),
    );
    checkpoint.nextArrivalTurn = branch?.nextArrivalTurn ?? null;
  }
  for (const branch of state.roadBranches) {
    const allPosts = state.checkpoints.filter(
      (checkpoint) => (checkpoint.branchId ?? checkpoint.direction) === branch.branchId,
    ).length;
    const prepared = (branch.activeCheckpointId === null ? 0 : 1) + branch.standbyCheckpointIds.length;
    state.statistics.maxCheckpointPostsPerBranch = Math.max(state.statistics.maxCheckpointPostsPerBranch, allPosts);
    state.statistics.maxPreparedCheckpointPostsPerBranch = Math.max(
      state.statistics.maxPreparedCheckpointPostsPerBranch,
      prepared,
    );
  }
}

export function civilianWorkerCount(state: GameState): number {
  return state.facilities
    .filter((facility) => facility.owner === 'player')
    .reduce((total, facility) => total + facility.workers, 0);
}

export function resourceConsumerPopulation(state: GameState): number {
  const checkpointHealthy = state.checkpoints.reduce(
    (total, checkpoint) => total + checkpoint.waiting + checkpoint.screening + checkpoint.approved,
    0,
  );
  return civilianWorkerCount(state) + state.population.unitPopulation + checkpointHealthy;
}

/** Auditable population ledger used to prove that atomic actions never create or lose people. */
export function populationLedgerTotal(state: GameState): number {
  const facilities = state.facilities.reduce(
    (total, facility) => total + facility.workers + facility.infected,
    0,
  );
  const units = state.units
    .filter(isHumanUnit)
    .reduce((total, unit) => total + unit.population, 0);
  const reservedUnits = state.pendingUnitProductions.reduce((total, order) => total + order.population, 0);
  const checkpoints = state.checkpoints.reduce(
    (total, checkpoint) =>
      total + checkpoint.waiting + checkpoint.screening + checkpoint.approved + checkpoint.infected,
    0,
  );
  return facilities + units + reservedUnits + checkpoints + state.population.cumulativeDeaths
    + state.statistics.infectedPopulationConvertedToZombies;
}

export function createCityPopulationSnapshot(state: GameState): void {
  const entries = state.facilities
    .filter((facility) => facility.owner === 'player' && facility.status !== 'ruined' && isCityFacility(facility))
    .map((facility) => ({
      facilityId: facility.id,
      population: facility.workers,
      eligible:
        facility.status === 'owned' &&
        facility.infected === 0 &&
        facility.populationOperationalTurn <= state.turn,
    }));
  state.cityPopulationSnapshot = {
    turn: state.turn,
    supply: [...entries].sort(
      (left, right) => right.population - left.population || left.facilityId.localeCompare(right.facilityId),
    ),
    reception: [...entries].sort(
      (left, right) => left.population - right.population || left.facilityId.localeCompare(right.facilityId),
    ),
  };
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
    operationalStatus: infected > 0
      ? 'infected'
      : owned && (configuredWorkers > 0 || definition.type === 'windPowerPlant')
        ? 'operational'
        : 'stopped',
    workers: configuredWorkers,
    infected,
    securedOrder,
    lastAssignedOrder: securedOrder ?? 0,
    populationOperationalTurn: owned ? 1 : Number.MAX_SAFE_INTEGER,
    powerSupplyEnabled: ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(definition.type),
    lastPowerSupplied: null,
    constructible: false,
    builtTurn: null,
    recoveryOperationalTurn: null,
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

const CANONICAL_DIRECTIONS: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];

function selectWarningDirections(rng: SeededRng, count: number): CardinalDirection[] {
  if (count === 4) return [...CANONICAL_DIRECTIONS];
  const remaining = [...CANONICAL_DIRECTIONS];
  const selected: CardinalDirection[] = [];
  while (selected.length < count) {
    const direction = rng.pick(remaining);
    selected.push(direction);
    remaining.splice(remaining.indexOf(direction), 1);
  }
  return CANONICAL_DIRECTIONS.filter((direction) => selected.includes(direction));
}

/**
 * Create the complete, JSON-compatible state used by UI, tests and headless
 * play.  The supplied Config is copied so option changes cannot alter a game
 * that is already in progress.
 */
export function createInitialState(seed: number, config: GameConfig): GameState {
  assertValidGameConfig(config);
  if (config.mapId !== FIXED_MAP_ID) {
    throw new Error(`Unsupported map id: ${config.mapId}`);
  }
  if (!Number.isSafeInteger(seed)) {
    throw new Error('Seed must be a safe integer');
  }

  const stateConfig = cloneConfig(config);
  const firstWave = stateConfig.horde.waves[0]!;
  const finalWave = stateConfig.horde.waves.at(-1)!;
  const map = createFixedMap(
    Object.fromEntries(
      Object.entries(config.facilities).map(([type, facility]) => [type, facility.workerCapacity]),
    ) as Record<keyof GameConfig['facilities'], number>,
  );
  const rng = new SeededRng(seed);
  // Initial Zombie placement is part of new-game setup and uses the same
  // serializable stream as every other seeded rule. Generate the full
  // canonical set even when a test Config requests fewer initial Zombies so
  // the map snapshot and replay contract remain stable.
  map.initialZombiePositions = generateInitialZombiePositions(map, rng);
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
  const roadBranches = [...map.roadBranches]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((branch) => ({
      branchId: branch.id,
      nextArrivalTurn:
        1 + rng.nextInt(stateConfig.refugees.arrivalIntervalMin, stateConfig.refugees.arrivalIntervalMax),
      checkpointActionsThisTurn: 0,
      activeCheckpointId: null,
      standbyCheckpointIds: [],
      currentPolicy: 'normal' as const,
      hasBuiltCheckpoint: false,
    }));
  const state: GameState = {
    gameVersion: GAME_VERSION,
    config: stateConfig,
    seed,
    rngState: rng.snapshot(),
    turn: 1,
    finalHordeTurn: finalWave.turn,
    actionsTakenThisTurn: 0,
    phase: 'player',
    mapId: map.id,
    map,
    facilities,
    cityPopulationSnapshot: { turn: 1, supply: [], reception: [] },
    population: {
      initialPopulation: 0,
      cityResidents: 0,
      productionWorkers: 0,
      healthyCivilians: 0,
      police: 0,
      nationalGuard: 0,
      unitPopulation: 0,
      facilityWorkers: [],
      waitingRefugees: 0,
      screeningRefugees: 0,
      approvedRefugees: 0,
      facilityInfected: 0,
      checkpointInfected: 0,
      cumulativeDeaths: 0,
      cumulativeArrivals: 0,
      cumulativeDepartures: 0,
      cumulativeDiscoveredInfected: 0,
    },
    resources: {
      food: resources.food,
      civilianGoods: resources.civilianGoods,
      militaryGoods: resources.militaryGoods,
      fuel: resources.fuel,
      electricityCapacity: 0,
      electricityRequired: 0,
    },
    units: [
      createUnit({ config: stateConfig }, 'police-1', 'police', { ...FIXED_INITIAL_UNIT_POSITIONS.police }),
      createUnit({ config: stateConfig }, 'national-guard-1', 'nationalGuard', { ...FIXED_INITIAL_UNIT_POSITIONS.nationalGuard }),
      ...map.initialZombiePositions.slice(0, stateConfig.economy.initialZombieCount).map((position, index) =>
        createUnit({ config: stateConfig }, `zombie-${index + 1}`, 'zombie', position),
      ),
    ],
    checkpoints: [],
    roadBranches,
    rejectedRefugeesByDirection: emptyRejectedRefugeeCounterByDirection(),
    pendingUnitProductions: [],
    nextCheckpointNumber: 1,
    nextConstructibleFacilityNumber: 1,
    nextUnitNumber: 2,
    nextEventNumber: 1,
    nextAssignmentOrder: securedOrder + 1,
    horde: {
      nextWaveIndex: 1,
      totalSpawned: 0,
      warningDirections: firstWave.turn - stateConfig.horde.warningLeadTurns <= 1
        ? selectWarningDirections(rng, firstWave.directionCount)
        : [],
      turnsRemaining: Math.max(0, firstWave.turn - 1),
      nextSpawnTurn: firstWave.turn,
      lastSpawnTurn: null,
      warningType: firstWave.turn - stateConfig.horde.warningLeadTurns <= 1
        ? firstWave.final ? 'final' : 'periodic'
        : 'none',
      spawnedWaveIndices: [],
      spawnGroupIdsByWave: {},
      finalHordeStatus: 'notStarted',
      finalSpawnGroupIds: [],
      finalSpawnedCount: 0,
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
      refugeeArrivalsByBranch: Object.fromEntries(roadBranches.map((branch) => [branch.branchId, 0])),
      unmanagedPassThrough: 0,
      refugeesScreenedByPolicy: { passThrough: 0, normal: 0, strict: 0 },
      refugeesAccepted: 0,
      refugeesDeparted: 0,
      checkpointsBuilt: 0,
      checkpointsRelocated: 0,
      checkpointRetreats: 0,
      checkpointsRuined: 0,
      checkpointsRecovered: 0,
      checkpointsAbandoned: 0,
      checkpointsRemoved: 0,
      unmanagedBranchTurns: 0,
      maxSuppliedFacilities: 0,
      maxSupplyRadius: stateConfig.checkpoint.initialSupplyRadius,
      supplyLosses: 0,
      supplyRejections: 0,
      finalHordeSpawned: 0,
      finalHordeKilled: 0,
      finalHordeDefeated: false,
      periodicHordeZombiesSpawned: 0,
      periodicNormalZombiesSpawned: 0,
      finalHordeZombiesSpawned: 0,
      finalNormalZombiesSpawned: 0,
      normalZombiesKilled: 0,
      hordeZombiesKilled: 0,
      maxVisibleZombies: 0,
      turnsAfterFinalHorde: 0,
      suppliedAreaZombieClearTurn: null,
      suppliedAreaInfectionClearTurn: null,
      victoryTurn: null,
      terrainEntriesByType: { plain: 0, forest: 0, mountain: 0, water: 0 },
      urbanDefenseApplications: 0,
      urbanDefenseDamagePrevented: 0,
      forestDefenseApplications: 0,
      forestDefenseDamagePrevented: 0,
      normalZombieIdleCount: 0,
      hordeTargetInheritedCount: 0,
      hordeTargetClearedCount: 0,
      standbyCheckpointsCreated: 0,
      dormantCheckpointsCreated: 0,
      checkpointActivations: 0,
      checkpointFallbacks: 0,
      checkpointFallbacksByBranch: Object.fromEntries(roadBranches.map((branch) => [branch.branchId, 0])),
      checkpointFallbacksFromStandby: 0,
      checkpointFallbacksFromDormant: 0,
      checkpointFallbacksPreventingUnmanagedArrival: 0,
      maxCheckpointPostsPerBranch: 0,
      maxPreparedCheckpointPostsPerBranch: 0,
      activeCheckpointLosses: 0,
      noisePulsesEmitted: 0,
      policeNoisePulses: 0,
      nationalGuardNoisePulses: 0,
      normalZombiesNoiseTargeted: 0,
      noiseTargetsReached: 0,
      noiseTargetsOverriddenByHorde: 0,
      noiseTargetsOverriddenByVisiblePopulation: 0,
      initialNormalZombies: stateConfig.economy.initialZombieCount,
      fallenSitesTriggeredByNoise: 0,
      noiseRespawnAttempts: 0,
      noiseRespawnZombiesSpawned: 0,
      infectedPopulationConvertedToZombies: 0,
      unspawnedInfectedPopulation: 0,
      immediateInfectionsFromSpawn: 0,
      chainOverruns: 0,
      maximumOverrunChainLength: 0,
      constructibleInfectedDeaths: 0,
      groundVisionPotentialHexes: 0,
      groundVisionVisibleHexes: 0,
      groundVisionBlockedHexes: 0,
      maxGroundVisionBlockedHexes: 0,
      cumulativeGroundVisionBlockedHexes: 0,
      groundVisionSamples: 0,
      civilianDroneBasesBuilt: 0,
      maxCivilianDroneVisionRadius: 0,
      aerialDiscoveriesInGroundBlockedArea: 0,
      checkpointQueueFoodDemand: 0,
      checkpointQueueCivilianGoodsDemand: 0,
      checkpointQueueFoodConsumed: 0,
      checkpointQueueCivilianGoodsConsumed: 0,
      refugeesRejectedByDirectionAndPolicy: emptyDirectionValues(() => ({ normal: 0, strict: 0 })),
      refugeesTurnedAwayByDirection: emptyDirectionValues(() => 0),
      rejectedBonusZombiesByDirection: emptyDirectionValues(() => 0),
      rejectedCounterResetsByDirection: emptyDirectionValues(() => 0),
      policeZombiesSpawned: 0,
      soldierZombiesSpawned: 0,
      policeZombiesKilled: 0,
      soldierZombiesKilled: 0,
      policeZombiesFinal: 0,
      soldierZombiesFinal: 0,
      policeReanimations: 0,
      nationalGuardReanimations: 0,
      reanimationImmediateInfections: 0,
      reanimationFacilityInfections: 0,
      reanimationCheckpointInfections: 0,
      reanimationSiteFalls: 0,
      reanimationChainOverruns: 0,
      preventedRefugeeArrivalsAfterFinal: 0,
      civilianDroneBasesDecommissioned: 0,
      civilianGoodsRefundedFromDecommission: 0,
      policeLongRangeMoves: 0,
    },
    gameOver: false,
    result: null,
  };
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state);
  const coverage = getPlayerVisionCoverage(state);
  state.statistics.groundVisionPotentialHexes = coverage.groundPotential.size;
  state.statistics.groundVisionVisibleHexes = coverage.groundVisible.size;
  state.statistics.groundVisionBlockedHexes = coverage.groundBlocked.size;
  state.statistics.maxGroundVisionBlockedHexes = coverage.groundBlocked.size;
  state.statistics.cumulativeGroundVisionBlockedHexes = coverage.groundBlocked.size;
  state.statistics.groundVisionSamples = 1;
  state.statistics.aerialDiscoveriesInGroundBlockedArea = state.units.filter((unit) =>
    !unit.isPlayerUnit && coverage.groundBlocked.has(hexKey(unit.position)) && coverage.aerialVisible.has(hexKey(unit.position)),
  ).length;
  createCityPopulationSnapshot(state);
  return state;
}

export function nextHumanUnitId(state: GameState, type: HumanUnitType): string {
  const prefix = type === 'police' ? 'police' : 'national-guard';
  const id = `${prefix}-${state.nextUnitNumber}`;
  state.nextUnitNumber += 1;
  return id;
}
