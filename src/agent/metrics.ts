import type {
  BaseTerrain,
  CardinalDirection,
  CheckpointPolicy,
  GameAction,
  GameConfig,
  HumanUnitType,
  ResourceType,
} from '../core/types';
import { hexDistance } from '../core/hex';
import { lazyArray } from './history';
import {
  APP_VERSION,
  AGENT_API_VERSION,
  BRIDGE_API_VERSION,
  OBSERVATION_API_VERSION,
  type AgentDecisionTrace,
  type AgentGameResult,
  type AgentObservation,
  type AgentPublicEvent,
  type InvalidActionAttempt,
} from './types';

/** Keep these orders stable: they are also the canonical CSV column order. */
export const ACTION_TYPES = [
  'Move',
  'Attack',
  'Wait',
  'AssignWorkers',
  'TransferPopulation',
  'SetCheckpointPolicy',
  'SetPowerSupply',
  'BuildCheckpoint',
  'BuildConstructibleFacility',
  'DecommissionConstructibleFacility',
  'RelocateCheckpoint',
  'ActivateCheckpoint',
  'TurnAwayCheckpointRefugees',
  'ProduceUnit',
  'EndTurn',
] as const;

export const PRIORITY_GOALS = [
  'avoid_defeat',
  'prevent_facility_contact',
  'rescue_critical_infection',
  'defend_horde',
  'suppress_infection',
  'restore_military_supply',
  'restore_economy',
  'reduce_overcrowding',
  'build_forces',
  'secure_facilities',
  'manage_checkpoint',
  'combat',
  'end_turn',
] as const;

export type MetricOutcome = 'won' | 'lost' | 'limit_reached' | 'technical_failure';

export interface FacilityPowerMetric {
  requested: number;
  supplied: number;
  unavailable: number;
  off: number;
}

export interface HordeWaveMetric {
  index: number;
  spawnTurn: number;
  directions: CardinalDirection[];
  compositionPerDirection: {
    hordeZombie: number;
    zombie: number;
    policeZombie?: number;
    soldierZombie?: number;
    riotZombie?: number;
    hunterZombie?: number;
  };
  /** Publicly declared slot count; the per-slot draw remains hidden until Spawn. */
  nonHordeSlotCountPerDirection?: number;
  possibleNonHordeTypes?: string[];
  specialZombieSpawnedByType?: Record<'policeZombie' | 'soldierZombie' | 'riotZombie' | 'hunterZombie', number>;
  specialZombieKilledByType?: Record<'policeZombie' | 'soldierZombie' | 'riotZombie' | 'hunterZombie', number>;
  final: boolean;
  hordeZombieSpawned: number;
  normalZombieSpawned: number;
  hordeZombieKilled: number;
  normalZombieKilled: number;
}

export interface MetricFailureInfo {
  code: string;
  message: string;
}

export interface GameMetrics {
  appVersion: string;
  gameRulesVersion: string;
  agentId: string;
  agentVersion: string;
  strategy: string;
  agentApiVersion: string;
  observationApiVersion: string;
  bridgeApiVersion: string;
  buildId: string;
  mapId: string;
  seed: number;
  config: GameConfig;
  outcome: MetricOutcome;
  /** True when the runner stopped at maxTurns before Game Over. */
  limitReached: boolean;
  gameOverReason: string | null;
  finalTurn: number;
  totalAgentDecisions: number;
  acceptedActionCount: number;
  invalidAttemptCount: number;
  actionCounts: Record<string, number>;
  priorityGoalCounts: Record<string, number>;
  initialPopulation: number;
  finalHealthyCivilianPopulation: number;
  maxPopulation: number;
  civilianLosses: number;
  infectionLosses: number;
  resourceShortageLosses: number;
  refugeesAccepted: number;
  refugeeArrivalsByBranch: Record<string, number>;
  totalRefugeeArrivals: number;
  unmanagedPassThrough: number;
  refugeesScreenedByPolicy: Record<CheckpointPolicy, number>;
  refugeesDeparted: number;
  checkpointsBuilt: number;
  checkpointsRelocated: number;
  checkpointRetreats: number;
  checkpointsRuined: number;
  checkpointsRecovered: number;
  checkpointsAbandoned: number;
  checkpointsRemoved: number;
  standbyCheckpointsCreated: number;
  dormantCheckpointsCreated: number;
  checkpointActivations: number;
  checkpointFallbacks: number;
  checkpointFallbacksByBranch: Record<string, number>;
  checkpointFallbacksFromStandby: number;
  checkpointFallbacksFromDormant: number;
  checkpointFallbacksPreventingUnmanagedArrival: number;
  maxCheckpointPostsPerBranch: number;
  maxPreparedCheckpointPostsPerBranch: number;
  activeCheckpointLosses: number;
  unmanagedBranchTurns: number;
  maxSuppliedFacilities: number;
  maxSupplyRadius: number;
  supplyLosses: number;
  supplyRejections: number;
  maxOvercrowding: number;
  maxOvercrowdingAdditionalFood: number;
  maxOvercrowdingAdditionalCivilianGoods: number;
  facilitiesCaptured: number;
  facilitiesLost: number;
  finalSecuredFacilities: number;
  policeProduced: number;
  nationalGuardProduced: number;
  riotPoliceProduced: number;
  policeInitial: number;
  nationalGuardInitial: number;
  riotPoliceInitial: number;
  policeLosses: number;
  nationalGuardLosses: number;
  riotPoliceLosses: number;
  policeFinal: number;
  nationalGuardFinal: number;
  riotPoliceFinal: number;
  policeSurvivalRate: number;
  nationalGuardSurvivalRate: number;
  riotPoliceSurvivalRate: number;
  outOfSupplyUnitLosses: number;
  policeCombatRecoveryHp: number;
  policeCombatRecoveryCount: number;
  policeRestRecoveryHp: number;
  policeRestRecoveryCount: number;
  nationalGuardCombatRecoveryHp: number;
  nationalGuardCombatRecoveryCount: number;
  nationalGuardRestRecoveryHp: number;
  nationalGuardRestRecoveryCount: number;
  combatRecoverySelections: number;
  restRecoverySelections: number;
  maxWorkersInSingleFacility: number;
  maxTotalProductionWorkers: number;
  highCapacityFacilityTurns: number;
  powerPlantStoppedTurns: number;
  powerShortageTurns: number;
  poweredIndustrialFacilityTurns: number;
  unpoweredCityTurns: number;
  refineryFacilitiesCaptured: number;
  powerPlantFacilitiesCaptured: number;
  checkpointPassThroughBranchTurns: number;
  checkpointNormalBranchTurns: number;
  checkpointStrictBranchTurns: number;
  checkpointPassThroughBranchTurnRate: number;
  checkpointNormalBranchTurnRate: number;
  checkpointStrictBranchTurnRate: number;
  checkpointPassThroughScreenedRate: number;
  checkpointNormalScreenedRate: number;
  checkpointStrictScreenedRate: number;
  unitLosses: number;
  zombiesKilled: number;
  hordeInterceptions: number;
  /** v1.4 Final Horde, terrain, and target-propagation metrics. */
  finalHordeSpawned: number;
  finalHordeKilled: number;
  finalHordeDefeated: boolean;
  periodicHordeZombiesSpawned: number;
  periodicNormalZombiesSpawned: number;
  finalHordeZombiesSpawned: number;
  finalNormalZombiesSpawned: number;
  normalZombiesKilled: number;
  hordeZombiesKilled: number;
  policeZombiesSpawned: number;
  soldierZombiesSpawned: number;
  policeZombiesKilled: number;
  soldierZombiesKilled: number;
  policeZombiesFinal: number;
  soldierZombiesFinal: number;
  riotZombiesSpawned: number;
  hunterZombiesSpawned: number;
  riotZombiesKilled: number;
  hunterZombiesKilled: number;
  riotZombiesFinal: number;
  hunterZombiesFinal: number;
  riotPoliceReanimations: number;
  maxVisibleZombies: number;
  turnsAfterFinalHorde: number;
  suppliedAreaZombieClearTurn: number | null;
  suppliedAreaInfectionClearTurn: number | null;
  victoryTurn: number | null;
  terrainEntriesByType: Record<BaseTerrain, number>;
  urbanDefenseApplications: number;
  urbanDefenseDamagePrevented: number;
  forestDefenseApplications: number;
  forestDefenseDamagePrevented: number;
  normalZombieIdleCount: number;
  hordeTargetInheritedCount: number;
  hordeTargetClearedCount: number;
  noisePulsesEmitted: number;
  policeNoisePulses: number;
  nationalGuardNoisePulses: number;
  riotPoliceNoisePulses: number;
  /** v1.5 promotion, charge, Riot, and Horde special-composition metrics. */
  recruitsCommissionedByType: Record<HumanUnitType, number>;
  regularPromotionsByType: Record<HumanUnitType, number>;
  veteranPromotionsByType: Record<HumanUnitType, number>;
  veteranZombieKillsByType: Record<HumanUnitType, number>;
  hordeSpecialSpawnedByType: Record<'policeZombie' | 'soldierZombie' | 'riotZombie' | 'hunterZombie', number>;
  noisePulsesBySourceType: Record<HumanUnitType | 'hordeZombie', number>;
  hordeMovementNoisePulses: number;
  hordeNoiseRespawnedByType: Record<'zombie' | 'policeZombie' | 'soldierZombie' | 'riotZombie', number>;
  /** Balanced-agent audit fields; public artifacts may retain only the aggregate. */
  unusedAttackChargesByTurn: number;
  criticalInfectionAlertUnresolvedTurns: number;
  /** Verification-only values; Browser Bridge artifacts remove these keys. */
  normalZombiesNoiseTargeted: number;
  noiseTargetsReached: number;
  noiseTargetsOverriddenByHorde: number;
  noiseTargetsOverriddenByVisiblePopulation: number;
  /** v1.4.3 LOS, site-fall, chain, and fallen-site Noise metrics. */
  initialNormalZombies: number;
  combatNoiseByClass: Record<'medium' | 'large', number>;
  fallenSitesTriggeredByNoise: number;
  noiseRespawnAttempts: number;
  noiseRespawnZombiesSpawned: number;
  noiseImmediateInfections: number;
  noiseChainOverruns: number;
  policeNoiseImmediateInfections: number;
  nationalGuardNoiseImmediateInfections: number;
  policeNoiseChainOverruns: number;
  nationalGuardNoiseChainOverruns: number;
  groundVisionPotentialHexes: number;
  groundVisionVisibleHexes: number;
  groundVisionBlockedHexes: number;
  maxGroundVisionBlockedHexes: number;
  averageGroundVisionBlockedHexes: number;
  civilianDroneBasesBuilt: number;
  civilianDroneBasesDecommissioned: number;
  civilianGoodsRefundedFromDecommission: number;
  maxCivilianDroneVisionRadius: number;
  /** Verification-only; production results and Browser Bridge artifacts omit it. */
  aerialDiscoveriesInGroundBlockedArea: number;
  siteFirstInfectionsByType: Record<string, number>;
  siteFallsByType: Record<string, number>;
  siteZombieOccupancyDestructionsByType: Record<string, number>;
  infectedPopulationAtFall: number;
  requestedSiteZombieSpawns: number;
  actualSiteZombieSpawns: number;
  fallSiteZombieSpawns: number;
  noiseSiteZombieSpawns: number;
  maxSixZombieSpawnResolutions: number;
  infectedPopulationConvertedToZombies: number;
  unspawnedInfectedPopulation: number;
  immediateInfectionsFromSpawn: number;
  chainOverruns: number;
  maximumOverrunChainLength: number;
  chainOriginsByType: Record<string, number>;
  constructibleInfectedDeaths: number;
  earlyFacilityLosses: number;
  earlyCheckpointLosses: number;
  finalFood: number;
  finalCivilianGoods: number;
  finalMilitaryGoods: number;
  finalFuel: number;
  /** v1.4.0 large-theater mobility and logistics projections. */
  mapWidth: number;
  mapHeight: number;
  humanHexesMovedByType: Record<HumanUnitType, number>;
  maxSingleMoveDistanceByType: Record<HumanUnitType, number>;
  longMoves6PlusByType: Record<HumanUnitType, number>;
  unitFuelConsumedByType: Record<HumanUnitType, number>;
  unitFuelRefilledByType: Record<HumanUnitType, number>;
  commissioningFuelByType: Record<HumanUnitType, number>;
  turnsUnitsEndedOutOfSupplyByType: Record<HumanUnitType, number>;
  unitsUnableToMoveForFuel: number;
  stateFuelSpentOnPower: number;
  stateFuelSpentOnUnits: number;
  fuelShortageTurns: number;
  windPowerGenerated: number;
  windDisabledTurns: number;
  windOverruns: number;
  windRecoveries: number;
  simpleFarmsBuilt: number;
  simpleFarmsDestroyed: number;
  simpleFarmFoodProduced: number;
  droneBasesBuilt: number;
  droneBasesDestroyed: number;
  maxDroneVisionRadius: number;
  constructibleFacilityOverruns: number;
  constructibleBuildRejectedByReason: Record<string, number>;
  guaranteedDefeatWarnings: number;
  guaranteedDefeatIgnored: number;
  resourceSinglePointFailureTurnsByResource: Record<string, number>;
  checkpointMovesWithNoSupplyGain: number;
  checkpointQueuePressureTurnsByClass: Record<'none' | 'low' | 'medium' | 'high', number>;
  checkpointQueueFoodDemand: number;
  checkpointQueueCivilianGoodsDemand: number;
  checkpointQueueFoodConsumed: number;
  checkpointQueueCivilianGoodsConsumed: number;
  refugeesRejectedByDirectionAndPolicy: Record<CardinalDirection, Record<'normal' | 'strict', number>>;
  refugeesTurnedAwayByDirection: Record<CardinalDirection, number>;
  rejectedBonusZombiesByDirection: Record<CardinalDirection, number>;
  rejectedCounterResetsByDirection: Record<CardinalDirection, number>;
  preventedRefugeeArrivalsAfterFinal: number;
  policeReanimations: number;
  nationalGuardReanimations: number;
  reanimationImmediateInfections: number;
  reanimationFacilityInfections: number;
  reanimationCheckpointInfections: number;
  reanimationSiteFalls: number;
  reanimationChainOverruns: number;
  policeLongRangeMoves: number;
  fixedMilitaryGoodsConsumedByType: Record<HumanUnitType, number>;
  attackMilitaryGoodsConsumedByType: Record<HumanUnitType, number>;
  counterattackMilitaryGoodsConsumedByType: Record<HumanUnitType, number>;
  interceptionMilitaryGoodsConsumedByType: Record<HumanUnitType, number>;
  suppressionMilitaryGoodsConsumedByType: Record<HumanUnitType, number>;
  militaryGoodsRefilledByType: Record<HumanUnitType, number>;
  unfilledMilitaryGoodsRefillByType: Record<HumanUnitType, number>;
  militaryGoodsLostOnDestructionByType: Record<HumanUnitType, number>;
  zeroMilitaryGoodsWeakAttacksByType: Record<HumanUnitType, number>;
  nationalGuardAttacksByRange: Record<'range1' | 'range2', number>;
  nationalGuardMilitaryGoodsConsumedByRange: Record<'range1' | 'range2', number>;
  militaryGoodsRefillShortageTurns: number;
  emergencyMovesByType: Record<HumanUnitType, number>;
  emergencyMovementHexesByType: Record<HumanUnitType, number>;
  emergencyMovementPointsByType: Record<HumanUnitType, number>;
  emergencyReturnsToSupplyByType: Record<HumanUnitType, number>;
  /** v1.4.2 power, checkpoint-capacity, and fixed-wave metrics. */
  powerTurnsByFacilityType: Record<string, FacilityPowerMetric>;
  powerRequestedTurnsByFacilityType: Record<string, number>;
  powerSuppliedTurnsByFacilityType: Record<string, number>;
  powerUnavailableTurnsByFacilityType: Record<string, number>;
  powerSupplyOffTurnsByFacilityType: Record<string, number>;
  powerResourceLossByResource: Record<ResourceType, number>;
  refineryPowerOutageTurns: number;
  refineryOutageNextTurnFuelShortageTurns: number;
  simpleFarmFoodShortageAvoidanceTurns: number;
  checkpointBatchStartsByPolicy: Record<CheckpointPolicy, number>;
  checkpointBatchCompletionsByPolicy: Record<CheckpointPolicy, number>;
  checkpointAverageQueue: number;
  checkpointCapacityUtilization: number;
  checkpointEstimatedThroughput: number;
  hordeWaves: HordeWaveMetric[];
  hordeDirectionSpawnCounts: Record<CardinalDirection, { hordeZombie: number; normalZombie: number }>;
  hordeDirectionKillCounts: Record<CardinalDirection, { hordeZombie: number; normalZombie: number }>;
  hordeFinalWaveSpawnTotal: number;
  hordeFinalWaveKillTotal: number;
  hordeFinalDefeatedTurn: number | null;
  hordeTurnsAfterFinal: number;
  hordeMultiFrontCheckpointLosses: number;
  hordeMultiFrontFallbacks: number;
  failure: MetricFailureInfo | null;
}

export interface GameMetricsInput {
  initialObservation: AgentObservation;
  finalObservation: AgentObservation | null;
  /** Every observation, including the initial one, in chronological order. */
  observations?: readonly AgentObservation[];
  actions: readonly GameAction[];
  events?: readonly AgentPublicEvent[];
  decisionTrace?: readonly AgentDecisionTrace[];
  result: AgentGameResult | null;
  invalidAttemptCount?: number;
  invalidAttempts?: readonly InvalidActionAttempt[];
  totalAgentDecisions?: number;
  agent: { id: string; version: string; strategy?: string };
  config: GameConfig;
  buildId?: string;
  seed?: number;
  failure?: MetricFailureInfo | null;
  /** Runner-owned neutral stop; mutually exclusive with failure. */
  limitReached?: boolean;
  appVersion?: string;
  gameRulesVersion?: string;
  agentApiVersion?: string;
  observationApiVersion?: string;
  bridgeApiVersion?: string;
  /** Local/CI runner only: exact GameStatistics from the debug snapshot. */
  verificationStatistics?: unknown;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function cloneConfig(config: GameConfig): GameConfig {
  return JSON.parse(JSON.stringify(config)) as GameConfig;
}

function makeCountRecord(keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function populationAtObservation(observation: AgentObservation): number {
  const population = observation.population;
  return numberOrZero(population.healthyCivilians)
    + numberOrZero(population.unitPopulation)
    + numberOrZero(population.waitingRefugees)
    + numberOrZero(population.screeningRefugees)
    + numberOrZero(population.approvedRefugees);
}

function overcrowdingAtObservation(observation: AgentObservation): number {
  return observation.endTurnForecast.overcrowding.cities.reduce(
    (total, city) => total + (city.softCap > 0 ? Math.max(0, city.excess) / city.softCap : 0),
    0,
  );
}

function eventPayloadNumber(event: AgentPublicEvent, key: string): number {
  return numberOrZero(event.payload[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === 'number' && Number.isFinite(item))
      .map(([key, item]) => [key, item as number]),
  );
}

function statisticNumber(statistics: unknown, key: string): number | null {
  if (!isRecord(statistics)) return null;
  const value = statistics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function statisticBoolean(statistics: unknown, key: string): boolean | null {
  if (!isRecord(statistics)) return null;
  return typeof statistics[key] === 'boolean' ? statistics[key] as boolean : null;
}

function statisticTurn(statistics: unknown, key: string): number | null {
  const value = statisticNumber(statistics, key);
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const BASE_TERRAINS: readonly BaseTerrain[] = ['plain', 'forest', 'mountain', 'water'];
const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];
const RESOURCE_TYPES: readonly ResourceType[] = ['food', 'civilianGoods', 'militaryGoods', 'fuel'];
const FACILITY_TYPES: readonly string[] = [
  'capital', 'city', 'farm', 'civilianFactory', 'militaryFactory', 'refinery',
  'powerPlant', 'windPowerPlant', 'civilianDroneBase', 'simpleFarm',
];
const HUMAN_UNIT_TYPES: readonly HumanUnitType[] = ['police', 'nationalGuard', 'riotPolice'];
const SPECIAL_ZOMBIE_TYPES = ['policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie'] as const;
const ZOMBIE_TYPES = ['zombie', 'hordeZombie', ...SPECIAL_ZOMBIE_TYPES] as const;

function isHumanUnitType(value: unknown): value is HumanUnitType {
  return typeof value === 'string' && HUMAN_UNIT_TYPES.includes(value as HumanUnitType);
}

function isZombieType(value: unknown): value is typeof ZOMBIE_TYPES[number] {
  return typeof value === 'string' && ZOMBIE_TYPES.includes(value as typeof ZOMBIE_TYPES[number]);
}

function zeroResourceRecord(): Record<ResourceType, number> {
  return { food: 0, civilianGoods: 0, militaryGoods: 0, fuel: 0 };
}

function zeroDirectionMetric(): Record<CardinalDirection, { hordeZombie: number; normalZombie: number }> {
  return Object.fromEntries(
    CARDINAL_DIRECTIONS.map((direction) => [direction, { hordeZombie: 0, normalZombie: 0 }]),
  ) as Record<CardinalDirection, { hordeZombie: number; normalZombie: number }>;
}

function directionNumberRecord(statistics: unknown, key: string): Record<CardinalDirection, number> {
  const source = numericRecord(isRecord(statistics) ? statistics[key] : undefined);
  return Object.fromEntries(
    CARDINAL_DIRECTIONS.map((direction) => [direction, source[direction] ?? 0]),
  ) as Record<CardinalDirection, number>;
}

function rejectedByDirectionAndPolicy(
  statistics: unknown,
): Record<CardinalDirection, Record<'normal' | 'strict', number>> {
  const source = isRecord(statistics) && isRecord(statistics.refugeesRejectedByDirectionAndPolicy)
    ? statistics.refugeesRejectedByDirectionAndPolicy
    : {};
  return Object.fromEntries(CARDINAL_DIRECTIONS.map((direction) => {
    const directionSource = numericRecord(source[direction]);
    return [direction, { normal: directionSource.normal ?? 0, strict: directionSource.strict ?? 0 }];
  })) as Record<CardinalDirection, Record<'normal' | 'strict', number>>;
}

function zeroPowerMetric(): FacilityPowerMetric {
  return { requested: 0, supplied: 0, unavailable: 0, off: 0 };
}

function terrainEntriesByType(statistics: unknown): Record<BaseTerrain, number> {
  const fromStatistics = numericRecord(isRecord(statistics) ? statistics.terrainEntriesByType : undefined);
  return Object.fromEntries(BASE_TERRAINS.map((terrain) => {
    const reported = fromStatistics[terrain];
    return [terrain, reported ?? 0];
  })) as Record<BaseTerrain, number>;
}

function firstTurnWhere(
  observations: readonly AgentObservation[],
  predicate: (observation: AgentObservation) => boolean,
): number | null {
  const match = observations.find(predicate);
  return match ? match.turn : null;
}

function eventBranchId(event: AgentPublicEvent): string | null {
  return typeof event.payload.branchId === 'string' ? event.payload.branchId : null;
}

/**
 * Convert public observations, events, actions, and the final result into the
 * stable game-level Metrics record used by both JSON and CSV output.
 */
export function collectGameMetrics(input: GameMetricsInput): GameMetrics {
  const observations = input.observations?.length
    ? input.observations
    : [input.initialObservation, ...(input.finalObservation ? [input.finalObservation] : [])];
  const finalObservation = input.finalObservation ?? observations.at(-1) ?? input.initialObservation;
  const events = input.events ?? [];
  const actionCounts = makeCountRecord(ACTION_TYPES);
  for (const action of input.actions) {
    if (Object.prototype.hasOwnProperty.call(actionCounts, action.type)) actionCounts[action.type] += 1;
    else actionCounts[action.type] = (actionCounts[action.type] ?? 0) + 1;
  }
  const priorityGoalCounts = makeCountRecord(PRIORITY_GOALS);
  for (const trace of input.decisionTrace ?? []) {
    priorityGoalCounts[trace.priorityGoal] = (priorityGoalCounts[trace.priorityGoal] ?? 0) + 1;
  }

  const statistics = input.verificationStatistics ?? input.result?.statistics;
  const statisticArrivals = numericRecord(statistics && isRecord(statistics) ? statistics.refugeeArrivalsByBranch : undefined);
  const observedBranchIds = new Set<string>([
    ...input.initialObservation.roadBranches.map((branch) => branch.branchId),
    ...Object.keys(statisticArrivals),
    ...events.map(eventBranchId).filter((branchId): branchId is string => branchId !== null),
  ]);
  const refugeeArrivalsByBranch = Object.fromEntries(
    [...observedBranchIds].sort().map((branchId) => {
      const hasStatistic = Object.prototype.hasOwnProperty.call(statisticArrivals, branchId);
      const eventTotal = events
        .filter((event) => event.type === 'refugees_arrived' && eventBranchId(event) === branchId)
        .reduce((total, event) => total + eventPayloadNumber(event, 'people'), 0);
      return [branchId, hasStatistic ? statisticArrivals[branchId]! : eventTotal];
    }),
  );
  const totalRefugeeArrivals = Object.values(refugeeArrivalsByBranch).reduce((total, value) => total + value, 0);
  const statisticPolicies = numericRecord(statistics && isRecord(statistics) ? statistics.refugeesScreenedByPolicy : undefined);
  const refugeesScreenedByPolicy = (['passThrough', 'normal', 'strict'] as const).reduce(
    (record, policy) => {
      const hasStatistic = Object.prototype.hasOwnProperty.call(statisticPolicies, policy);
      const eventTotal = events
        .filter((event) => event.type === 'refugees_screened' && event.payload.policy === policy)
        .reduce((total, event) => total + eventPayloadNumber(event, 'screened'), 0);
      record[policy] = hasStatistic ? statisticPolicies[policy]! : eventTotal;
      return record;
    },
    { passThrough: 0, normal: 0, strict: 0 } as Record<CheckpointPolicy, number>,
  );
  const refugeesAcceptedFromEvents = events
    .filter((event) => event.type === 'refugees_screened')
    .reduce((total, event) => total + eventPayloadNumber(event, 'acceptedWorkers'), 0);
  const refugeesAccepted = statisticNumber(statistics, 'refugeesAccepted') ?? refugeesAcceptedFromEvents;
  const refugeesDeparted = statisticNumber(statistics, 'refugeesDeparted') ?? events
    .filter((event) => event.type === 'refugees_screened')
    .reduce((total, event) => total + Math.max(0, eventPayloadNumber(event, 'screened') - eventPayloadNumber(event, 'acceptedWorkers')), 0);
  const eventCount = (type: string): number => events.filter((event) => event.type === type).length;
  const checkpointsBuilt = statisticNumber(statistics, 'checkpointsBuilt') ?? eventCount('checkpoint_built');
  const checkpointsRelocated = statisticNumber(statistics, 'checkpointsRelocated') ?? eventCount('checkpoint_relocated');
  const checkpointRetreats = statisticNumber(statistics, 'checkpointRetreats') ?? events.filter(
    (event) => event.type === 'checkpoint_built' && event.payload.retreat === true,
  ).length;
  const checkpointsRuined = statisticNumber(statistics, 'checkpointsRuined') ?? events.filter(
    (event) => event.type === 'facility_overrun' && typeof event.payload.checkpointId === 'string' && event.payload.previousStatus === 'operational',
  ).length;
  const checkpointsRecovered = statisticNumber(statistics, 'checkpointsRecovered') ?? eventCount('checkpoint_recovered');
  const checkpointsAbandoned = statisticNumber(statistics, 'checkpointsAbandoned') ?? eventCount('checkpoint_abandoned');
  const checkpointsRemoved = statisticNumber(statistics, 'checkpointsRemoved') ?? eventCount('checkpoint_removed');
  const standbyCheckpointsCreated = statisticNumber(statistics, 'standbyCheckpointsCreated') ?? events.filter(
    (event) => event.type === 'checkpoint_built' && event.payload.role === 'standby',
  ).length;
  const dormantCheckpointsCreated = statisticNumber(statistics, 'dormantCheckpointsCreated') ?? 0;
  const checkpointActivations = statisticNumber(statistics, 'checkpointActivations') ?? eventCount('checkpoint_activated');
  const checkpointFallbacks = statisticNumber(statistics, 'checkpointFallbacks') ?? eventCount('checkpoint_fallback');
  const checkpointFallbacksByBranch = numericRecord(
    isRecord(statistics) ? statistics.checkpointFallbacksByBranch : undefined,
  );
  const checkpointFallbacksFromStandby = statisticNumber(statistics, 'checkpointFallbacksFromStandby') ?? 0;
  const checkpointFallbacksFromDormant = statisticNumber(statistics, 'checkpointFallbacksFromDormant') ?? 0;
  const checkpointFallbacksPreventingUnmanagedArrival = statisticNumber(
    statistics,
    'checkpointFallbacksPreventingUnmanagedArrival',
  ) ?? 0;
  const maxCheckpointPostsPerBranchFromObservation = Math.max(
    ...observations.map((observation) => {
      const byBranch = new Map<string, number>();
      for (const checkpoint of observation.checkpoints) {
        byBranch.set(checkpoint.branchId, (byBranch.get(checkpoint.branchId) ?? 0) + 1);
      }
      return Math.max(...byBranch.values(), 0);
    }),
    0,
  );
  const maxPreparedCheckpointPostsPerBranchFromObservation = Math.max(
    ...observations.flatMap((observation) => observation.roadBranches.map((branch) => branch.preparedPostCount)),
    0,
  );
  const maxCheckpointPostsPerBranch = Math.max(
    statisticNumber(statistics, 'maxCheckpointPostsPerBranch') ?? 0,
    maxCheckpointPostsPerBranchFromObservation,
  );
  const maxPreparedCheckpointPostsPerBranch = Math.max(
    statisticNumber(statistics, 'maxPreparedCheckpointPostsPerBranch') ?? 0,
    maxPreparedCheckpointPostsPerBranchFromObservation,
  );
  const activeCheckpointLosses = statisticNumber(statistics, 'activeCheckpointLosses') ?? 0;
  const unmanagedBranchTurns = statisticNumber(statistics, 'unmanagedBranchTurns') ?? observations.reduce(
    (total, observation) => total + observation.roadBranches.filter((branch) => branch.activeCheckpointId === null).length,
    0,
  );
  const maxSuppliedFacilitiesObservation = Math.max(
    ...observations.map((observation) => observation.facilities.filter((facility) => facility.inSupply).length),
    0,
  );
  const maxSuppliedFacilities = Math.max(
    statisticNumber(statistics, 'maxSuppliedFacilities') ?? 0,
    maxSuppliedFacilitiesObservation,
  );
  const maxSupplyRadiusObservation = Math.max(
    ...observations.flatMap((observation) => observation.supply.branchRadii.map((branch) => branch.radius)),
    ...observations.map((observation) => observation.supply.initialRadius),
    0,
  );
  const maxSupplyRadius = Math.max(statisticNumber(statistics, 'maxSupplyRadius') ?? 0, maxSupplyRadiusObservation);
  const supplyLossesFromEvents = events.filter(
    (event) => event.type === 'supply_changed' && eventPayloadNumber(event, 'beforeTileCount') > eventPayloadNumber(event, 'afterTileCount'),
  ).length;
  const supplyLosses = statisticNumber(statistics, 'supplyLosses') ?? supplyLossesFromEvents;
  const supplyRejections = statisticNumber(statistics, 'supplyRejections') ?? events.filter(
    (event) => event.type === 'supply_action_rejected',
  ).length + (input.invalidAttempts ?? []).filter((attempt) => /supply|out_of_supply/i.test(attempt.error.code)).length;
  const destroyedZombieEvents = events.filter(
    (event) => event.type === 'unit_destroyed' && isRecord(event.payload) &&
      typeof event.payload.unitId === 'string' &&
      isZombieType(event.payload.unitType),
  ).length;
  const normalZombiesKilled = statisticNumber(statistics, 'normalZombiesKilled') ?? events.filter(
    (event) => event.type === 'unit_destroyed' && event.payload.unitType === 'zombie',
  ).length;
  const hordeZombiesKilled = statisticNumber(statistics, 'hordeZombiesKilled') ?? events.filter(
    (event) => event.type === 'unit_destroyed' && event.payload.unitType === 'hordeZombie',
  ).length;
  const policeZombiesKilled = statisticNumber(statistics, 'policeZombiesKilled') ?? events.filter(
    (event) => event.type === 'unit_destroyed' && event.payload.unitType === 'policeZombie',
  ).length;
  const soldierZombiesKilled = statisticNumber(statistics, 'soldierZombiesKilled') ?? events.filter(
    (event) => event.type === 'unit_destroyed' && event.payload.unitType === 'soldierZombie',
  ).length;
  const riotZombiesKilled = statisticNumber(statistics, 'riotZombiesKilled') ?? events.filter(
    (event) => event.type === 'unit_destroyed' && event.payload.unitType === 'riotZombie',
  ).length;
  const riotZombiesSpawned = statisticNumber(statistics, 'riotZombiesSpawned') ?? events.filter(
    (event) => (event.type === 'human_unit_reanimated' && event.payload.zombieUnitType === 'riotZombie')
      || (event.type === 'horde_spawned' && event.payload.unitType === 'riotZombie'),
  ).length;
  const hunterZombiesKilled = statisticNumber(statistics, 'hunterZombiesKilled') ?? events.filter(
    (event) => event.type === 'unit_destroyed' && event.payload.unitType === 'hunterZombie',
  ).length;
  const hunterZombiesSpawned = statisticNumber(statistics, 'hunterZombiesSpawned') ?? 0;
  const hunterZombiesFinal = statisticNumber(statistics, 'hunterZombiesFinal') ?? Math.max(0, hunterZombiesSpawned - hunterZombiesKilled);
  const finalHordeSpawned = statisticNumber(statistics, 'finalHordeSpawned') ?? events
    .filter((event) => event.type === 'horde_spawned' && event.payload.hordeKind === 'final')
    .reduce((total, event) => total + eventPayloadNumber(event, 'count'), 0);
  const finalHordeKilled = statisticNumber(statistics, 'finalHordeKilled') ?? 0;
  const periodicHordeZombiesSpawned = statisticNumber(statistics, 'periodicHordeZombiesSpawned') ?? 0;
  const periodicNormalZombiesSpawned = statisticNumber(statistics, 'periodicNormalZombiesSpawned') ?? 0;
  const finalHordeZombiesSpawned = statisticNumber(statistics, 'finalHordeZombiesSpawned') ?? 0;
  const finalNormalZombiesSpawned = statisticNumber(statistics, 'finalNormalZombiesSpawned') ?? 0;
  const maxPopulationObservation = Math.max(...observations.map(populationAtObservation), 0);
  const maxOvercrowdingObservation = Math.max(...observations.map(overcrowdingAtObservation), 0);
  const maxAdditionalFood = Math.max(...observations.map((observation) => numberOrZero(observation.endTurnForecast.overcrowding.additionalFood)), 0);
  const maxAdditionalCivilianGoods = Math.max(...observations.map((observation) => numberOrZero(observation.endTurnForecast.overcrowding.additionalCivilianGoods)), 0);
  const maxPopulation = Math.max(statisticNumber(statistics, 'maxPopulation') ?? 0, maxPopulationObservation);
  // Retain only indices: a compressed/lazy history must not expand into one
  // full Observation per turn just to choose the last sample of each turn.
  const lastIndexByTurn = new Map<number, number>();
  for (let index = 0; index < observations.length; index += 1) lastIndexByTurn.set(observations[index]!.turn, index);
  const turnIndices = [...lastIndexByTurn].sort(([left], [right]) => left - right).map(([, index]) => index);
  const turnObservations = lazyArray(turnIndices.length, (index) => observations[turnIndices[index]!]!);
  const finalHordeDefeated = statisticBoolean(statistics, 'finalHordeDefeated')
    ?? finalObservation.victory.finalHordeDefeated;
  const maxVisibleZombies = Math.max(
    statisticNumber(statistics, 'maxVisibleZombies') ?? 0,
    ...observations.map((observation) => observation.zombies.length),
    0,
  );
  const finalHordeStarted = finalHordeSpawned > 0 || observations.some(
    (observation) => observation.horde.finalHordeStatus !== 'notStarted',
  );
  const turnsAfterFinalHorde = statisticNumber(statistics, 'turnsAfterFinalHorde')
    ?? (finalHordeStarted
      ? Math.max(0, finalObservation.turn - (input.config.horde.waves.find((wave) => wave.final)?.turn ?? finalObservation.turn))
      : 0);
  const suppliedAreaZombieClearTurn = statisticTurn(statistics, 'suppliedAreaZombieClearTurn')
    ?? firstTurnWhere(turnObservations, (observation) => observation.victory.suppliedAreaZombieClear);
  const suppliedAreaInfectionClearTurn = statisticTurn(statistics, 'suppliedAreaInfectionClearTurn')
    ?? firstTurnWhere(turnObservations, (observation) => observation.victory.suppliedAreaInfectionClear);
  const victoryTurn = statisticTurn(statistics, 'victoryTurn')
    ?? firstTurnWhere(turnObservations, (observation) => observation.gameOver && observation.result?.outcome === 'won');
  const terrainEntries = terrainEntriesByType(statistics);
  const urbanDefenseApplications = statisticNumber(statistics, 'urbanDefenseApplications') ?? 0;
  const urbanDefenseDamagePrevented = statisticNumber(statistics, 'urbanDefenseDamagePrevented') ?? 0;
  const forestDefenseApplications = statisticNumber(statistics, 'forestDefenseApplications') ?? 0;
  const forestDefenseDamagePrevented = statisticNumber(statistics, 'forestDefenseDamagePrevented') ?? 0;
  const normalZombieIdleCount = statisticNumber(statistics, 'normalZombieIdleCount') ?? events.filter(
    (event) => event.type === 'zombie_idle',
  ).length;
  const hordeTargetInheritedCount = statisticNumber(statistics, 'hordeTargetInheritedCount') ?? events.filter(
    (event) => event.type === 'horde_target_inherited',
  ).length;
  const hordeTargetClearedCount = statisticNumber(statistics, 'hordeTargetClearedCount') ?? events.filter(
    (event) => event.type === 'horde_target_cleared',
  ).length;
  const noisePulsesEmitted = statisticNumber(statistics, 'noisePulsesEmitted') ?? eventCount('noise_emitted');
  const policeNoisePulses = statisticNumber(statistics, 'policeNoisePulses') ?? events.filter(
    (event) => event.type === 'noise_emitted' && event.payload.sourceUnitType === 'police',
  ).length;
  const nationalGuardNoisePulses = statisticNumber(statistics, 'nationalGuardNoisePulses') ?? events.filter(
    (event) => event.type === 'noise_emitted' && event.payload.sourceUnitType === 'nationalGuard',
  ).length;
  const riotPoliceNoisePulses = statisticNumber(statistics, 'riotPoliceNoisePulses') ?? events.filter(
    (event) => event.type === 'noise_emitted' && event.payload.sourceUnitType === 'riotPolice',
  ).length;
  const noisePulsesBySourceType: Record<HumanUnitType | 'hordeZombie', number> = {
    police: policeNoisePulses,
    nationalGuard: nationalGuardNoisePulses,
    riotPolice: riotPoliceNoisePulses,
    hordeZombie: statisticNumber(statistics, 'hordeMovementNoisePulses') ?? events.filter(
      (event) => event.type === 'noise_emitted' && event.payload.sourceKind === 'hordeZombie',
    ).length,
  };
  const hordeMovementNoisePulses = statisticNumber(statistics, 'hordeMovementNoisePulses')
    ?? noisePulsesBySourceType.hordeZombie;
  const normalZombiesNoiseTargeted = statisticNumber(statistics, 'normalZombiesNoiseTargeted') ?? 0;
  const noiseTargetsReached = statisticNumber(statistics, 'noiseTargetsReached') ?? 0;
  const noiseTargetsOverriddenByHorde = statisticNumber(statistics, 'noiseTargetsOverriddenByHorde') ?? 0;
  const noiseTargetsOverriddenByVisiblePopulation = statisticNumber(
    statistics,
    'noiseTargetsOverriddenByVisiblePopulation',
  ) ?? 0;
  const combatNoiseByClass: Record<'medium' | 'large', number> = { medium: 0, large: 0 };
  for (const event of events.filter((candidate) => candidate.type === 'noise_emitted')) {
    if (event.payload.noiseClass === 'medium' || event.payload.noiseClass === 'large') {
      combatNoiseByClass[event.payload.noiseClass] += 1;
    }
  }
  const siteResolutionEvents = events.filter((event) =>
    event.type === 'site_fallen' || event.type === 'site_chain_fallen' || event.type === 'site_noise_respawn',
  );
  const countSiteEventsByType = (
    types: readonly string[],
    predicate: (event: AgentPublicEvent) => boolean = () => true,
  ): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const event of events.filter((candidate) => types.includes(candidate.type) && predicate(candidate))) {
      const key = `${String(event.payload.siteKind ?? 'unknown')}:${String(event.payload.siteType ?? 'unknown')}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };
  const siteFirstInfectionsByType = countSiteEventsByType(['site_infection_started']);
  const zombieOccupationCauses = new Set(['zombie_occupation', 'empty_zombie_occupation', 'spawn_immediate_occupation']);
  const siteFallsByType = countSiteEventsByType(
    ['site_fallen', 'site_chain_fallen'],
    (event) => !zombieOccupationCauses.has(String(event.payload.cause ?? '')),
  );
  const siteZombieOccupancyDestructionsByType = countSiteEventsByType(
    ['site_fallen', 'site_chain_fallen'],
    (event) => zombieOccupationCauses.has(String(event.payload.cause ?? '')),
  );
  const eventById = new Map(events.map((event) => [event.id, event] as const));
  const noiseSourceForEvent = (event: AgentPublicEvent): HumanUnitType | null => {
    const direct = event.payload.sourceUnitType;
    if (isHumanUnitType(direct)) return direct;
    const rootId = typeof event.payload.chainOriginEventId === 'string' ? event.payload.chainOriginEventId : null;
    const rootSource = rootId ? eventById.get(rootId)?.payload.sourceUnitType : null;
    return isHumanUnitType(rootSource) ? rootSource : null;
  };
  const noiseImmediateEvents = events.filter(
    (event) => event.type === 'site_immediate_infection' && noiseSourceForEvent(event) !== null,
  );
  const noiseChainEvents = events.filter(
    (event) => event.type === 'site_chain_fallen' && noiseSourceForEvent(event) !== null,
  );
  const chainOriginsByType: Record<string, number> = {};
  for (const event of events.filter((candidate) => candidate.type === 'site_chain_fallen')) {
    const rootId = typeof event.payload.chainOriginEventId === 'string' ? event.payload.chainOriginEventId : null;
    const root = rootId ? eventById.get(rootId) : undefined;
    const origin = root
      ? `${String(root.payload.siteKind ?? 'unknown')}:${String(root.payload.siteType ?? 'unknown')}`
      : 'unknown';
    chainOriginsByType[origin] = (chainOriginsByType[origin] ?? 0) + 1;
  }
  const groundVisionSamples = statisticNumber(statistics, 'groundVisionSamples') ?? 0;
  const cumulativeGroundVisionBlockedHexes = statisticNumber(statistics, 'cumulativeGroundVisionBlockedHexes') ?? 0;
  const infectedPopulationAtFall = siteResolutionEvents.reduce(
    (total, event) => total + eventPayloadNumber(event, 'infectedAtFall'),
    0,
  );
  const requestedSiteZombieSpawns = siteResolutionEvents.reduce(
    (total, event) => total + eventPayloadNumber(event, 'requestedSpawnCount'),
    0,
  );
  const actualSiteZombieSpawns = siteResolutionEvents.reduce(
    (total, event) => total + eventPayloadNumber(event, 'actualSpawnCount'),
    0,
  );
  const fallSiteZombieSpawns = siteResolutionEvents
    .filter((event) => event.type !== 'site_noise_respawn')
    .reduce((total, event) => total + eventPayloadNumber(event, 'actualSpawnCount'), 0);
  const noiseSiteZombieSpawns = siteResolutionEvents
    .filter((event) => event.type === 'site_noise_respawn')
    .reduce((total, event) => total + eventPayloadNumber(event, 'actualSpawnCount'), 0);
  let maxWorkersInSingleFacility = 0;
  for (const observation of observations) for (const facility of observation.facilities) {
    if (facility.type !== 'capital' && facility.type !== 'city') maxWorkersInSingleFacility = Math.max(maxWorkersInSingleFacility, facility.healthyPopulation);
  }
  const maxTotalProductionWorkers = Math.max(...turnObservations.map((observation) => observation.facilities
    .filter((facility) => facility.type !== 'capital' && facility.type !== 'city')
    .reduce((total, facility) => total + facility.healthyPopulation, 0)), 0);
  const highCapacityFacilityTurns = turnObservations.reduce((total, observation) => total + observation.facilities.filter(
    (facility) => facility.type !== 'capital' && facility.type !== 'city' && facility.healthyPopulation >= 26 && facility.healthyPopulation <= 30,
  ).length, 0);
  const powerPlantStoppedTurns = turnObservations.reduce((total, observation) => total + observation.facilities.filter(
    (facility) => facility.type === 'powerPlant' && facility.owner === 'player' && facility.healthyPopulation > 0 && facility.production.stoppedReason !== null,
  ).length, 0);
  const powerShortageTurns = turnObservations.reduce((total, observation) => total + (observation.endTurnForecast.electricity.shortage > 0 ? 1 : 0), 0);
  const poweredIndustrialFacilityTurns = turnObservations.reduce((total, observation) => total + observation.facilities.filter(
    (facility) => ['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type) && facility.production.projectedPowerSupplied,
  ).length, 0);
  const unpoweredCityTurns = turnObservations.reduce((total, observation) => total + observation.facilities.filter(
    (facility) => ['capital', 'city'].includes(facility.type) && facility.owner === 'player' && facility.healthyPopulation > 0 && !facility.production.projectedPowerSupplied,
  ).length, 0);
  const capturedFacilityTypes = new Map(input.initialObservation.facilities.map((facility) => [facility.id, facility.type]));
  const refineryFacilitiesCaptured = events.filter(
    (event) => event.type === 'facility_captured' && capturedFacilityTypes.get(String(event.payload.facilityId)) === 'refinery',
  ).length;
  const powerPlantFacilitiesCaptured = events.filter(
    (event) => event.type === 'facility_captured' && capturedFacilityTypes.get(String(event.payload.facilityId)) === 'powerPlant',
  ).length;

  const initialIds = new Set(input.initialObservation.units.map((unit) => unit.id));
  const allUnits = new Map<string, HumanUnitType>();
  for (const observation of observations) {
    for (const unit of observation.units) {
      if (isHumanUnitType(unit.type)) allUnits.set(unit.id, unit.type);
    }
  }
  const finalIds = new Set(finalObservation.units.map((unit) => unit.id));
  const countUnits = (type: HumanUnitType, predicate: (id: string) => boolean): number =>
    [...allUnits].filter(([id, unitType]) => unitType === type && predicate(id)).length;
  const policeInitial = countUnits('police', (id) => initialIds.has(id));
  const nationalGuardInitial = countUnits('nationalGuard', (id) => initialIds.has(id));
  const riotPoliceInitial = countUnits('riotPolice', (id) => initialIds.has(id));
  const policeProduced = countUnits('police', (id) => !initialIds.has(id));
  const nationalGuardProduced = countUnits('nationalGuard', (id) => !initialIds.has(id));
  const riotPoliceProduced = countUnits('riotPolice', (id) => !initialIds.has(id));
  const policeFinal = countUnits('police', (id) => finalIds.has(id));
  const nationalGuardFinal = countUnits('nationalGuard', (id) => finalIds.has(id));
  const riotPoliceFinal = countUnits('riotPolice', (id) => finalIds.has(id));
  const policeLosses = countUnits('police', (id) => !finalIds.has(id));
  const nationalGuardLosses = countUnits('nationalGuard', (id) => !finalIds.has(id));
  const riotPoliceLosses = countUnits('riotPolice', (id) => !finalIds.has(id));
  const survivalRate = (finalCount: number, initialCount: number, producedCount: number): number => {
    const denominator = initialCount + producedCount;
    return denominator > 0 ? finalCount / denominator : 0;
  };
  const recovery = (unitType: HumanUnitType, recoveryClass: 'combat' | 'rest') => {
    const matching = events.filter((event) =>
      event.type === 'unit_recovered' &&
      event.payload.unitType === unitType &&
      event.payload.recoveryClass === recoveryClass,
    );
    return {
      hp: matching.reduce((total, event) => total + eventPayloadNumber(event, 'actualAmount'), 0),
      count: matching.length,
    };
  };
  const policeCombatRecovery = recovery('police', 'combat');
  const policeRestRecovery = recovery('police', 'rest');
  const nationalGuardCombatRecovery = recovery('nationalGuard', 'combat');
  const nationalGuardRestRecovery = recovery('nationalGuard', 'rest');
  const riotPoliceCombatRecovery = recovery('riotPolice', 'combat');
  const riotPoliceRestRecovery = recovery('riotPolice', 'rest');
  const combatRecoverySelections = turnObservations.reduce((total, observation) => total + observation.units.filter(
    (unit) => unit.hp < unit.maxHp && unit.recoveryClassIfTurnEndsNow === 'combat',
  ).length, 0);
  const restRecoverySelections = turnObservations.reduce((total, observation) => total + observation.units.filter(
    (unit) => unit.hp < unit.maxHp && unit.recoveryClassIfTurnEndsNow === 'rest',
  ).length, 0);
  const outOfSupplyUnitLosses = events.filter((event) =>
    event.type === 'unit_destroyed' && event.payload.isPlayerUnit === true && event.payload.inSupply === false,
  ).length;
  const branchTurns: Record<CheckpointPolicy, number> = { passThrough: 0, normal: 0, strict: 0 };
  for (const observation of turnObservations) {
    for (const checkpoint of observation.checkpoints.filter(
      (candidate) => candidate.status === 'operational' && candidate.role === 'active',
    )) {
      branchTurns[checkpoint.currentPolicy] += 1;
    }
  }
  const totalBranchTurns = Object.values(branchTurns).reduce((total, value) => total + value, 0);
  const totalScreened = Object.values(refugeesScreenedByPolicy).reduce((total, value) => total + value, 0);
  const rate = (value: number, denominator: number): number => denominator > 0 ? value / denominator : 0;
  const finalSecuredFacilities = finalObservation.facilities.filter(
    (facility) => facility.owner === 'player' && facility.status === 'owned',
  ).length;
  const byHumanType = (): Record<HumanUnitType, number> => ({ police: 0, nationalGuard: 0, riotPolice: 0 });
  const statisticHumanRecord = (key: string): Record<HumanUnitType, number> => {
    const source = numericRecord(isRecord(statistics) ? statistics[key] : undefined);
    return Object.fromEntries(HUMAN_UNIT_TYPES.map((type) => [type, source[type] ?? 0])) as Record<HumanUnitType, number>;
  };
  const eventHumanRecord = (eventType: string, predicate: (event: AgentPublicEvent) => boolean = () => true): Record<HumanUnitType, number> => {
    const record = byHumanType();
    for (const event of events) {
      if (event.type !== eventType || !predicate(event)) continue;
      const type = event.payload.unitType;
      if (isHumanUnitType(type)) record[type] += 1;
    }
    return record;
  };
  const recruitsCommissionedByType = Object.keys(isRecord(statistics) ? statistics.recruitsCommissionedByType ?? {} : {}).length > 0
    ? statisticHumanRecord('recruitsCommissionedByType')
    : eventHumanRecord('riot_police_commissioned');
  // The legacy Core emits the generic production event; use it when available.
  for (const event of events) {
    if ((event.type as string) !== 'unit_produced' && (event.type as string) !== 'unit_created') continue;
    const type = event.payload.unitType;
    if (isHumanUnitType(type)) recruitsCommissionedByType[type] += 1;
  }
  const regularPromotionsByType = Object.keys(isRecord(statistics) ? statistics.regularPromotionsByType ?? {} : {}).length > 0
    ? statisticHumanRecord('regularPromotionsByType')
    : eventHumanRecord('unit_promoted', (event) => event.payload.into === 'regular');
  const veteranPromotionsByType = Object.keys(isRecord(statistics) ? statistics.veteranPromotionsByType ?? {} : {}).length > 0
    ? statisticHumanRecord('veteranPromotionsByType')
    : eventHumanRecord('unit_promoted', (event) => event.payload.into === 'veteran');
  const veteranZombieKillsByType = Object.keys(isRecord(statistics) ? statistics.veteranZombieKillsByType ?? {} : {}).length > 0
    ? statisticHumanRecord('veteranZombieKillsByType')
    : eventHumanRecord('unit_kill_credited', (event) => event.payload.proficiency === 'veteran');
  const humanHexesMovedByType = byHumanType();
  const maxSingleMoveDistanceByType = byHumanType();
  const longMoves6PlusByType = byHumanType();
  const unitFuelConsumedByType = byHumanType();
  const unitFuelRefilledByType = byHumanType();
  const commissioningFuelByType = byHumanType();
  const fixedMilitaryGoodsConsumedByType = byHumanType();
  const attackMilitaryGoodsConsumedByType = byHumanType();
  const counterattackMilitaryGoodsConsumedByType = byHumanType();
  const interceptionMilitaryGoodsConsumedByType = byHumanType();
  const suppressionMilitaryGoodsConsumedByType = byHumanType();
  const militaryGoodsRefilledByType = byHumanType();
  const unfilledMilitaryGoodsRefillByType = byHumanType();
  const militaryGoodsLostOnDestructionByType = byHumanType();
  const zeroMilitaryGoodsWeakAttacksByType = byHumanType();
  const emergencyMovesByType = byHumanType();
  const emergencyMovementHexesByType = byHumanType();
  const emergencyMovementPointsByType = byHumanType();
  const emergencyReturnsToSupplyByType = byHumanType();
  const nationalGuardAttacksByRange = { range1: 0, range2: 0 };
  const nationalGuardMilitaryGoodsConsumedByRange = { range1: 0, range2: 0 };
  const humanUnitTypeById = new Map<string, HumanUnitType>();
  for (const observation of observations) {
    for (const unit of observation.units) {
      if (isHumanUnitType(unit.type)) humanUnitTypeById.set(unit.id, unit.type);
    }
  }
  for (let index = 1; index < observations.length; index += 1) {
    const before = observations[index - 1]!;
    const after = observations[index]!;
    const action = input.actions[index - 1];
    const previousUnits = new Map(before.units.map((unit) => [unit.id, unit] as const));
    for (const unit of after.units) {
      if (!isHumanUnitType(unit.type)) continue;
      const previous = previousUnits.get(unit.id);
      if (!previous) {
        commissioningFuelByType[unit.type] += unit.currentFuel;
        continue;
      }
      if (action?.type === 'Move' && action.unitId === unit.id) {
        const distance = hexDistance(previous.position, unit.position);
        humanHexesMovedByType[unit.type] += distance;
        maxSingleMoveDistanceByType[unit.type] = Math.max(maxSingleMoveDistanceByType[unit.type], distance);
        if (distance >= 6) longMoves6PlusByType[unit.type] += 1;
        unitFuelConsumedByType[unit.type] += Math.max(0, previous.currentFuel - unit.currentFuel);
      }
      if (action?.type === 'EndTurn') {
        unitFuelRefilledByType[unit.type] += Math.max(0, unit.currentFuel - previous.currentFuel);
      }
    }
  }
  const turnsUnitsEndedOutOfSupplyByType = byHumanType();
  let unitsUnableToMoveForFuel = 0;
  let fuelShortageTurns = 0;
  let windPowerGenerated = 0;
  let windDisabledTurns = 0;
  let simpleFarmFoodProduced = 0;
  let maxDroneVisionRadius = 0;
  let guaranteedDefeatWarnings = 0;
  let militaryGoodsRefillShortageTurns = 0;
  const resourceSinglePointFailureTurnsByResource: Record<string, number> = {
    food: 0, civilianGoods: 0, militaryGoods: 0, fuel: 0, electricity: 0,
  };
  const checkpointQueuePressureTurnsByClass: Record<'none' | 'low' | 'medium' | 'high', number> = {
    none: 0, low: 0, medium: 0, high: 0,
  };
  for (const observation of turnObservations) {
    for (const unit of observation.units) {
      if (!isHumanUnitType(unit.type)) continue;
      if (!unit.inSupply) turnsUnitsEndedOutOfSupplyByType[unit.type] += 1;
      if (unit.canMove && unit.currentFuel === 0 && unit.fuelCostByLegalMove.length === 0) unitsUnableToMoveForFuel += 1;
    }
    if (observation.endTurnForecast.fuel.totalFuelShortage > 0) fuelShortageTurns += 1;
    if (observation.endTurnForecast.militaryGoods.totalUnfilledRefillDemand > 0) militaryGoodsRefillShortageTurns += 1;
    for (const unit of observation.endTurnForecast.militaryGoods.units) {
      unfilledMilitaryGoodsRefillByType[unit.unitType] += unit.unfilledRefillDemand;
    }
    windPowerGenerated += observation.endTurnForecast.fuel.windPowerAvailable;
    windDisabledTurns += observation.facilities.filter(
      (facility) => facility.type === 'windPowerPlant' && facility.operationalStatus === 'disabled',
    ).length;
    simpleFarmFoodProduced += observation.facilities
      .filter((facility) => facility.type === 'simpleFarm')
      .reduce((total, facility) => total + numberOrZero(facility.production.projectedProduction.food), 0);
    maxDroneVisionRadius = Math.max(
      maxDroneVisionRadius,
      ...observation.facilities
        .filter((facility) => facility.type === 'civilianDroneBase')
        .map((facility) => facility.vision),
      0,
    );
    if (observation.strategicForecast.guaranteedDefeat.guaranteed) guaranteedDefeatWarnings += 1;
    for (const [resource, dependency] of Object.entries(observation.strategicForecast.resources)) {
      if (dependency.singlePointOfFailure) resourceSinglePointFailureTurnsByResource[resource] += 1;
    }
    for (const checkpoint of observation.checkpoints) {
      checkpointQueuePressureTurnsByClass[checkpoint.queuePressureClass] += 1;
    }
  }
  const stateFuelSpentOnPower = events
    .filter((event) => event.type === 'resource_consumed' && event.payload.resource === 'fuel' && event.payload.reason === 'power_generation')
    .reduce((total, event) => total + eventPayloadNumber(event, 'amount'), 0);
  const stateFuelSpentOnUnits = events
    .filter((event) => event.type === 'resource_consumed' && event.payload.resource === 'fuel' && event.payload.reason === 'unit_refill')
    .reduce((total, event) => total + eventPayloadNumber(event, 'amount'), 0);
  for (const event of events) {
    const unitTypeValue = typeof event.payload.unitType === 'string'
      ? event.payload.unitType
      : typeof event.payload.attackerId === 'string'
        ? humanUnitTypeById.get(event.payload.attackerId)
        : undefined;
    const unitType = isHumanUnitType(unitTypeValue) ? unitTypeValue : null;
    if (!unitType) continue;
    const militaryGoodsCost = eventPayloadNumber(event, 'militaryGoodsCost');
    if (event.type === 'resource_consumed' && event.payload.resource === 'militaryGoods') {
      if (event.payload.reason === 'unit_fixed_upkeep') fixedMilitaryGoodsConsumedByType[unitType] += eventPayloadNumber(event, 'amount');
      if (event.payload.reason === 'unit_refill') militaryGoodsRefilledByType[unitType] += eventPayloadNumber(event, 'amount');
    } else if (event.type === 'infection_suppressed') {
      suppressionMilitaryGoodsConsumedByType[unitType] += militaryGoodsCost;
    } else if (event.type === 'attack' || event.type === 'interception') {
      if (event.type === 'interception') interceptionMilitaryGoodsConsumedByType[unitType] += militaryGoodsCost;
      else if (event.payload.counterattack === true) counterattackMilitaryGoodsConsumedByType[unitType] += militaryGoodsCost;
      else attackMilitaryGoodsConsumedByType[unitType] += militaryGoodsCost;
      const effectiveAttack = eventPayloadNumber(event, 'effectiveAttack');
      const configuredRecruitAttack = (input.config.units[unitType] as unknown as Record<string, unknown>).recruitAttack;
      const configuredAttack = typeof configuredRecruitAttack === 'number'
        ? configuredRecruitAttack
        : numberOrZero((input.config.units[unitType] as unknown as Record<string, unknown>).attack);
      if (militaryGoodsCost === 0 && effectiveAttack < configuredAttack) {
        zeroMilitaryGoodsWeakAttacksByType[unitType] += 1;
      }
      if (unitType === 'nationalGuard') {
        const rangeKey = eventPayloadNumber(event, 'distance') >= 2 ? 'range2' : 'range1';
        nationalGuardAttacksByRange[rangeKey] += 1;
        nationalGuardMilitaryGoodsConsumedByRange[rangeKey] += militaryGoodsCost;
      }
    } else if (event.type === 'unit_destroyed') {
      militaryGoodsLostOnDestructionByType[unitType] += eventPayloadNumber(event, 'lostMilitaryGoods');
    } else if (event.type === 'unit_moved' && event.payload.movementMode === 'emergency') {
      emergencyMovesByType[unitType] += 1;
      emergencyMovementHexesByType[unitType] += eventPayloadNumber(event, 'hexesMoved');
      emergencyMovementPointsByType[unitType] += eventPayloadNumber(event, 'effectiveMovementCost');
      const destinationKey = `${String(event.payload.q)},${String(event.payload.r)}`;
      const indexAtTurn = lastIndexByTurn.get(event.turn);
      const observationAtTurn = indexAtTurn === undefined ? undefined : observations[indexAtTurn];
      if (observationAtTurn?.supply.suppliedTileKeys.includes(destinationKey)) emergencyReturnsToSupplyByType[unitType] += 1;
    }
  }
  const constructed = (type: 'simpleFarm' | 'civilianDroneBase') => events.filter(
    (event) => event.type === 'constructible_built' && event.payload.facilityType === type,
  ).length;
  const facilityTypesById = new Map<string, string>();
  for (const observation of observations) {
    for (const facility of observation.facilities) facilityTypesById.set(facility.id, facility.type);
  }
  const destroyed = (type: 'simpleFarm' | 'civilianDroneBase') => events.filter(
    (event) => event.type === 'facility_overrun' && facilityTypesById.get(String(event.payload.facilityId)) === type,
  ).length;
  const constructibleFacilityOverruns = events.filter(
    (event) => event.type === 'facility_overrun' && ['simpleFarm', 'civilianDroneBase'].includes(facilityTypesById.get(String(event.payload.facilityId)) ?? ''),
  ).length;
  const windOverruns = events.filter(
    (event) => event.type === 'facility_disabled' && facilityTypesById.get(String(event.payload.facilityId)) === 'windPowerPlant',
  ).length;
  const windRecoveries = events.filter(
    (event) => event.type === 'facility_recovered' && facilityTypesById.get(String(event.payload.facilityId)) === 'windPowerPlant',
  ).length;
  const constructibleBuildRejectedByReason: Record<string, number> = {};
  for (const attempt of input.invalidAttempts ?? []) {
    if (!attempt.error.code.startsWith('constructible_') && attempt.error.code !== 'invalid_constructible_facility_type') continue;
    constructibleBuildRejectedByReason[attempt.error.code] = (constructibleBuildRejectedByReason[attempt.error.code] ?? 0) + 1;
  }
  const guaranteedDefeatIgnored = input.actions.reduce((total, action, index) =>
    total + (action.type === 'EndTurn' && observations[index]?.strategicForecast.guaranteedDefeat.guaranteed ? 1 : 0),
  0);
  const checkpointMovesWithNoSupplyGain = input.actions.reduce((total, action, index) => {
    if (!['BuildCheckpoint', 'RelocateCheckpoint', 'ActivateCheckpoint'].includes(action.type)) return total;
    const candidates = observations[index]?.checkpointPositionCandidates ?? [];
    const candidate = candidates.find((entry) =>
      entry.actionType === action.type &&
      entry.branchId === action.branchId &&
      (action.type === 'ActivateCheckpoint' ||
        (entry.position.q === action.position.q && entry.position.r === action.position.r)) &&
      (action.type !== 'RelocateCheckpoint' || entry.checkpointId === action.checkpointId) &&
      (action.type !== 'ActivateCheckpoint' || entry.checkpointId === action.checkpointId),
    );
    return total + (candidate &&
      candidate.projectedBranchRadius === candidate.currentBranchRadius &&
      candidate.suppliedFacilityDelta === 0 &&
      candidate.newlyBuildableConstructibleHexCount === 0
      ? 1 : 0);
  }, 0);

  const powerTurnsByFacilityType: Record<string, FacilityPowerMetric> = Object.fromEntries(
    FACILITY_TYPES.map((type) => [type, zeroPowerMetric()]),
  );
  const powerRequestedTurnsByFacilityType: Record<string, number> = makeCountRecord(FACILITY_TYPES);
  const powerSuppliedTurnsByFacilityType: Record<string, number> = makeCountRecord(FACILITY_TYPES);
  const powerUnavailableTurnsByFacilityType: Record<string, number> = makeCountRecord(FACILITY_TYPES);
  const powerSupplyOffTurnsByFacilityType: Record<string, number> = makeCountRecord(FACILITY_TYPES);
  const powerResourceLossByResource = zeroResourceRecord();
  const refineryOutageTurns = new Set<number>();
  let simpleFarmFoodShortageAvoidanceTurns = 0;
  const checkpointBatchStartsByPolicy: Record<CheckpointPolicy, number> = {
    passThrough: 0, normal: 0, strict: 0,
  };
  const checkpointBatchCompletionsByPolicy: Record<CheckpointPolicy, number> = {
    passThrough: 0, normal: 0, strict: 0,
  };
  let checkpointQueueSamples = 0;
  let checkpointQueueTotal = 0;
  let checkpointCapacityUtilizationTotal = 0;
  let checkpointThroughputTotal = 0;
  let checkpointThroughputSamples = 0;
  const previousScreening = new Map<string, number>();
  for (const observation of observations) {
    for (const facility of observation.facilities) {
      const type = facility.type;
      if (!powerTurnsByFacilityType[type]) powerTurnsByFacilityType[type] = zeroPowerMetric();
      if (!powerRequestedTurnsByFacilityType[type]) powerRequestedTurnsByFacilityType[type] = 0;
      if (!powerSuppliedTurnsByFacilityType[type]) powerSuppliedTurnsByFacilityType[type] = 0;
      if (!powerUnavailableTurnsByFacilityType[type]) powerUnavailableTurnsByFacilityType[type] = 0;
      if (!powerSupplyOffTurnsByFacilityType[type]) powerSupplyOffTurnsByFacilityType[type] = 0;
      if (facility.production.powerMode === 'required') {
        const metric = powerTurnsByFacilityType[type]!;
        const requested = facility.production.projectedPowerRequested;
        const supplied = facility.production.projectedPowerSupplied;
        const off = facility.production.projectedPowerReason === 'power_supply_off'
          || (!facility.production.powerSupplyEnabled && facility.production.projectedPowerReason !== 'not_applicable');
        const unavailable = requested && !supplied;
        if (requested) {
          metric.requested += 1;
          powerRequestedTurnsByFacilityType[type] += 1;
        }
        if (supplied) {
          metric.supplied += 1;
          powerSuppliedTurnsByFacilityType[type] += 1;
        }
        if (unavailable) {
          metric.unavailable += 1;
          powerUnavailableTurnsByFacilityType[type] += 1;
        }
        if (off) {
          metric.off += 1;
          powerSupplyOffTurnsByFacilityType[type] += 1;
        }
        if ((requested || off) && !supplied) {
          for (const resource of RESOURCE_TYPES) {
            powerResourceLossByResource[resource] += numberOrZero(facility.production.baseProduction[resource]);
          }
        }
        if (type === 'refinery' && (requested || off) && !supplied) refineryOutageTurns.add(observation.turn);
      }
      if (type === 'simpleFarm' && numberOrZero(facility.production.projectedProduction.food) > 0
        && observation.endTurnForecast.food.shortage <= 0) {
        simpleFarmFoodShortageAvoidanceTurns += 1;
      }
    }
    for (const checkpoint of observation.checkpoints) {
      const queue = Math.max(0, numberOrZero(checkpoint.queuePeople));
      const capacity = Math.max(0, numberOrZero(checkpoint.screeningCapacity));
      checkpointQueueSamples += 1;
      checkpointQueueTotal += queue;
      checkpointCapacityUtilizationTotal += capacity > 0 ? Math.min(1, queue / capacity) : 0;
      checkpointThroughputTotal += numberOrZero(checkpoint.estimatedScreeningThroughput);
      checkpointThroughputSamples += 1;
      const priorScreening = previousScreening.get(checkpoint.id) ?? 0;
      if (priorScreening <= 0 && checkpoint.screening > 0) {
        const policy = checkpoint.currentPolicy;
        checkpointBatchStartsByPolicy[policy] += checkpoint.screening;
      }
      previousScreening.set(checkpoint.id, checkpoint.screening);
    }
  }
  for (const event of events.filter((candidate) => candidate.type === 'refugees_screened')) {
    const policy = event.payload.policy;
    if (policy === 'passThrough' || policy === 'normal' || policy === 'strict') {
      checkpointBatchCompletionsByPolicy[policy] += eventPayloadNumber(event, 'screened');
    }
  }
  const refineryPowerOutageTurns = refineryOutageTurns.size;
  const refineryOutageNextTurnFuelShortageTurns = [...refineryOutageTurns].filter((turn) => {
    const next = turnObservations.find((observation) => observation.turn === turn + 1);
    return next !== undefined && next.endTurnForecast.fuel.totalFuelShortage > 0;
  }).length;
  const hordeDirectionSpawnCounts = zeroDirectionMetric();
  const hordeDirectionKillCounts = zeroDirectionMetric();
  const hordeSpawnEvents = events.filter((event) =>
    event.type === 'horde_spawned' && Number.isSafeInteger(event.payload.waveIndex),
  );
  const specialRecordFromStatistics = (
    key: string,
  ): Record<'policeZombie' | 'soldierZombie' | 'riotZombie' | 'hunterZombie', number> => {
    const source = numericRecord(isRecord(statistics) ? statistics[key] : undefined);
    return Object.fromEntries(SPECIAL_ZOMBIE_TYPES.map((type) => [type, source[type] ?? 0])) as Record<typeof SPECIAL_ZOMBIE_TYPES[number], number>;
  };
  const specialRecordFromEvents = (
    predicate: (event: AgentPublicEvent) => boolean,
  ): Record<'policeZombie' | 'soldierZombie' | 'riotZombie' | 'hunterZombie', number> => {
    const result = Object.fromEntries(SPECIAL_ZOMBIE_TYPES.map((type) => [type, 0])) as Record<typeof SPECIAL_ZOMBIE_TYPES[number], number>;
    for (const event of events) {
      if (!predicate(event)) continue;
      if (Array.isArray(event.payload.units)) {
        for (const unit of event.payload.units) {
          if (!isRecord(unit)) continue;
          const type = unit.unitType;
          if (SPECIAL_ZOMBIE_TYPES.includes(type as typeof SPECIAL_ZOMBIE_TYPES[number])) {
            result[type as typeof SPECIAL_ZOMBIE_TYPES[number]] += 1;
          }
        }
        continue;
      }
      const type = event.payload.unitType;
      if (SPECIAL_ZOMBIE_TYPES.includes(type as typeof SPECIAL_ZOMBIE_TYPES[number])) {
        result[type as typeof SPECIAL_ZOMBIE_TYPES[number]] += 1;
      }
    }
    return result;
  };
  const statHordeSpecialSpawned = specialRecordFromStatistics('hordeSpecialSpawnedByType');
  const eventHordeSpecialSpawned = specialRecordFromEvents((event) => event.type === 'horde_spawned');
  const hordeSpecialSpawnedByType = Object.fromEntries(SPECIAL_ZOMBIE_TYPES.map((type) => [
    type,
    statHordeSpecialSpawned[type] > 0 ? statHordeSpecialSpawned[type] : eventHordeSpecialSpawned[type],
  ])) as Record<typeof SPECIAL_ZOMBIE_TYPES[number], number>;
  const statHordeNoiseRespawned = (() => {
    const source = numericRecord(isRecord(statistics) ? statistics.hordeNoiseRespawnedByType : undefined);
    return Object.fromEntries(ZOMBIE_TYPES.map((type) => [type, source[type] ?? 0])) as Record<typeof ZOMBIE_TYPES[number], number>;
  })();
  const eventHordeNoiseRespawned = (() => {
    const result = Object.fromEntries(ZOMBIE_TYPES.map((type) => [type, 0])) as Record<typeof ZOMBIE_TYPES[number], number>;
    for (const event of events) {
      if (event.type !== 'site_noise_respawn') continue;
      const type = event.payload.spawnedUnitType;
      if (isZombieType(type)) result[type] += Math.max(0, eventPayloadNumber(event, 'actualSpawnCount'));
    }
    return result;
  })();
  const hordeNoiseRespawnedByType = Object.fromEntries(ZOMBIE_TYPES.map((type) => [
    type,
    statHordeNoiseRespawned[type] > 0 ? statHordeNoiseRespawned[type] : eventHordeNoiseRespawned[type],
  ])) as Record<typeof ZOMBIE_TYPES[number], number>;
  const hordeWaves: HordeWaveMetric[] = input.config.horde.waves.map((wave, index) => {
    const waveIndex = index + 1;
    const event = hordeSpawnEvents.find((candidate) => candidate.payload.waveIndex === waveIndex);
    const directions = Array.isArray(event?.payload.directions)
      ? event!.payload.directions.filter((direction): direction is CardinalDirection => CARDINAL_DIRECTIONS.includes(direction as CardinalDirection))
      : [];
    const composition = isRecord((wave as unknown as Record<string, unknown>).compositionPerDirection)
      ? (wave as unknown as Record<string, unknown>).compositionPerDirection as Record<string, unknown>
      : {};
    const baseComposition = {
      hordeZombie: numberOrZero(composition.hordeZombie),
      zombie: numberOrZero(composition.zombie),
      ...(numberOrZero(composition.policeZombie) > 0 ? { policeZombie: numberOrZero(composition.policeZombie) } : {}),
      ...(numberOrZero(composition.soldierZombie) > 0 ? { soldierZombie: numberOrZero(composition.soldierZombie) } : {}),
      ...(numberOrZero(composition.hunterZombie) > 0 ? { hunterZombie: numberOrZero(composition.hunterZombie) } : {}),
      ...(numberOrZero(composition.riotZombie) > 0 ? { riotZombie: numberOrZero(composition.riotZombie) } : {}),
    };
    const eventUnits = Array.isArray(event?.payload.units) ? event?.payload.units : [];
    const spawnedByType = Object.fromEntries(ZOMBIE_TYPES.map((type) => [type, eventUnits.filter((unit) =>
      isRecord(unit) && unit.unitType === type,
    ).length])) as Record<typeof ZOMBIE_TYPES[number], number>;
    const hordeZombieSpawned = numberOrZero(event?.payload.hordeZombieCount)
      || (event ? directions.length * baseComposition.hordeZombie : 0);
    const normalZombieSpawned = numberOrZero(event?.payload.normalZombieCount)
      || (event ? directions.length * baseComposition.zombie : 0);
    const specialZombieSpawnedByType = Object.fromEntries(SPECIAL_ZOMBIE_TYPES.map((type) => [
      type,
      numberOrZero((isRecord(event?.payload.specialZombieSpawnedByType) ? event?.payload.specialZombieSpawnedByType : {})[type])
        || spawnedByType[type],
    ])) as Record<typeof SPECIAL_ZOMBIE_TYPES[number], number>;
    const specialZombieKilledByType = Object.fromEntries(SPECIAL_ZOMBIE_TYPES.map((type) => [
      type,
      events.filter((candidate) => candidate.type === 'unit_destroyed'
        && candidate.payload.unitType === type
        && candidate.payload.waveIndex === waveIndex).length,
    ])) as Record<typeof SPECIAL_ZOMBIE_TYPES[number], number>;
    const waveRecord = wave as unknown as Record<string, unknown>;
    const nonHordeSlotCountPerDirection = numberOrZero(
      waveRecord.nonHordeSlotCountPerDirection ?? waveRecord.nonHordeSlotsPerDirection,
    ) || (baseComposition.zombie > 0 ? baseComposition.zombie : undefined);
    const possibleNonHordeTypes = Array.isArray(waveRecord.possibleNonHordeTypes)
      ? waveRecord.possibleNonHordeTypes.filter((type): type is string => typeof type === 'string')
      : undefined;
    const hordeZombieKilled = events.filter((candidate) => candidate.type === 'unit_destroyed'
      && candidate.payload.unitType === 'hordeZombie'
      && candidate.payload.waveIndex === waveIndex).reduce((total, candidate) => total + 1, 0);
    const normalZombieKilled = events.filter((candidate) => candidate.type === 'unit_destroyed'
      && candidate.payload.unitType === 'zombie'
      && candidate.payload.waveIndex === waveIndex).reduce((total, candidate) => total + 1, 0);
    for (const direction of directions) {
      hordeDirectionSpawnCounts[direction].hordeZombie += baseComposition.hordeZombie;
      hordeDirectionSpawnCounts[direction].normalZombie += nonHordeSlotCountPerDirection ?? baseComposition.zombie;
    }
    return {
      index: waveIndex,
      spawnTurn: wave.turn,
      directions,
      compositionPerDirection: baseComposition,
      ...(nonHordeSlotCountPerDirection === undefined ? {} : { nonHordeSlotCountPerDirection }),
      ...(possibleNonHordeTypes === undefined ? {} : { possibleNonHordeTypes }),
      specialZombieSpawnedByType,
      specialZombieKilledByType,
      final: wave.final,
      hordeZombieSpawned,
      normalZombieSpawned,
      hordeZombieKilled,
      normalZombieKilled,
    };
  });
  for (const event of events.filter((candidate) => candidate.type === 'unit_destroyed')) {
    const direction = event.payload.direction;
    const unitType = event.payload.unitType;
    if (!CARDINAL_DIRECTIONS.includes(direction as CardinalDirection)) continue;
    if (unitType === 'hordeZombie') hordeDirectionKillCounts[direction as CardinalDirection].hordeZombie += 1;
    if (unitType === 'zombie') hordeDirectionKillCounts[direction as CardinalDirection].normalZombie += 1;
  }
  const finalWaveMetric = hordeWaves.find((wave) => wave.final);
  const specialZombieTotal = (counts: Readonly<Record<string, number>> | undefined): number =>
    Object.values(counts ?? {}).reduce((total, count) => total + Math.max(0, numberOrZero(count)), 0);
  const hordeFinalWaveSpawnTotal = finalWaveMetric
    ? finalWaveMetric.hordeZombieSpawned + finalWaveMetric.normalZombieSpawned
      + specialZombieTotal(finalWaveMetric.specialZombieSpawnedByType)
    : finalHordeSpawned;
  const hordeFinalWaveKillTotal = finalWaveMetric
    ? finalWaveMetric.hordeZombieKilled + finalWaveMetric.normalZombieKilled
      + specialZombieTotal(finalWaveMetric.specialZombieKilledByType)
    : finalHordeKilled;
  const hordeFinalDefeatedTurn = firstTurnWhere(turnObservations, (observation) => observation.victory.finalHordeDefeated);
  const multiFrontTurns = new Set<number>();
  for (const observation of turnObservations) {
    if (observation.horde.warningDirections.length > 1 || (observation.horde.nextWave?.directionCount ?? 0) > 1) multiFrontTurns.add(observation.turn);
  }
  const hordeMultiFrontCheckpointLosses = events.filter((event) =>
    (event.type === 'checkpoint_removed' || event.type === 'facility_overrun')
    && multiFrontTurns.has(event.turn),
  ).length;
  const hordeMultiFrontFallbacks = events.filter((event) =>
    event.type === 'checkpoint_fallback' && multiFrontTurns.has(event.turn),
  ).length;
  const riotZombiesFinal = statisticNumber(statistics, 'riotZombiesFinal')
    ?? Math.max(0, riotZombiesSpawned - riotZombiesKilled);
  const unusedAttackChargesByTurn = input.actions.reduce((total, action, index) => {
    if (action.type !== 'EndTurn') return total;
    const observation = observations[index];
    return total + (observation?.units
      .filter((unit) => isHumanUnitType(unit.type))
      .reduce((sum, unit) => sum + Math.max(0, unit.attackChargesRemaining), 0) ?? 0);
  }, 0);
  const criticalInfectionAlertUnresolvedTurns = input.actions.reduce((total, action, index) => {
    if (action.type !== 'EndTurn') return total;
    const observation = observations[index];
    const criticalInfection = observation?.crisisSummary?.alerts?.some((alert) =>
      alert.severity === 'critical' && alert.category === 'infection',
    ) ?? false;
    if (!criticalInfection) return total;
    const turn = observation?.turn;
    const suppressed = turn !== undefined && events.some((event) =>
      event.turn === turn && event.type === 'infection_suppressed',
    );
    return total + (suppressed ? 0 : 1);
  }, 0);
  const outcome: MetricOutcome = input.failure
    ? 'technical_failure'
    : input.limitReached
      ? 'limit_reached'
      : input.result?.outcome ?? 'technical_failure';
  const limitReached = outcome === 'limit_reached';
  const gameOverReason = input.failure || limitReached ? null : input.result?.reason ?? null;

  return {
    appVersion: input.appVersion ?? APP_VERSION,
    gameRulesVersion: input.gameRulesVersion ?? input.initialObservation.gameRulesVersion,
    agentId: input.agent.id,
    agentVersion: input.agent.version,
    strategy: input.agent.strategy ?? input.agent.id,
    agentApiVersion: input.agentApiVersion ?? AGENT_API_VERSION,
    observationApiVersion: input.observationApiVersion ?? input.initialObservation.apiVersion ?? OBSERVATION_API_VERSION,
    bridgeApiVersion: input.bridgeApiVersion ?? BRIDGE_API_VERSION,
    buildId: input.buildId ?? 'local-unknown',
    mapId: input.initialObservation.map.id,
    seed: input.seed ?? 0,
    config: cloneConfig(input.config),
    outcome,
    limitReached,
    gameOverReason,
    finalTurn: numberOrZero(finalObservation.turn),
    totalAgentDecisions: input.totalAgentDecisions ?? input.actions.length + numberOrZero(input.invalidAttemptCount),
    acceptedActionCount: input.actions.length,
    invalidAttemptCount: numberOrZero(input.invalidAttemptCount),
    actionCounts,
    priorityGoalCounts,
    initialPopulation: populationAtObservation(input.initialObservation),
    finalHealthyCivilianPopulation: numberOrZero(finalObservation.population.healthyCivilians),
    maxPopulation,
    civilianLosses: statisticNumber(statistics, 'civilianLosses') ?? 0,
    infectionLosses: statisticNumber(statistics, 'infectionLosses') ?? 0,
    resourceShortageLosses: statisticNumber(statistics, 'resourceShortageLosses') ?? 0,
    refugeesAccepted,
    refugeeArrivalsByBranch,
    totalRefugeeArrivals,
    unmanagedPassThrough: statisticNumber(statistics, 'unmanagedPassThrough') ?? events
      .filter((event) => event.type === 'refugees_arrived' && event.payload.unmanaged === true)
      .reduce((total, event) => total + eventPayloadNumber(event, 'people'), 0),
    refugeesScreenedByPolicy,
    refugeesDeparted,
    checkpointsBuilt,
    checkpointsRelocated,
    checkpointRetreats,
    checkpointsRuined,
    checkpointsRecovered,
    checkpointsAbandoned,
    checkpointsRemoved,
    standbyCheckpointsCreated,
    dormantCheckpointsCreated,
    checkpointActivations,
    checkpointFallbacks,
    checkpointFallbacksByBranch,
    checkpointFallbacksFromStandby,
    checkpointFallbacksFromDormant,
    checkpointFallbacksPreventingUnmanagedArrival,
    maxCheckpointPostsPerBranch,
    maxPreparedCheckpointPostsPerBranch,
    activeCheckpointLosses,
    unmanagedBranchTurns,
    maxSuppliedFacilities,
    maxSupplyRadius,
    supplyLosses,
    supplyRejections,
    maxOvercrowding: maxOvercrowdingObservation,
    maxOvercrowdingAdditionalFood: maxAdditionalFood,
    maxOvercrowdingAdditionalCivilianGoods: maxAdditionalCivilianGoods,
    facilitiesCaptured: events.filter((event) => event.type === 'facility_captured').length,
    facilitiesLost: events.filter((event) => event.type === 'facility_overrun' && typeof event.payload.facilityId === 'string').length,
    finalSecuredFacilities,
    policeProduced,
    nationalGuardProduced,
    riotPoliceProduced,
    policeInitial,
    nationalGuardInitial,
    riotPoliceInitial,
    policeLosses,
    nationalGuardLosses,
    riotPoliceLosses,
    policeFinal,
    nationalGuardFinal,
    riotPoliceFinal,
    policeSurvivalRate: survivalRate(policeFinal, policeInitial, policeProduced),
    nationalGuardSurvivalRate: survivalRate(nationalGuardFinal, nationalGuardInitial, nationalGuardProduced),
    riotPoliceSurvivalRate: survivalRate(riotPoliceFinal, riotPoliceInitial, riotPoliceProduced),
    outOfSupplyUnitLosses,
    policeCombatRecoveryHp: policeCombatRecovery.hp,
    policeCombatRecoveryCount: policeCombatRecovery.count,
    policeRestRecoveryHp: policeRestRecovery.hp,
    policeRestRecoveryCount: policeRestRecovery.count,
    nationalGuardCombatRecoveryHp: nationalGuardCombatRecovery.hp,
    nationalGuardCombatRecoveryCount: nationalGuardCombatRecovery.count,
    nationalGuardRestRecoveryHp: nationalGuardRestRecovery.hp,
    nationalGuardRestRecoveryCount: nationalGuardRestRecovery.count,
    combatRecoverySelections,
    restRecoverySelections,
    maxWorkersInSingleFacility,
    maxTotalProductionWorkers,
    highCapacityFacilityTurns,
    powerPlantStoppedTurns,
    powerShortageTurns,
    poweredIndustrialFacilityTurns,
    unpoweredCityTurns,
    refineryFacilitiesCaptured,
    powerPlantFacilitiesCaptured,
    checkpointPassThroughBranchTurns: branchTurns.passThrough,
    checkpointNormalBranchTurns: branchTurns.normal,
    checkpointStrictBranchTurns: branchTurns.strict,
    checkpointPassThroughBranchTurnRate: rate(branchTurns.passThrough, totalBranchTurns),
    checkpointNormalBranchTurnRate: rate(branchTurns.normal, totalBranchTurns),
    checkpointStrictBranchTurnRate: rate(branchTurns.strict, totalBranchTurns),
    checkpointPassThroughScreenedRate: rate(refugeesScreenedByPolicy.passThrough, totalScreened),
    checkpointNormalScreenedRate: rate(refugeesScreenedByPolicy.normal, totalScreened),
    checkpointStrictScreenedRate: rate(refugeesScreenedByPolicy.strict, totalScreened),
    unitLosses: statisticNumber(statistics, 'unitLosses') ?? 0,
    zombiesKilled: statisticNumber(statistics, 'normalZombiesKilled') === null && statisticNumber(statistics, 'hordeZombiesKilled') === null
      ? destroyedZombieEvents
      : normalZombiesKilled + hordeZombiesKilled + policeZombiesKilled + soldierZombiesKilled + riotZombiesKilled + hunterZombiesKilled,
    hordeInterceptions: statisticNumber(statistics, 'hordeInterceptions') ?? 0,
    finalHordeSpawned,
    finalHordeKilled,
    finalHordeDefeated,
    periodicHordeZombiesSpawned,
    periodicNormalZombiesSpawned,
    finalHordeZombiesSpawned,
    finalNormalZombiesSpawned,
    normalZombiesKilled,
    hordeZombiesKilled,
    policeZombiesSpawned: statisticNumber(statistics, 'policeZombiesSpawned') ?? 0,
    soldierZombiesSpawned: statisticNumber(statistics, 'soldierZombiesSpawned') ?? 0,
    policeZombiesKilled,
    soldierZombiesKilled,
    policeZombiesFinal: statisticNumber(statistics, 'policeZombiesFinal') ?? 0,
    soldierZombiesFinal: statisticNumber(statistics, 'soldierZombiesFinal') ?? 0,
    riotZombiesSpawned,
    riotZombiesKilled,
    riotZombiesFinal,
    hunterZombiesKilled,
    hunterZombiesSpawned,
    hunterZombiesFinal,
    riotPoliceReanimations: statisticNumber(statistics, 'riotPoliceReanimations') ?? events.filter(
      (event) => event.type === 'human_unit_reanimated' && event.payload.humanUnitType === 'riotPolice',
    ).length,
    maxVisibleZombies,
    turnsAfterFinalHorde,
    suppliedAreaZombieClearTurn,
    suppliedAreaInfectionClearTurn,
    victoryTurn,
    terrainEntriesByType: terrainEntries,
    urbanDefenseApplications,
    urbanDefenseDamagePrevented,
    forestDefenseApplications,
    forestDefenseDamagePrevented,
    normalZombieIdleCount,
    hordeTargetInheritedCount,
    hordeTargetClearedCount,
    noisePulsesEmitted,
    policeNoisePulses,
    nationalGuardNoisePulses,
    riotPoliceNoisePulses,
    recruitsCommissionedByType,
    regularPromotionsByType,
    veteranPromotionsByType,
    veteranZombieKillsByType,
    hordeSpecialSpawnedByType,
    noisePulsesBySourceType,
    hordeMovementNoisePulses,
    hordeNoiseRespawnedByType,
    unusedAttackChargesByTurn,
    criticalInfectionAlertUnresolvedTurns,
    normalZombiesNoiseTargeted,
    noiseTargetsReached,
    noiseTargetsOverriddenByHorde,
    noiseTargetsOverriddenByVisiblePopulation,
    initialNormalZombies: statisticNumber(statistics, 'initialNormalZombies') ?? input.config.economy.initialZombieCount,
    combatNoiseByClass,
    fallenSitesTriggeredByNoise: statisticNumber(statistics, 'fallenSitesTriggeredByNoise')
      ?? siteResolutionEvents.filter((event) => event.type === 'site_noise_respawn').length,
    noiseRespawnAttempts: statisticNumber(statistics, 'noiseRespawnAttempts')
      ?? siteResolutionEvents.filter((event) => event.type === 'site_noise_respawn').length,
    noiseRespawnZombiesSpawned: statisticNumber(statistics, 'noiseRespawnZombiesSpawned') ?? noiseSiteZombieSpawns,
    noiseImmediateInfections: noiseImmediateEvents.length,
    noiseChainOverruns: noiseChainEvents.length,
    policeNoiseImmediateInfections: noiseImmediateEvents.filter((event) => noiseSourceForEvent(event) === 'police').length,
    nationalGuardNoiseImmediateInfections: noiseImmediateEvents.filter((event) => noiseSourceForEvent(event) === 'nationalGuard').length,
    policeNoiseChainOverruns: noiseChainEvents.filter((event) => noiseSourceForEvent(event) === 'police').length,
    nationalGuardNoiseChainOverruns: noiseChainEvents.filter((event) => noiseSourceForEvent(event) === 'nationalGuard').length,
    groundVisionPotentialHexes: statisticNumber(statistics, 'groundVisionPotentialHexes') ?? 0,
    groundVisionVisibleHexes: statisticNumber(statistics, 'groundVisionVisibleHexes') ?? 0,
    groundVisionBlockedHexes: statisticNumber(statistics, 'groundVisionBlockedHexes') ?? 0,
    maxGroundVisionBlockedHexes: statisticNumber(statistics, 'maxGroundVisionBlockedHexes') ?? 0,
    averageGroundVisionBlockedHexes: groundVisionSamples > 0
      ? cumulativeGroundVisionBlockedHexes / groundVisionSamples
      : 0,
    civilianDroneBasesBuilt: statisticNumber(statistics, 'civilianDroneBasesBuilt') ?? constructed('civilianDroneBase'),
    civilianDroneBasesDecommissioned: statisticNumber(statistics, 'civilianDroneBasesDecommissioned') ?? 0,
    civilianGoodsRefundedFromDecommission: statisticNumber(statistics, 'civilianGoodsRefundedFromDecommission') ?? 0,
    maxCivilianDroneVisionRadius: statisticNumber(statistics, 'maxCivilianDroneVisionRadius') ?? maxDroneVisionRadius,
    aerialDiscoveriesInGroundBlockedArea: statisticNumber(statistics, 'aerialDiscoveriesInGroundBlockedArea') ?? 0,
    siteFirstInfectionsByType,
    siteFallsByType,
    siteZombieOccupancyDestructionsByType,
    infectedPopulationAtFall,
    requestedSiteZombieSpawns,
    actualSiteZombieSpawns,
    fallSiteZombieSpawns,
    noiseSiteZombieSpawns,
    maxSixZombieSpawnResolutions: siteResolutionEvents.filter(
      (event) => eventPayloadNumber(event, 'actualSpawnCount') === input.config.infection.maxZombieSpawnPerResolution,
    ).length,
    infectedPopulationConvertedToZombies: statisticNumber(statistics, 'infectedPopulationConvertedToZombies') ?? 0,
    unspawnedInfectedPopulation: statisticNumber(statistics, 'unspawnedInfectedPopulation') ?? 0,
    immediateInfectionsFromSpawn: statisticNumber(statistics, 'immediateInfectionsFromSpawn')
      ?? events.filter((event) => event.type === 'site_immediate_infection').length,
    chainOverruns: statisticNumber(statistics, 'chainOverruns') ?? eventCount('site_chain_fallen'),
    maximumOverrunChainLength: statisticNumber(statistics, 'maximumOverrunChainLength')
      ?? Math.max(...events.filter((event) => event.type === 'site_chain_fallen').map((event) => eventPayloadNumber(event, 'chainDepth')), 0),
    chainOriginsByType,
    constructibleInfectedDeaths: statisticNumber(statistics, 'constructibleInfectedDeaths') ?? siteResolutionEvents.reduce(
      (total, event) => total + eventPayloadNumber(event, 'constructibleInfectedDeaths'),
      0,
    ),
    earlyFacilityLosses: events.filter(
      (event) => (event.type === 'site_fallen' || event.type === 'site_chain_fallen')
        && event.turn < 5 && event.payload.siteKind === 'facility',
    ).length,
    earlyCheckpointLosses: events.filter(
      (event) => (event.type === 'site_fallen' || event.type === 'site_chain_fallen')
        && event.turn < 5 && event.payload.siteKind === 'checkpoint',
    ).length,
    finalFood: numberOrZero(finalObservation.resources.food),
    finalCivilianGoods: numberOrZero(finalObservation.resources.civilianGoods),
    finalMilitaryGoods: numberOrZero(finalObservation.resources.militaryGoods),
    finalFuel: numberOrZero(finalObservation.resources.fuel),
    mapWidth: input.initialObservation.map.width,
    mapHeight: input.initialObservation.map.height,
    humanHexesMovedByType,
    maxSingleMoveDistanceByType,
    longMoves6PlusByType,
    unitFuelConsumedByType,
    unitFuelRefilledByType,
    commissioningFuelByType,
    turnsUnitsEndedOutOfSupplyByType,
    unitsUnableToMoveForFuel,
    stateFuelSpentOnPower,
    stateFuelSpentOnUnits,
    fuelShortageTurns,
    windPowerGenerated,
    windDisabledTurns,
    windOverruns,
    windRecoveries,
    simpleFarmsBuilt: constructed('simpleFarm'),
    simpleFarmsDestroyed: destroyed('simpleFarm'),
    simpleFarmFoodProduced,
    droneBasesBuilt: constructed('civilianDroneBase'),
    droneBasesDestroyed: destroyed('civilianDroneBase'),
    maxDroneVisionRadius,
    constructibleFacilityOverruns,
    constructibleBuildRejectedByReason,
    guaranteedDefeatWarnings,
    guaranteedDefeatIgnored,
    resourceSinglePointFailureTurnsByResource,
    checkpointMovesWithNoSupplyGain,
    checkpointQueuePressureTurnsByClass,
    checkpointQueueFoodDemand: statisticNumber(statistics, 'checkpointQueueFoodDemand') ?? 0,
    checkpointQueueCivilianGoodsDemand: statisticNumber(statistics, 'checkpointQueueCivilianGoodsDemand') ?? 0,
    checkpointQueueFoodConsumed: statisticNumber(statistics, 'checkpointQueueFoodConsumed') ?? 0,
    checkpointQueueCivilianGoodsConsumed: statisticNumber(statistics, 'checkpointQueueCivilianGoodsConsumed') ?? 0,
    refugeesRejectedByDirectionAndPolicy: rejectedByDirectionAndPolicy(statistics),
    refugeesTurnedAwayByDirection: directionNumberRecord(statistics, 'refugeesTurnedAwayByDirection'),
    rejectedBonusZombiesByDirection: directionNumberRecord(statistics, 'rejectedBonusZombiesByDirection'),
    rejectedCounterResetsByDirection: directionNumberRecord(statistics, 'rejectedCounterResetsByDirection'),
    preventedRefugeeArrivalsAfterFinal: statisticNumber(statistics, 'preventedRefugeeArrivalsAfterFinal') ?? 0,
    policeReanimations: statisticNumber(statistics, 'policeReanimations') ?? 0,
    nationalGuardReanimations: statisticNumber(statistics, 'nationalGuardReanimations') ?? 0,
    reanimationImmediateInfections: statisticNumber(statistics, 'reanimationImmediateInfections') ?? 0,
    reanimationFacilityInfections: statisticNumber(statistics, 'reanimationFacilityInfections') ?? 0,
    reanimationCheckpointInfections: statisticNumber(statistics, 'reanimationCheckpointInfections') ?? 0,
    reanimationSiteFalls: statisticNumber(statistics, 'reanimationSiteFalls') ?? 0,
    reanimationChainOverruns: statisticNumber(statistics, 'reanimationChainOverruns') ?? 0,
    policeLongRangeMoves: statisticNumber(statistics, 'policeLongRangeMoves') ?? 0,
    fixedMilitaryGoodsConsumedByType,
    attackMilitaryGoodsConsumedByType,
    counterattackMilitaryGoodsConsumedByType,
    interceptionMilitaryGoodsConsumedByType,
    suppressionMilitaryGoodsConsumedByType,
    militaryGoodsRefilledByType,
    unfilledMilitaryGoodsRefillByType,
    militaryGoodsLostOnDestructionByType,
    zeroMilitaryGoodsWeakAttacksByType,
    nationalGuardAttacksByRange,
    nationalGuardMilitaryGoodsConsumedByRange,
    militaryGoodsRefillShortageTurns,
    emergencyMovesByType,
    emergencyMovementHexesByType,
    emergencyMovementPointsByType,
    emergencyReturnsToSupplyByType,
    powerTurnsByFacilityType,
    powerRequestedTurnsByFacilityType,
    powerSuppliedTurnsByFacilityType,
    powerUnavailableTurnsByFacilityType,
    powerSupplyOffTurnsByFacilityType,
    powerResourceLossByResource,
    refineryPowerOutageTurns,
    refineryOutageNextTurnFuelShortageTurns,
    simpleFarmFoodShortageAvoidanceTurns,
    checkpointBatchStartsByPolicy,
    checkpointBatchCompletionsByPolicy,
    checkpointAverageQueue: checkpointQueueSamples > 0 ? checkpointQueueTotal / checkpointQueueSamples : 0,
    checkpointCapacityUtilization: checkpointQueueSamples > 0 ? checkpointCapacityUtilizationTotal / checkpointQueueSamples : 0,
    checkpointEstimatedThroughput: checkpointThroughputSamples > 0 ? checkpointThroughputTotal / checkpointThroughputSamples : 0,
    hordeWaves,
    hordeDirectionSpawnCounts,
    hordeDirectionKillCounts,
    hordeFinalWaveSpawnTotal,
    hordeFinalWaveKillTotal,
    hordeFinalDefeatedTurn,
    hordeTurnsAfterFinal: turnsAfterFinalHorde,
    hordeMultiFrontCheckpointLosses,
    hordeMultiFrontFallbacks,
    failure: input.failure ? { ...input.failure } : null,
  };
}

/** Backward-friendly alias used by callers that call this a game metric. */
export const computeGameMetrics = collectGameMetrics;

export interface NumericSummary {
  average: number;
  median: number;
  min: number;
  max: number;
  p10: number;
  p90: number;
}

export interface AgentMetricsSummary {
  executions: number;
  completed: number;
  limitReached: number;
  technicalFailures: number;
  wins: number;
  losses: number;
  winRate: number;
  metrics: Record<string, NumericSummary>;
  gameOverReasons: Record<string, number>;
  actionCounts: Record<string, number>;
  priorityGoalCounts: Record<string, number>;
}

export interface SeedComparison {
  seed: number;
  agents: Record<string, {
    outcome: MetricOutcome;
    finalTurn: number;
    acceptedActionCount: number;
    technicalFailure: boolean;
    limitReached: boolean;
  }>;
}

export interface MetricsAggregation {
  executions: number;
  completed: number;
  limitReached: number;
  technicalFailures: number;
  wins: number;
  losses: number;
  winRate: number;
  metrics: Record<string, NumericSummary>;
  gameOverReasons: Record<string, number>;
  actionCounts: Record<string, number>;
  priorityGoalCounts: Record<string, number>;
}

const SUMMARY_NUMERIC_KEYS: readonly (keyof GameMetrics)[] = [
  'finalTurn',
  'totalAgentDecisions',
  'acceptedActionCount',
  'invalidAttemptCount',
  'initialPopulation',
  'finalHealthyCivilianPopulation',
  'maxPopulation',
  'civilianLosses',
  'infectionLosses',
  'resourceShortageLosses',
  'refugeesAccepted',
  'totalRefugeeArrivals',
  'unmanagedPassThrough',
  'refugeesDeparted',
  'checkpointsBuilt',
  'checkpointsRelocated',
  'checkpointRetreats',
  'checkpointsRuined',
  'checkpointsRecovered',
  'checkpointsAbandoned',
  'checkpointsRemoved',
  'standbyCheckpointsCreated',
  'dormantCheckpointsCreated',
  'checkpointActivations',
  'checkpointFallbacks',
  'checkpointFallbacksFromStandby',
  'checkpointFallbacksFromDormant',
  'checkpointFallbacksPreventingUnmanagedArrival',
  'maxCheckpointPostsPerBranch',
  'maxPreparedCheckpointPostsPerBranch',
  'activeCheckpointLosses',
  'unmanagedBranchTurns',
  'maxSuppliedFacilities',
  'maxSupplyRadius',
  'supplyLosses',
  'supplyRejections',
  'maxOvercrowding',
  'maxOvercrowdingAdditionalFood',
  'maxOvercrowdingAdditionalCivilianGoods',
  'facilitiesCaptured',
  'facilitiesLost',
  'finalSecuredFacilities',
  'policeProduced',
  'nationalGuardProduced',
  'riotPoliceProduced',
  'policeInitial',
  'nationalGuardInitial',
  'riotPoliceInitial',
  'policeLosses',
  'nationalGuardLosses',
  'riotPoliceLosses',
  'policeFinal',
  'nationalGuardFinal',
  'riotPoliceFinal',
  'policeSurvivalRate',
  'nationalGuardSurvivalRate',
  'riotPoliceSurvivalRate',
  'outOfSupplyUnitLosses',
  'policeCombatRecoveryHp',
  'policeCombatRecoveryCount',
  'policeRestRecoveryHp',
  'policeRestRecoveryCount',
  'nationalGuardCombatRecoveryHp',
  'nationalGuardCombatRecoveryCount',
  'nationalGuardRestRecoveryHp',
  'nationalGuardRestRecoveryCount',
  'combatRecoverySelections',
  'restRecoverySelections',
  'maxWorkersInSingleFacility',
  'maxTotalProductionWorkers',
  'highCapacityFacilityTurns',
  'powerPlantStoppedTurns',
  'powerShortageTurns',
  'poweredIndustrialFacilityTurns',
  'unpoweredCityTurns',
  'refineryFacilitiesCaptured',
  'powerPlantFacilitiesCaptured',
  'checkpointPassThroughBranchTurns',
  'checkpointNormalBranchTurns',
  'checkpointStrictBranchTurns',
  'checkpointPassThroughBranchTurnRate',
  'checkpointNormalBranchTurnRate',
  'checkpointStrictBranchTurnRate',
  'checkpointPassThroughScreenedRate',
  'checkpointNormalScreenedRate',
  'checkpointStrictScreenedRate',
  'unitLosses',
  'zombiesKilled',
  'hordeInterceptions',
  'finalHordeSpawned',
  'finalHordeKilled',
  'periodicHordeZombiesSpawned',
  'periodicNormalZombiesSpawned',
  'finalHordeZombiesSpawned',
  'finalNormalZombiesSpawned',
  'normalZombiesKilled',
  'hordeZombiesKilled',
  'policeZombiesSpawned',
  'soldierZombiesSpawned',
  'policeZombiesKilled',
  'soldierZombiesKilled',
  'policeZombiesFinal',
  'soldierZombiesFinal',
  'riotZombiesSpawned',
  'hunterZombiesSpawned',
  'riotZombiesKilled',
  'hunterZombiesKilled',
  'riotZombiesFinal',
  'hunterZombiesFinal',
  'riotPoliceReanimations',
  'maxVisibleZombies',
  'turnsAfterFinalHorde',
  'suppliedAreaZombieClearTurn',
  'suppliedAreaInfectionClearTurn',
  'victoryTurn',
  'urbanDefenseApplications',
  'urbanDefenseDamagePrevented',
  'forestDefenseApplications',
  'forestDefenseDamagePrevented',
  'normalZombieIdleCount',
  'hordeTargetInheritedCount',
  'hordeTargetClearedCount',
  'noisePulsesEmitted',
  'policeNoisePulses',
  'nationalGuardNoisePulses',
  'riotPoliceNoisePulses',
  'hordeMovementNoisePulses',
  'unusedAttackChargesByTurn',
  'criticalInfectionAlertUnresolvedTurns',
  'normalZombiesNoiseTargeted',
  'noiseTargetsReached',
  'noiseTargetsOverriddenByHorde',
  'noiseTargetsOverriddenByVisiblePopulation',
  'initialNormalZombies',
  'fallenSitesTriggeredByNoise',
  'noiseRespawnAttempts',
  'noiseRespawnZombiesSpawned',
  'noiseImmediateInfections',
  'noiseChainOverruns',
  'policeNoiseImmediateInfections',
  'nationalGuardNoiseImmediateInfections',
  'policeNoiseChainOverruns',
  'nationalGuardNoiseChainOverruns',
  'groundVisionPotentialHexes',
  'groundVisionVisibleHexes',
  'groundVisionBlockedHexes',
  'maxGroundVisionBlockedHexes',
  'averageGroundVisionBlockedHexes',
  'civilianDroneBasesBuilt',
  'civilianDroneBasesDecommissioned',
  'civilianGoodsRefundedFromDecommission',
  'maxCivilianDroneVisionRadius',
  'aerialDiscoveriesInGroundBlockedArea',
  'infectedPopulationAtFall',
  'requestedSiteZombieSpawns',
  'actualSiteZombieSpawns',
  'fallSiteZombieSpawns',
  'noiseSiteZombieSpawns',
  'maxSixZombieSpawnResolutions',
  'infectedPopulationConvertedToZombies',
  'unspawnedInfectedPopulation',
  'immediateInfectionsFromSpawn',
  'chainOverruns',
  'maximumOverrunChainLength',
  'constructibleInfectedDeaths',
  'earlyFacilityLosses',
  'earlyCheckpointLosses',
  'finalFood',
  'finalCivilianGoods',
  'finalMilitaryGoods',
  'finalFuel',
  'mapWidth',
  'mapHeight',
  'unitsUnableToMoveForFuel',
  'stateFuelSpentOnPower',
  'stateFuelSpentOnUnits',
  'fuelShortageTurns',
  'windPowerGenerated',
  'windDisabledTurns',
  'windOverruns',
  'windRecoveries',
  'simpleFarmsBuilt',
  'simpleFarmsDestroyed',
  'simpleFarmFoodProduced',
  'droneBasesBuilt',
  'droneBasesDestroyed',
  'maxDroneVisionRadius',
  'constructibleFacilityOverruns',
  'guaranteedDefeatWarnings',
  'guaranteedDefeatIgnored',
  'checkpointMovesWithNoSupplyGain',
  'checkpointQueueFoodDemand',
  'checkpointQueueCivilianGoodsDemand',
  'checkpointQueueFoodConsumed',
  'checkpointQueueCivilianGoodsConsumed',
  'preventedRefugeeArrivalsAfterFinal',
  'policeReanimations',
  'nationalGuardReanimations',
  'reanimationImmediateInfections',
  'reanimationFacilityInfections',
  'reanimationCheckpointInfections',
  'reanimationSiteFalls',
  'reanimationChainOverruns',
  'policeLongRangeMoves',
  'refineryPowerOutageTurns',
  'refineryOutageNextTurnFuelShortageTurns',
  'simpleFarmFoodShortageAvoidanceTurns',
  'checkpointAverageQueue',
  'checkpointCapacityUtilization',
  'checkpointEstimatedThroughput',
  'hordeFinalWaveSpawnTotal',
  'hordeFinalWaveKillTotal',
  'hordeFinalDefeatedTurn',
  'hordeTurnsAfterFinal',
  'hordeMultiFrontCheckpointLosses',
  'hordeMultiFrontFallbacks',
];

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * weight;
}

function summarize(values: readonly number[]): NumericSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    average: sorted.length > 0 ? total / sorted.length : 0,
    median: percentile(sorted, 0.5),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    p10: percentile(sorted, 0.1),
    p90: percentile(sorted, 0.9),
  };
}

/** Aggregate game-level Metrics without changing their order or source data. */
export function aggregateMetrics(games: readonly GameMetrics[]): MetricsAggregation {
  const actionCounts: Record<string, number> = {};
  const priorityGoalCounts: Record<string, number> = {};
  const gameOverReasons: Record<string, number> = {};
  for (const game of games) {
    for (const [key, value] of Object.entries(game.actionCounts)) actionCounts[key] = (actionCounts[key] ?? 0) + value;
    for (const [key, value] of Object.entries(game.priorityGoalCounts)) priorityGoalCounts[key] = (priorityGoalCounts[key] ?? 0) + value;
    if (game.gameOverReason) gameOverReasons[game.gameOverReason] = (gameOverReasons[game.gameOverReason] ?? 0) + 1;
  }
  const metrics: Record<string, NumericSummary> = {};
  for (const key of SUMMARY_NUMERIC_KEYS) {
    metrics[key] = summarize(games.map((game) => numberOrZero(game[key])));
  }
  const completed = games.filter((game) => game.outcome === 'won' || game.outcome === 'lost').length;
  const limitReached = games.filter((game) => game.outcome === 'limit_reached').length;
  const technicalFailures = games.filter((game) => game.outcome === 'technical_failure').length;
  const wins = games.filter((game) => game.outcome === 'won').length;
  return {
    executions: games.length,
    completed,
    limitReached,
    technicalFailures,
    wins,
    losses: games.filter((game) => game.outcome === 'lost').length,
    winRate: completed > 0 ? wins / completed : 0,
    metrics,
    gameOverReasons,
    actionCounts,
    priorityGoalCounts,
  };
}

export const summarizeMetrics = aggregateMetrics;

/**
 * Compare rows by seed. A missing agent row is represented as a technical
 * failure so consumers can detect incomplete comparisons deterministically.
 */
export function compareMetricsBySeed(
  games: readonly GameMetrics[],
  expectedAgentIds?: readonly string[],
): SeedComparison[] {
  const bySeed = new Map<number, Map<string, GameMetrics>>();
  for (const game of games) {
    const agents = bySeed.get(game.seed) ?? new Map<string, GameMetrics>();
    agents.set(game.agentId, game);
    bySeed.set(game.seed, agents);
  }
  return [...bySeed.entries()]
    .sort(([left], [right]) => left - right)
    .map(([seed, agents]) => ({
      seed,
      agents: Object.fromEntries(
        [...new Set([...(expectedAgentIds ?? []), ...agents.keys()])]
          .sort((left, right) => left.localeCompare(right))
          .map((agentId) => {
            const game = agents.get(agentId);
            return [agentId, game
              ? {
                outcome: game.outcome,
                finalTurn: game.finalTurn,
                acceptedActionCount: game.acceptedActionCount,
                technicalFailure: game.outcome === 'technical_failure',
                limitReached: game.outcome === 'limit_reached',
              }
              : {
                outcome: 'technical_failure' as const,
                finalTurn: 0,
                acceptedActionCount: 0,
                technicalFailure: true,
                limitReached: false,
              }];
          }),
      ),
    }));
}
