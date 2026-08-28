import type { CheckpointPolicy, GameAction, GameConfig } from '../core/types';
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
  'SuppressInfection',
  'AssignWorkers',
  'TransferPopulation',
  'SetCheckpointPolicy',
  'BuildCheckpoint',
  'RelocateCheckpoint',
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

export type MetricOutcome = 'won' | 'lost' | 'technical_failure';

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
  unitLosses: number;
  zombiesKilled: number;
  hordeInterceptions: number;
  finalFood: number;
  finalCivilianGoods: number;
  finalMilitaryGoods: number;
  finalFuel: number;
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
  appVersion?: string;
  gameRulesVersion?: string;
  agentApiVersion?: string;
  observationApiVersion?: string;
  bridgeApiVersion?: string;
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

  const statistics = input.result?.statistics;
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
  const actionProducedPolice = input.actions.filter(
    (action) => action.type === 'ProduceUnit' && action.unitType === 'police',
  ).length;
  const actionProducedGuard = input.actions.filter(
    (action) => action.type === 'ProduceUnit' && action.unitType === 'nationalGuard',
  ).length;
  const destroyedZombieEvents = events.filter(
    (event) => event.type === 'unit_destroyed' && typeof event.payload.unitId === 'string' && event.payload.unitId.startsWith('zombie-'),
  ).length;
  const maxPopulationObservation = Math.max(...observations.map(populationAtObservation), 0);
  const maxOvercrowdingObservation = Math.max(...observations.map(overcrowdingAtObservation), 0);
  const maxAdditionalFood = Math.max(...observations.map((observation) => numberOrZero(observation.endTurnForecast.overcrowding.additionalFood)), 0);
  const maxAdditionalCivilianGoods = Math.max(...observations.map((observation) => numberOrZero(observation.endTurnForecast.overcrowding.additionalCivilianGoods)), 0);
  const maxPopulation = Math.max(numberOrZero(statistics?.maxPopulation), maxPopulationObservation);
  const finalSecuredFacilities = finalObservation.facilities.filter(
    (facility) => facility.owner === 'player' && facility.status === 'owned',
  ).length;
  const outcome: MetricOutcome = input.failure ? 'technical_failure' : input.result?.outcome ?? 'technical_failure';
  const gameOverReason = input.failure ? null : input.result?.reason ?? null;

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
    civilianLosses: numberOrZero(statistics?.civilianLosses),
    infectionLosses: numberOrZero(statistics?.infectionLosses),
    resourceShortageLosses: numberOrZero(statistics?.resourceShortageLosses),
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
    policeProduced: actionProducedPolice,
    nationalGuardProduced: actionProducedGuard,
    unitLosses: numberOrZero(statistics?.unitLosses),
    zombiesKilled: destroyedZombieEvents,
    hordeInterceptions: numberOrZero(statistics?.hordeInterceptions),
    finalFood: numberOrZero(finalObservation.resources.food),
    finalCivilianGoods: numberOrZero(finalObservation.resources.civilianGoods),
    finalMilitaryGoods: numberOrZero(finalObservation.resources.militaryGoods),
    finalFuel: numberOrZero(finalObservation.resources.fuel),
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
  }>;
}

export interface MetricsAggregation {
  executions: number;
  completed: number;
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
  'unitLosses',
  'zombiesKilled',
  'hordeInterceptions',
  'finalFood',
  'finalCivilianGoods',
  'finalMilitaryGoods',
  'finalFuel',
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
  const completed = games.filter((game) => game.outcome !== 'technical_failure').length;
  const wins = games.filter((game) => game.outcome === 'won').length;
  return {
    executions: games.length,
    completed,
    technicalFailures: games.length - completed,
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
              }
              : {
                outcome: 'technical_failure' as const,
                finalTurn: 0,
                acceptedActionCount: 0,
                technicalFailure: true,
              }];
          }),
      ),
    }));
}
