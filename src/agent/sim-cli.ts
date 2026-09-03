import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertValidGameConfig, createDefaultConfig } from '../core/config';
import type { DeepPartial, GameConfig } from '../core/types';
import {
  aggregateMetrics,
  ACTION_TYPES,
  compareMetricsBySeed,
  PRIORITY_GOALS,
  type GameMetrics,
  type MetricsAggregation,
  type SeedComparison,
} from './metrics';
import {
  createSeeds,
  DEFAULT_AGENT_RUNNER_LIMITS,
  runAgentGame,
  type AgentGameFactory,
  type AgentRun,
  type AgentRunnerLimits,
  type AgentRunnerGameOptions,
} from './runner';
import { APP_VERSION, ARTIFACT_SCHEMA_VERSION, type AgentStrategyId } from './types';

export const RUN_JSON_FILE = 'run.json';
export const GAMES_CSV_FILE = 'games.csv';
export const ARTIFACT_DIRECTORY = 'games';

const CSV_FACILITY_TYPES = [
  'capital', 'city', 'farm', 'civilianFactory', 'militaryFactory', 'refinery',
  'powerPlant', 'windPowerPlant', 'civilianDroneBase', 'simpleFarm',
] as const;
const CSV_DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
const CSV_WAVE_INDICES = [1, 2, 3, 4, 5] as const;

export interface ParsedSimulationArguments {
  agents: AgentStrategyId[];
  games: number;
  seed: number;
  seeds?: number[];
  configPath?: string;
  configJson?: string;
  out: string;
  limits: Partial<AgentRunnerLimits>;
  failFast: boolean;
  overwrite: boolean;
  summaryOnly: boolean;
  buildId?: string;
  help: boolean;
}

export interface SimulationRunOptions {
  agents?: readonly AgentStrategyId[];
  seeds?: readonly number[];
  seed?: number;
  games?: number;
  config?: GameConfig;
  limits?: Partial<AgentRunnerLimits>;
  failFast?: boolean;
  buildId?: string;
  gameFactory?: AgentGameFactory;
  debugSnapshot?: AgentRunnerGameOptions['debugSnapshot'];
  assertInvariant?: AgentRunnerGameOptions['assertInvariant'];
}

export interface SimulationReport {
  /** Mirrors the current public Artifact contract; v1.4.3 reports are not replay inputs. */
  schemaVersion: '5.0.0';
  appVersion: string;
  artifactSchemaVersion: string;
  execution: {
    agents: AgentStrategyId[];
    seeds: number[];
    config: GameConfig;
    limits: AgentRunnerLimits;
    failFast: boolean;
    buildId: string;
  };
  games: GameMetrics[];
  aggregate: Record<string, MetricsAggregation>;
  comparisons: SeedComparison[];
  failures: Array<{
    agent: string;
    seed: number;
    artifactIndex: number;
    code: string;
    message: string;
  }>;
  technicalFailureCount: number;
  exitCode: 0 | 1;
  /** Internal hand-off for the writer; intentionally non-enumerable in JSON. */
  _runs?: readonly AgentRun[];
}

export interface SimulationOutputPaths {
  runJson: string;
  gamesCsv: string;
  artifacts: string[];
}

export interface StreamedSimulationOutput {
  report: SimulationReport;
  paths: SimulationOutputPaths;
}

const AGENTS: readonly AgentStrategyId[] = ['random', 'balanced'];

function integer(value: string, name: string, minimum: number): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} must be a safe integer >= ${minimum}`);
  return parsed;
}

function optionValue(argument: string, name: string, rest: string[]): string {
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) {
    const value = argument.slice(prefix.length);
    if (value.length === 0) throw new Error(`${name} requires a value`);
    return value;
  }
  const next = rest.shift();
  if (!next || next.startsWith('--')) throw new Error(`${name} requires a value`);
  return next;
}

function parseAgents(value: string): AgentStrategyId[] {
  const values = value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) throw new Error('--agent requires random or balanced');
  const result: AgentStrategyId[] = [];
  for (const item of values) {
    if (!AGENTS.includes(item as AgentStrategyId)) throw new Error(`Unknown agent strategy: ${item}`);
    const strategy = item as AgentStrategyId;
    if (!result.includes(strategy)) result.push(strategy);
  }
  return result;
}

function parseSeeds(value: string): number[] {
  const values = value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) throw new Error('--seeds requires at least one seed');
  return values.map((item) => integer(item, '--seeds', Number.MIN_SAFE_INTEGER));
}

function parseLimit(value: string, name: string): number {
  return integer(value, name, 1);
}

/** Parse CLI tokens without reading files or mutating process state. */
export function parseSimulationArgs(argv: readonly string[]): ParsedSimulationArguments {
  const parsed: ParsedSimulationArguments = {
    agents: ['balanced'],
    games: 1,
    seed: 1,
    out: 'output/simulations/run',
    limits: {},
    failFast: false,
    overwrite: false,
    summaryOnly: false,
    help: false,
  };
  // npm 11 may consume unknown script flags as npm_config_* variables before
  // launching the script. Seed the parser from those values, then let explicit
  // argv tokens below take precedence.
  const npmConfig = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = process.env[`npm_config_${name}`] ?? process.env[`npm_config_${name.toLowerCase()}`];
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const envAgent = npmConfig('agent', 'agents', 'strategy');
  const envGames = npmConfig('games');
  const envSeed = npmConfig('seed');
  const envSeeds = npmConfig('seeds');
  const envConfig = npmConfig('config');
  const envConfigJson = npmConfig('config-json', 'config_json');
  const envOut = npmConfig('out');
  const envBuildId = npmConfig('build-id', 'build_id');
  const envPerTurn = npmConfig('max-decisions-per-turn', 'max_decisions_per_turn', 'maxactionsturn', 'maxactions');
  const envPerGame = npmConfig('max-decisions-per-game', 'max_decisions_per_game', 'maxgameactions');
  const envMaxTurns = npmConfig('max-turns', 'max_turns', 'maxturns');
  if (envAgent !== undefined) parsed.agents = parseAgents(envAgent);
  if (envGames !== undefined) parsed.games = integer(envGames, '--games', 1);
  if (envSeed !== undefined) parsed.seed = integer(envSeed, '--seed', Number.MIN_SAFE_INTEGER);
  if (envSeeds !== undefined) parsed.seeds = parseSeeds(envSeeds);
  if (envConfig !== undefined) parsed.configPath = envConfig;
  if (envConfigJson !== undefined) parsed.configJson = envConfigJson;
  if (envOut !== undefined) parsed.out = envOut;
  if (envBuildId !== undefined) parsed.buildId = envBuildId;
  if (envPerTurn !== undefined) parsed.limits.maxDecisionsPerTurn = parseLimit(envPerTurn, '--max-decisions-per-turn');
  if (envPerGame !== undefined) parsed.limits.maxDecisionsPerGame = parseLimit(envPerGame, '--max-decisions-per-game');
  if (envMaxTurns !== undefined) parsed.limits.maxTurns = parseLimit(envMaxTurns, '--max-turns');
  const envFailFast = npmConfig('fail-fast', 'fail_fast', 'failfast');
  if (envFailFast !== undefined && ['1', 'true', 'yes'].includes(envFailFast.toLowerCase())) parsed.failFast = true;
  const envOverwrite = npmConfig('overwrite', 'force');
  if (envOverwrite !== undefined && ['1', 'true', 'yes'].includes(envOverwrite.toLowerCase())) parsed.overwrite = true;
  const envSummaryOnly = npmConfig('summary-only', 'summary_only', 'summaryonly');
  if (envSummaryOnly !== undefined && ['1', 'true', 'yes'].includes(envSummaryOnly.toLowerCase())) parsed.summaryOnly = true;
  const rest = [...argv];
  while (rest.length > 0) {
    const argument = rest.shift()!;
    if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument === '--fail-fast') parsed.failFast = true;
    else if (argument === '--overwrite' || argument === '--force') parsed.overwrite = true;
    else if (argument === '--summary-only') parsed.summaryOnly = true;
    else if (argument === '--agent' || argument.startsWith('--agent=')) parsed.agents = parseAgents(optionValue(argument, '--agent', rest));
    else if (argument === '--agents' || argument.startsWith('--agents=')) parsed.agents = parseAgents(optionValue(argument, '--agents', rest));
    else if (argument === '--strategy' || argument.startsWith('--strategy=')) parsed.agents = parseAgents(optionValue(argument, '--strategy', rest));
    else if (argument === '--games' || argument.startsWith('--games=')) parsed.games = integer(optionValue(argument, '--games', rest), '--games', 1);
    else if (argument === '--seed' || argument.startsWith('--seed=')) parsed.seed = integer(optionValue(argument, '--seed', rest), '--seed', Number.MIN_SAFE_INTEGER);
    else if (argument === '--seeds' || argument.startsWith('--seeds=')) parsed.seeds = parseSeeds(optionValue(argument, '--seeds', rest));
    else if (argument === '--config' || argument.startsWith('--config=')) parsed.configPath = optionValue(argument, '--config', rest);
    else if (argument === '--config-json' || argument.startsWith('--config-json=')) parsed.configJson = optionValue(argument, '--config-json', rest);
    else if (argument === '--out' || argument.startsWith('--out=')) parsed.out = optionValue(argument, '--out', rest);
    else if (argument === '--build-id' || argument.startsWith('--build-id=')) parsed.buildId = optionValue(argument, '--build-id', rest);
    else if (argument === '--max-decisions-per-turn' || argument.startsWith('--max-decisions-per-turn=')) parsed.limits.maxDecisionsPerTurn = parseLimit(optionValue(argument, '--max-decisions-per-turn', rest), '--max-decisions-per-turn');
    else if (argument === '--maxDecisionsPerTurn' || argument.startsWith('--maxDecisionsPerTurn=')) parsed.limits.maxDecisionsPerTurn = parseLimit(optionValue(argument, '--maxDecisionsPerTurn', rest), '--maxDecisionsPerTurn');
    else if (argument === '--max-actions' || argument.startsWith('--max-actions=')) parsed.limits.maxDecisionsPerTurn = parseLimit(optionValue(argument, '--max-actions', rest), '--max-actions');
    else if (argument === '--max-turns' || argument.startsWith('--max-turns=')) parsed.limits.maxTurns = parseLimit(optionValue(argument, '--max-turns', rest), '--max-turns');
    else if (argument === '--maxTurns' || argument.startsWith('--maxTurns=')) parsed.limits.maxTurns = parseLimit(optionValue(argument, '--maxTurns', rest), '--maxTurns');
    else if (argument === '--max-game-decisions' || argument.startsWith('--max-game-decisions=')) parsed.limits.maxDecisionsPerGame = parseLimit(optionValue(argument, '--max-game-decisions', rest), '--max-game-decisions');
    else if (argument === '--max-decisions-per-game' || argument.startsWith('--max-decisions-per-game=')) parsed.limits.maxDecisionsPerGame = parseLimit(optionValue(argument, '--max-decisions-per-game', rest), '--max-decisions-per-game');
    else if (argument === '--maxDecisionsPerGame' || argument.startsWith('--maxDecisionsPerGame=')) parsed.limits.maxDecisionsPerGame = parseLimit(optionValue(argument, '--maxDecisionsPerGame', rest), '--maxDecisionsPerGame');
    else if (argument === '--maxGameActions' || argument.startsWith('--maxGameActions=')) parsed.limits.maxDecisionsPerGame = parseLimit(optionValue(argument, '--maxGameActions', rest), '--maxGameActions');
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (parsed.seeds && parsed.seeds.length === 0) throw new Error('--seeds must not be empty');
  return parsed;
}

export const parseArgs = parseSimulationArgs;

function readConfig(parsed: Pick<ParsedSimulationArguments, 'configPath' | 'configJson'>): GameConfig {
  let value: unknown;
  if (parsed.configJson !== undefined) value = JSON.parse(parsed.configJson);
  else if (parsed.configPath !== undefined) value = JSON.parse(readFileSync(resolve(parsed.configPath), 'utf8'));
  if (value === undefined) return createDefaultConfig();
  const config = createDefaultConfig(value as DeepPartial<GameConfig>);
  assertValidGameConfig(config);
  return config;
}

function buildIdFromGit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!sha) return 'local-unknown';
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'local-unknown';
  }
}

function normalizeRunOptions(options: SimulationRunOptions): {
  agents: AgentStrategyId[];
  seeds: number[];
  config: GameConfig;
  limits: Partial<AgentRunnerLimits>;
  failFast: boolean;
  buildId: string;
} {
  const agents = [...(options.agents ?? ['balanced'])];
  if (agents.length === 0 || agents.some((agent) => !AGENTS.includes(agent))) throw new Error('agents must contain random and/or balanced');
  const seeds = options.seeds ? [...options.seeds] : createSeeds(options.games ?? 1, options.seed ?? 1);
  if (seeds.some((seed) => !Number.isSafeInteger(seed))) throw new Error('seeds must contain safe integers');
  const config = createDefaultConfig(options.config ?? {});
  assertValidGameConfig(config);
  return { agents, seeds, config, limits: { ...(options.limits ?? {}) }, failFast: options.failFast ?? false, buildId: options.buildId ?? buildIdFromGit() };
}

/** Execute all requested games; this function deliberately performs no I/O. */
export function runSimulation(options: SimulationRunOptions = {}): SimulationReport {
  const normalized = normalizeRunOptions(options);
  const runs: AgentRun[] = [];
  for (const agent of normalized.agents) {
    for (const seed of normalized.seeds) {
      const run = runAgentGame(seed, {
        strategy: agent,
        config: normalized.config,
        limits: normalized.limits,
        buildId: normalized.buildId,
        gameFactory: options.gameFactory,
        debugSnapshot: options.debugSnapshot,
        assertInvariant: options.assertInvariant,
      });
      runs.push(run);
      if (normalized.failFast && run.technicalFailure) break;
    }
    if (normalized.failFast && runs.at(-1)?.technicalFailure) break;
  }
  const games = runs.map((run) => run.metrics);
  const failures = runs.flatMap((run, index) => run.failure ? [{
    agent: run.agent.id,
    seed: run.seed,
    artifactIndex: index,
    code: run.failure.code,
    message: run.failure.message,
  }] : []);
  const report = createSimulationReport(normalized, games, failures);
  Object.defineProperty(report, '_runs', { value: runs, enumerable: false, writable: false });
  return report;
}

function createSimulationReport(
  normalized: ReturnType<typeof normalizeRunOptions>,
  games: GameMetrics[],
  failures: SimulationReport['failures'],
): SimulationReport {
  const aggregate: Record<string, MetricsAggregation> = {};
  for (const agent of normalized.agents) {
    const rows = games.filter((game) => game.agentId === agent);
    aggregate[agent] = aggregateMetrics(rows);
  }
  return {
    schemaVersion: '5.0.0',
    appVersion: APP_VERSION,
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    execution: {
      agents: normalized.agents,
      seeds: normalized.seeds,
      config: normalized.config,
      // Runner safety budgets are independent of the in-game Final Horde
      // schedule; this mirrors the normalization used by runAgentGame.
      limits: {
        maxDecisionsPerTurn: normalized.limits.maxDecisionsPerTurn ?? Math.max(1, normalized.config.maxActionsPerTurn),
        maxDecisionsPerGame: normalized.limits.maxDecisionsPerGame ?? Math.max(
          1,
          DEFAULT_AGENT_RUNNER_LIMITS.maxTurns * (Math.max(1, normalized.config.maxActionsPerTurn) + 1) + 1,
        ),
        maxTurns: normalized.limits.maxTurns ?? DEFAULT_AGENT_RUNNER_LIMITS.maxTurns,
      },
      failFast: normalized.failFast,
      buildId: normalized.buildId,
    },
    games,
    aggregate,
    comparisons: compareMetricsBySeed(games, normalized.agents),
    failures,
    technicalFailureCount: failures.length,
    exitCode: failures.length > 0 ? 1 : 0,
  };
}

export const runBatch = runSimulation;

const CSV_COLUMNS: readonly string[] = [
  'appVersion', 'gameRulesVersion', 'agentApiVersion', 'observationApiVersion', 'bridgeApiVersion',
  'buildId', 'mapId', 'agentId', 'agentVersion', 'strategy', 'seed', 'outcome', 'gameOverReason', 'finalTurn',
  'totalAgentDecisions', 'acceptedActionCount', 'invalidAttemptCount', 'initialPopulation',
  'finalHealthyCivilianPopulation', 'maxPopulation', 'civilianLosses', 'infectionLosses',
  'resourceShortageLosses', 'refugeesAccepted', 'totalRefugeeArrivals', 'unmanagedPassThrough',
  'refugeesDeparted', 'refugeesScreened.passThrough', 'refugeesScreened.normal', 'refugeesScreened.strict',
  'checkpointsBuilt', 'checkpointsRelocated', 'checkpointRetreats', 'checkpointsRuined', 'checkpointsRecovered',
  'checkpointsAbandoned', 'checkpointsRemoved', 'standbyCheckpointsCreated', 'dormantCheckpointsCreated',
  'checkpointActivations', 'checkpointFallbacks', 'checkpointFallbacksFromStandby', 'checkpointFallbacksFromDormant',
  'checkpointFallbacksPreventingUnmanagedArrival', 'maxCheckpointPostsPerBranch', 'maxPreparedCheckpointPostsPerBranch',
  'activeCheckpointLosses', 'checkpointFallbacks.north', 'checkpointFallbacks.east', 'checkpointFallbacks.south',
  'checkpointFallbacks.west', 'unmanagedBranchTurns', 'maxSuppliedFacilities',
  'maxSupplyRadius', 'supplyLosses', 'supplyRejections',
  'arrivals.north', 'arrivals.east', 'arrivals.south', 'arrivals.west',
  'maxOvercrowding', 'maxOvercrowdingAdditionalFood',
  'maxOvercrowdingAdditionalCivilianGoods', 'facilitiesCaptured', 'facilitiesLost',
  'finalSecuredFacilities', 'policeProduced', 'nationalGuardProduced', 'unitLosses', 'zombiesKilled',
  'policeInitial', 'nationalGuardInitial', 'policeLosses', 'nationalGuardLosses', 'policeFinal', 'nationalGuardFinal',
  'policeSurvivalRate', 'nationalGuardSurvivalRate', 'outOfSupplyUnitLosses',
  'policeCombatRecoveryHp', 'policeCombatRecoveryCount', 'policeRestRecoveryHp', 'policeRestRecoveryCount',
  'nationalGuardCombatRecoveryHp', 'nationalGuardCombatRecoveryCount', 'nationalGuardRestRecoveryHp', 'nationalGuardRestRecoveryCount',
  'combatRecoverySelections', 'restRecoverySelections', 'maxWorkersInSingleFacility', 'maxTotalProductionWorkers',
  'highCapacityFacilityTurns', 'powerPlantStoppedTurns', 'powerShortageTurns',
  'poweredIndustrialFacilityTurns', 'unpoweredCityTurns', 'refineryFacilitiesCaptured', 'powerPlantFacilitiesCaptured',
  'checkpointPassThroughBranchTurns', 'checkpointNormalBranchTurns', 'checkpointStrictBranchTurns',
  'checkpointPassThroughBranchTurnRate', 'checkpointNormalBranchTurnRate', 'checkpointStrictBranchTurnRate',
  'checkpointPassThroughScreenedRate', 'checkpointNormalScreenedRate', 'checkpointStrictScreenedRate',
  'hordeInterceptions',
  'finalHordeSpawned', 'finalHordeKilled', 'finalHordeDefeated',
  'periodicHordeZombiesSpawned', 'periodicNormalZombiesSpawned',
  'finalHordeZombiesSpawned', 'finalNormalZombiesSpawned',
  'normalZombiesKilled', 'hordeZombiesKilled',
  'policeZombiesSpawned', 'soldierZombiesSpawned', 'policeZombiesKilled', 'soldierZombiesKilled',
  'policeZombiesFinal', 'soldierZombiesFinal',
  'maxVisibleZombies', 'turnsAfterFinalHorde', 'suppliedAreaZombieClearTurn', 'suppliedAreaInfectionClearTurn', 'victoryTurn',
  'terrainEntriesByType.plain', 'terrainEntriesByType.forest', 'terrainEntriesByType.mountain', 'terrainEntriesByType.water',
  'urbanDefenseApplications', 'urbanDefenseDamagePrevented', 'forestDefenseApplications', 'forestDefenseDamagePrevented',
  'normalZombieIdleCount', 'hordeTargetInheritedCount', 'hordeTargetClearedCount',
  'noisePulsesEmitted', 'policeNoisePulses', 'nationalGuardNoisePulses', 'normalZombiesNoiseTargeted',
  'noiseTargetsReached', 'noiseTargetsOverriddenByHorde', 'noiseTargetsOverriddenByVisiblePopulation',
  'initialNormalZombies', 'combatNoise.medium', 'combatNoise.large',
  'fallenSitesTriggeredByNoise', 'noiseRespawnAttempts', 'noiseRespawnZombiesSpawned',
  'noiseImmediateInfections', 'noiseChainOverruns',
  'policeNoiseImmediateInfections', 'nationalGuardNoiseImmediateInfections',
  'policeNoiseChainOverruns', 'nationalGuardNoiseChainOverruns',
  'groundVisionPotentialHexes', 'groundVisionVisibleHexes', 'groundVisionBlockedHexes',
  'maxGroundVisionBlockedHexes', 'averageGroundVisionBlockedHexes',
  'civilianDroneBasesBuilt', 'civilianDroneBasesDecommissioned', 'civilianGoodsRefundedFromDecommission',
  'maxCivilianDroneVisionRadius', 'aerialDiscoveriesInGroundBlockedArea',
  'infectedPopulationAtFall', 'requestedSiteZombieSpawns', 'actualSiteZombieSpawns',
  'fallSiteZombieSpawns', 'noiseSiteZombieSpawns', 'maxSixZombieSpawnResolutions',
  'infectedPopulationConvertedToZombies', 'unspawnedInfectedPopulation', 'immediateInfectionsFromSpawn',
  'chainOverruns', 'maximumOverrunChainLength',
  'constructibleInfectedDeaths', 'earlyFacilityLosses', 'earlyCheckpointLosses',
  'finalFood', 'finalCivilianGoods', 'finalMilitaryGoods', 'finalFuel',
  'mapWidth', 'mapHeight',
  'humanHexesMoved.police', 'humanHexesMoved.nationalGuard',
  'maxSingleMoveDistance.police', 'maxSingleMoveDistance.nationalGuard',
  'longMoves6Plus.police', 'longMoves6Plus.nationalGuard', 'policeLongRangeMoves',
  'unitFuelConsumed.police', 'unitFuelConsumed.nationalGuard',
  'unitFuelRefilled.police', 'unitFuelRefilled.nationalGuard',
  'commissioningFuel.police', 'commissioningFuel.nationalGuard',
  'turnsUnitsEndedOutOfSupply.police', 'turnsUnitsEndedOutOfSupply.nationalGuard',
  'unitsUnableToMoveForFuel', 'stateFuelSpentOnPower', 'stateFuelSpentOnUnits', 'fuelShortageTurns',
  'fixedMilitaryGoodsConsumed.police', 'fixedMilitaryGoodsConsumed.nationalGuard',
  'attackMilitaryGoodsConsumed.police', 'attackMilitaryGoodsConsumed.nationalGuard',
  'counterattackMilitaryGoodsConsumed.police', 'counterattackMilitaryGoodsConsumed.nationalGuard',
  'interceptionMilitaryGoodsConsumed.police', 'interceptionMilitaryGoodsConsumed.nationalGuard',
  'suppressionMilitaryGoodsConsumed.police', 'suppressionMilitaryGoodsConsumed.nationalGuard',
  'militaryGoodsRefilled.police', 'militaryGoodsRefilled.nationalGuard',
  'unfilledMilitaryGoodsRefill.police', 'unfilledMilitaryGoodsRefill.nationalGuard',
  'militaryGoodsLostOnDestruction.police', 'militaryGoodsLostOnDestruction.nationalGuard',
  'zeroMilitaryGoodsWeakAttacks.police', 'zeroMilitaryGoodsWeakAttacks.nationalGuard',
  'nationalGuardAttacks.range1', 'nationalGuardAttacks.range2',
  'nationalGuardMilitaryGoodsConsumed.range1', 'nationalGuardMilitaryGoodsConsumed.range2',
  'militaryGoodsRefillShortageTurns',
  'emergencyMoves.police', 'emergencyMoves.nationalGuard',
  'emergencyMovementHexes.police', 'emergencyMovementHexes.nationalGuard',
  'emergencyMovementPoints.police', 'emergencyMovementPoints.nationalGuard',
  'emergencyReturnsToSupply.police', 'emergencyReturnsToSupply.nationalGuard',
  'windPowerGenerated', 'windDisabledTurns', 'windOverruns', 'windRecoveries',
  'simpleFarmsBuilt', 'simpleFarmsDestroyed', 'simpleFarmFoodProduced',
  'droneBasesBuilt', 'droneBasesDestroyed', 'maxDroneVisionRadius', 'constructibleFacilityOverruns',
  'guaranteedDefeatWarnings', 'guaranteedDefeatIgnored', 'checkpointMovesWithNoSupplyGain',
  'resourceSinglePointFailureTurns.food', 'resourceSinglePointFailureTurns.civilianGoods',
  'resourceSinglePointFailureTurns.militaryGoods', 'resourceSinglePointFailureTurns.fuel',
  'resourceSinglePointFailureTurns.electricity',
  'checkpointQueuePressureTurns.none', 'checkpointQueuePressureTurns.low',
  'checkpointQueuePressureTurns.medium', 'checkpointQueuePressureTurns.high',
  'checkpointQueueFoodDemand', 'checkpointQueueCivilianGoodsDemand',
  'checkpointQueueFoodConsumed', 'checkpointQueueCivilianGoodsConsumed',
  ...CSV_DIRECTIONS.flatMap((direction) => [
    `refugeesRejected.${direction}.normal`, `refugeesRejected.${direction}.strict`,
    `refugeesTurnedAway.${direction}`, `rejectedBonusZombies.${direction}`, `rejectedCounterResets.${direction}`,
  ]),
  'preventedRefugeeArrivalsAfterFinal', 'policeReanimations', 'nationalGuardReanimations',
  'reanimationImmediateInfections', 'reanimationFacilityInfections', 'reanimationCheckpointInfections',
  'reanimationSiteFalls', 'reanimationChainOverruns',
  ...CSV_FACILITY_TYPES.flatMap((type) => [
    `power.${type}.requested`, `power.${type}.supplied`, `power.${type}.unavailable`, `power.${type}.off`,
  ]),
  ...CSV_FACILITY_TYPES.map((type) => `powerRequestedTurns.${type}`),
  ...CSV_FACILITY_TYPES.map((type) => `powerSuppliedTurns.${type}`),
  ...CSV_FACILITY_TYPES.map((type) => `powerUnavailableTurns.${type}`),
  ...CSV_FACILITY_TYPES.map((type) => `powerSupplyOffTurns.${type}`),
  'powerResourceLoss.food', 'powerResourceLoss.civilianGoods', 'powerResourceLoss.militaryGoods', 'powerResourceLoss.fuel',
  'refineryPowerOutageTurns', 'refineryOutageNextTurnFuelShortageTurns', 'simpleFarmFoodShortageAvoidanceTurns',
  'checkpointBatchStarts.passThrough', 'checkpointBatchStarts.normal', 'checkpointBatchStarts.strict',
  'checkpointBatchCompletions.passThrough', 'checkpointBatchCompletions.normal', 'checkpointBatchCompletions.strict',
  'checkpointAverageQueue', 'checkpointCapacityUtilization', 'checkpointEstimatedThroughput',
  ...CSV_DIRECTIONS.flatMap((direction) => [
    `hordeDirectionSpawn.${direction}.hordeZombie`, `hordeDirectionSpawn.${direction}.normalZombie`,
    `hordeDirectionKill.${direction}.hordeZombie`, `hordeDirectionKill.${direction}.normalZombie`,
  ]),
  ...CSV_WAVE_INDICES.flatMap((index) => [
    `hordeWave.${index}.spawnTurn`, `hordeWave.${index}.directions`, `hordeWave.${index}.final`,
    `hordeWave.${index}.hordeZombieSpawned`, `hordeWave.${index}.normalZombieSpawned`,
    `hordeWave.${index}.hordeZombieKilled`, `hordeWave.${index}.normalZombieKilled`,
  ]),
  'hordeFinalWaveSpawnTotal', 'hordeFinalWaveKillTotal', 'hordeFinalDefeatedTurn',
  'hordeTurnsAfterFinal', 'hordeMultiFrontCheckpointLosses', 'hordeMultiFrontFallbacks',
  ...ACTION_TYPES.map((type) => `action.${type}`),
  ...PRIORITY_GOALS.map((goal) => `goal.${goal}`),
];

export function csvColumns(): string[] {
  return [...CSV_COLUMNS];
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function metricsToCsv(games: readonly GameMetrics[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const game of games) {
    const values: unknown[] = [
      game.appVersion, game.gameRulesVersion, game.agentApiVersion, game.observationApiVersion, game.bridgeApiVersion,
      game.buildId, game.mapId, game.agentId, game.agentVersion, game.strategy, game.seed, game.outcome, game.gameOverReason, game.finalTurn,
      game.totalAgentDecisions, game.acceptedActionCount, game.invalidAttemptCount, game.initialPopulation,
      game.finalHealthyCivilianPopulation, game.maxPopulation, game.civilianLosses, game.infectionLosses,
      game.resourceShortageLosses, game.refugeesAccepted, game.totalRefugeeArrivals, game.unmanagedPassThrough,
      game.refugeesDeparted, game.refugeesScreenedByPolicy.passThrough ?? 0, game.refugeesScreenedByPolicy.normal ?? 0,
      game.refugeesScreenedByPolicy.strict ?? 0, game.checkpointsBuilt, game.checkpointsRelocated, game.checkpointRetreats,
      game.checkpointsRuined, game.checkpointsRecovered, game.checkpointsAbandoned, game.checkpointsRemoved,
      game.standbyCheckpointsCreated, game.dormantCheckpointsCreated, game.checkpointActivations,
      game.checkpointFallbacks, game.checkpointFallbacksFromStandby, game.checkpointFallbacksFromDormant,
      game.checkpointFallbacksPreventingUnmanagedArrival, game.maxCheckpointPostsPerBranch,
      game.maxPreparedCheckpointPostsPerBranch, game.activeCheckpointLosses,
      game.checkpointFallbacksByBranch.north ?? 0, game.checkpointFallbacksByBranch.east ?? 0,
      game.checkpointFallbacksByBranch.south ?? 0, game.checkpointFallbacksByBranch.west ?? 0,
      game.unmanagedBranchTurns, game.maxSuppliedFacilities, game.maxSupplyRadius, game.supplyLosses, game.supplyRejections,
      game.refugeeArrivalsByBranch.north ?? 0, game.refugeeArrivalsByBranch.east ?? 0,
      game.refugeeArrivalsByBranch.south ?? 0, game.refugeeArrivalsByBranch.west ?? 0,
      game.maxOvercrowding, game.maxOvercrowdingAdditionalFood,
      game.maxOvercrowdingAdditionalCivilianGoods, game.facilitiesCaptured, game.facilitiesLost,
      game.finalSecuredFacilities, game.policeProduced, game.nationalGuardProduced, game.unitLosses,
      game.zombiesKilled,
      game.policeInitial, game.nationalGuardInitial, game.policeLosses, game.nationalGuardLosses, game.policeFinal, game.nationalGuardFinal,
      game.policeSurvivalRate, game.nationalGuardSurvivalRate, game.outOfSupplyUnitLosses,
      game.policeCombatRecoveryHp, game.policeCombatRecoveryCount, game.policeRestRecoveryHp, game.policeRestRecoveryCount,
      game.nationalGuardCombatRecoveryHp, game.nationalGuardCombatRecoveryCount, game.nationalGuardRestRecoveryHp, game.nationalGuardRestRecoveryCount,
      game.combatRecoverySelections, game.restRecoverySelections, game.maxWorkersInSingleFacility, game.maxTotalProductionWorkers,
      game.highCapacityFacilityTurns, game.powerPlantStoppedTurns, game.powerShortageTurns,
      game.poweredIndustrialFacilityTurns, game.unpoweredCityTurns,
      game.refineryFacilitiesCaptured, game.powerPlantFacilitiesCaptured,
      game.checkpointPassThroughBranchTurns, game.checkpointNormalBranchTurns, game.checkpointStrictBranchTurns,
      game.checkpointPassThroughBranchTurnRate, game.checkpointNormalBranchTurnRate, game.checkpointStrictBranchTurnRate,
      game.checkpointPassThroughScreenedRate, game.checkpointNormalScreenedRate, game.checkpointStrictScreenedRate,
      game.hordeInterceptions,
      game.finalHordeSpawned, game.finalHordeKilled, game.finalHordeDefeated,
      game.periodicHordeZombiesSpawned, game.periodicNormalZombiesSpawned,
      game.finalHordeZombiesSpawned, game.finalNormalZombiesSpawned,
       game.normalZombiesKilled, game.hordeZombiesKilled,
       game.policeZombiesSpawned, game.soldierZombiesSpawned, game.policeZombiesKilled, game.soldierZombiesKilled,
       game.policeZombiesFinal, game.soldierZombiesFinal,
       game.maxVisibleZombies, game.turnsAfterFinalHorde,
      game.suppliedAreaZombieClearTurn, game.suppliedAreaInfectionClearTurn, game.victoryTurn,
      game.terrainEntriesByType.plain, game.terrainEntriesByType.forest,
      game.terrainEntriesByType.mountain, game.terrainEntriesByType.water,
      game.urbanDefenseApplications, game.urbanDefenseDamagePrevented,
      game.forestDefenseApplications, game.forestDefenseDamagePrevented,
      game.normalZombieIdleCount, game.hordeTargetInheritedCount, game.hordeTargetClearedCount,
      game.noisePulsesEmitted, game.policeNoisePulses, game.nationalGuardNoisePulses,
      game.normalZombiesNoiseTargeted, game.noiseTargetsReached, game.noiseTargetsOverriddenByHorde,
      game.noiseTargetsOverriddenByVisiblePopulation,
      game.initialNormalZombies, game.combatNoiseByClass.medium, game.combatNoiseByClass.large,
      game.fallenSitesTriggeredByNoise, game.noiseRespawnAttempts, game.noiseRespawnZombiesSpawned,
      game.noiseImmediateInfections, game.noiseChainOverruns,
      game.policeNoiseImmediateInfections, game.nationalGuardNoiseImmediateInfections,
      game.policeNoiseChainOverruns, game.nationalGuardNoiseChainOverruns,
      game.groundVisionPotentialHexes, game.groundVisionVisibleHexes, game.groundVisionBlockedHexes,
      game.maxGroundVisionBlockedHexes, game.averageGroundVisionBlockedHexes,
       game.civilianDroneBasesBuilt, game.civilianDroneBasesDecommissioned, game.civilianGoodsRefundedFromDecommission,
       game.maxCivilianDroneVisionRadius, game.aerialDiscoveriesInGroundBlockedArea,
      game.infectedPopulationAtFall, game.requestedSiteZombieSpawns, game.actualSiteZombieSpawns,
      game.fallSiteZombieSpawns, game.noiseSiteZombieSpawns, game.maxSixZombieSpawnResolutions,
      game.infectedPopulationConvertedToZombies, game.unspawnedInfectedPopulation,
      game.immediateInfectionsFromSpawn, game.chainOverruns, game.maximumOverrunChainLength,
      game.constructibleInfectedDeaths,
      game.earlyFacilityLosses, game.earlyCheckpointLosses,
      game.finalFood, game.finalCivilianGoods,
      game.finalMilitaryGoods, game.finalFuel,
      game.mapWidth, game.mapHeight,
      game.humanHexesMovedByType.police, game.humanHexesMovedByType.nationalGuard,
      game.maxSingleMoveDistanceByType.police, game.maxSingleMoveDistanceByType.nationalGuard,
       game.longMoves6PlusByType.police, game.longMoves6PlusByType.nationalGuard, game.policeLongRangeMoves,
      game.unitFuelConsumedByType.police, game.unitFuelConsumedByType.nationalGuard,
      game.unitFuelRefilledByType.police, game.unitFuelRefilledByType.nationalGuard,
      game.commissioningFuelByType.police, game.commissioningFuelByType.nationalGuard,
      game.turnsUnitsEndedOutOfSupplyByType.police, game.turnsUnitsEndedOutOfSupplyByType.nationalGuard,
      game.unitsUnableToMoveForFuel, game.stateFuelSpentOnPower, game.stateFuelSpentOnUnits, game.fuelShortageTurns,
      game.fixedMilitaryGoodsConsumedByType.police, game.fixedMilitaryGoodsConsumedByType.nationalGuard,
      game.attackMilitaryGoodsConsumedByType.police, game.attackMilitaryGoodsConsumedByType.nationalGuard,
      game.counterattackMilitaryGoodsConsumedByType.police, game.counterattackMilitaryGoodsConsumedByType.nationalGuard,
      game.interceptionMilitaryGoodsConsumedByType.police, game.interceptionMilitaryGoodsConsumedByType.nationalGuard,
      game.suppressionMilitaryGoodsConsumedByType.police, game.suppressionMilitaryGoodsConsumedByType.nationalGuard,
      game.militaryGoodsRefilledByType.police, game.militaryGoodsRefilledByType.nationalGuard,
      game.unfilledMilitaryGoodsRefillByType.police, game.unfilledMilitaryGoodsRefillByType.nationalGuard,
      game.militaryGoodsLostOnDestructionByType.police, game.militaryGoodsLostOnDestructionByType.nationalGuard,
      game.zeroMilitaryGoodsWeakAttacksByType.police, game.zeroMilitaryGoodsWeakAttacksByType.nationalGuard,
      game.nationalGuardAttacksByRange.range1, game.nationalGuardAttacksByRange.range2,
      game.nationalGuardMilitaryGoodsConsumedByRange.range1, game.nationalGuardMilitaryGoodsConsumedByRange.range2,
      game.militaryGoodsRefillShortageTurns,
      game.emergencyMovesByType.police, game.emergencyMovesByType.nationalGuard,
      game.emergencyMovementHexesByType.police, game.emergencyMovementHexesByType.nationalGuard,
      game.emergencyMovementPointsByType.police, game.emergencyMovementPointsByType.nationalGuard,
      game.emergencyReturnsToSupplyByType.police, game.emergencyReturnsToSupplyByType.nationalGuard,
      game.windPowerGenerated, game.windDisabledTurns, game.windOverruns, game.windRecoveries,
      game.simpleFarmsBuilt, game.simpleFarmsDestroyed, game.simpleFarmFoodProduced,
      game.droneBasesBuilt, game.droneBasesDestroyed, game.maxDroneVisionRadius, game.constructibleFacilityOverruns,
      game.guaranteedDefeatWarnings, game.guaranteedDefeatIgnored, game.checkpointMovesWithNoSupplyGain,
      game.resourceSinglePointFailureTurnsByResource.food ?? 0,
      game.resourceSinglePointFailureTurnsByResource.civilianGoods ?? 0,
      game.resourceSinglePointFailureTurnsByResource.militaryGoods ?? 0,
      game.resourceSinglePointFailureTurnsByResource.fuel ?? 0,
      game.resourceSinglePointFailureTurnsByResource.electricity ?? 0,
        game.checkpointQueuePressureTurnsByClass.none, game.checkpointQueuePressureTurnsByClass.low,
        game.checkpointQueuePressureTurnsByClass.medium, game.checkpointQueuePressureTurnsByClass.high,
        game.checkpointQueueFoodDemand, game.checkpointQueueCivilianGoodsDemand,
        game.checkpointQueueFoodConsumed, game.checkpointQueueCivilianGoodsConsumed,
        ...CSV_DIRECTIONS.flatMap((direction) => [
          game.refugeesRejectedByDirectionAndPolicy[direction]?.normal ?? 0,
          game.refugeesRejectedByDirectionAndPolicy[direction]?.strict ?? 0,
          game.refugeesTurnedAwayByDirection[direction] ?? 0,
          game.rejectedBonusZombiesByDirection[direction] ?? 0,
          game.rejectedCounterResetsByDirection[direction] ?? 0,
        ]),
        game.preventedRefugeeArrivalsAfterFinal, game.policeReanimations, game.nationalGuardReanimations,
        game.reanimationImmediateInfections, game.reanimationFacilityInfections, game.reanimationCheckpointInfections,
        game.reanimationSiteFalls, game.reanimationChainOverruns,
       ...CSV_FACILITY_TYPES.flatMap((type) => {
         const metric = game.powerTurnsByFacilityType[type] ?? { requested: 0, supplied: 0, unavailable: 0, off: 0 };
         return [metric.requested, metric.supplied, metric.unavailable, metric.off];
       }),
       ...CSV_FACILITY_TYPES.map((type) => game.powerRequestedTurnsByFacilityType[type] ?? 0),
       ...CSV_FACILITY_TYPES.map((type) => game.powerSuppliedTurnsByFacilityType[type] ?? 0),
       ...CSV_FACILITY_TYPES.map((type) => game.powerUnavailableTurnsByFacilityType[type] ?? 0),
       ...CSV_FACILITY_TYPES.map((type) => game.powerSupplyOffTurnsByFacilityType[type] ?? 0),
       game.powerResourceLossByResource.food ?? 0,
       game.powerResourceLossByResource.civilianGoods ?? 0,
       game.powerResourceLossByResource.militaryGoods ?? 0,
       game.powerResourceLossByResource.fuel ?? 0,
       game.refineryPowerOutageTurns,
       game.refineryOutageNextTurnFuelShortageTurns,
       game.simpleFarmFoodShortageAvoidanceTurns,
       game.checkpointBatchStartsByPolicy.passThrough ?? 0,
       game.checkpointBatchStartsByPolicy.normal ?? 0,
       game.checkpointBatchStartsByPolicy.strict ?? 0,
       game.checkpointBatchCompletionsByPolicy.passThrough ?? 0,
       game.checkpointBatchCompletionsByPolicy.normal ?? 0,
       game.checkpointBatchCompletionsByPolicy.strict ?? 0,
       game.checkpointAverageQueue,
       game.checkpointCapacityUtilization,
       game.checkpointEstimatedThroughput,
       ...CSV_DIRECTIONS.flatMap((direction) => [
         game.hordeDirectionSpawnCounts[direction]?.hordeZombie ?? 0,
         game.hordeDirectionSpawnCounts[direction]?.normalZombie ?? 0,
         game.hordeDirectionKillCounts[direction]?.hordeZombie ?? 0,
         game.hordeDirectionKillCounts[direction]?.normalZombie ?? 0,
       ]),
       ...CSV_WAVE_INDICES.flatMap((index) => {
         const wave = game.hordeWaves.find((candidate) => candidate.index === index);
         return [
           wave?.spawnTurn ?? '',
           wave ? JSON.stringify(wave.directions) : '',
           wave?.final ?? '',
           wave?.hordeZombieSpawned ?? 0,
           wave?.normalZombieSpawned ?? 0,
           wave?.hordeZombieKilled ?? 0,
           wave?.normalZombieKilled ?? 0,
         ];
       }),
       game.hordeFinalWaveSpawnTotal,
       game.hordeFinalWaveKillTotal,
       game.hordeFinalDefeatedTurn,
       game.hordeTurnsAfterFinal,
       game.hordeMultiFrontCheckpointLosses,
       game.hordeMultiFrontFallbacks,
       ...ACTION_TYPES.map((type) => game.actionCounts[type] ?? 0),
      ...PRIORITY_GOALS.map((goal) => game.priorityGoalCounts[goal] ?? 0),
    ];
    rows.push(values.map(csvCell).join(','));
  }
  return `${rows.join('\n')}\n`;
}

function ensureOutputDirectory(path: string, overwrite: boolean): void {
  if (existsSync(path)) {
    if (!requireDirectory(path)) throw new Error(`Output path is not a directory: ${path}`);
    if (!overwrite && readdirSync(path).length > 0) throw new Error(`Output directory is not empty; refusing to overwrite: ${path}`);
  } else {
    mkdirSync(path, { recursive: true });
  }
}

function requireDirectory(path: string): boolean {
  try {
    // Avoid importing statSync solely for the normal path; readdirSync throws
    // on files and is handled by the caller's error path.
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

function artifactFileName(index: number, metrics: GameMetrics): string {
  const safeAgent = metrics.agentId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${String(index + 1).padStart(4, '0')}-${safeAgent}-${metrics.seed}.json`;
}

/** Write the canonical JSON, fixed-column UTF-8 CSV, and per-game artifacts. */
export function writeSimulationOutput(
  report: SimulationReport,
  outDirectory: string,
  options: { overwrite?: boolean } = {},
): SimulationOutputPaths {
  const outputDirectory = isAbsolute(outDirectory) ? outDirectory : resolve(outDirectory);
  ensureOutputDirectory(outputDirectory, options.overwrite ?? false);
  const artifactDirectory = join(outputDirectory, ARTIFACT_DIRECTORY);
  ensureOutputDirectory(artifactDirectory, options.overwrite ?? false);
  const runJson = join(outputDirectory, RUN_JSON_FILE);
  const gamesCsv = join(outputDirectory, GAMES_CSV_FILE);
  if (!(options.overwrite ?? false)) {
    for (const path of [runJson, gamesCsv]) {
      if (existsSync(path)) throw new Error(`Refusing to overwrite existing file: ${path}`);
    }
  }
  const artifactPaths: string[] = [];
  const fullRuns = report._runs;
  for (const [index, run] of report.games.entries()) {
    if (!fullRuns?.[index]?.artifact) {
      throw new Error('Full replay/failure artifacts are required; pass the report returned by runSimulation');
    }
    const path = join(artifactDirectory, artifactFileName(index, run));
    if (!options.overwrite && existsSync(path)) throw new Error(`Refusing to overwrite existing artifact: ${path}`);
    const artifact = fullRuns[index]!.artifact;
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    artifactPaths.push(path);
  }
  writeFileSync(runJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(gamesCsv, metricsToCsv(report.games), 'utf8');
  return { runJson, gamesCsv, artifacts: artifactPaths };
}

/** Write a report together with full per-game artifacts returned by runSimulation. */
export function writeSimulationRuns(
  report: SimulationReport,
  runs: readonly AgentRun[],
  outDirectory: string,
  options: { overwrite?: boolean } = {},
): SimulationOutputPaths {
  const outputDirectory = isAbsolute(outDirectory) ? outDirectory : resolve(outDirectory);
  ensureOutputDirectory(outputDirectory, options.overwrite ?? false);
  const artifactDirectory = join(outputDirectory, ARTIFACT_DIRECTORY);
  ensureOutputDirectory(artifactDirectory, options.overwrite ?? false);
  const runJson = join(outputDirectory, RUN_JSON_FILE);
  const gamesCsv = join(outputDirectory, GAMES_CSV_FILE);
  if (!(options.overwrite ?? false) && (existsSync(runJson) || existsSync(gamesCsv))) throw new Error(`Refusing to overwrite existing output in ${outputDirectory}`);
  const artifactPaths: string[] = [];
  for (const [index, run] of runs.entries()) {
    const path = join(artifactDirectory, artifactFileName(index, run.metrics));
    if (!options.overwrite && existsSync(path)) throw new Error(`Refusing to overwrite existing artifact: ${path}`);
    writeFileSync(path, `${JSON.stringify(run.artifact, null, 2)}\n`, 'utf8');
    artifactPaths.push(path);
  }
  writeFileSync(runJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(gamesCsv, metricsToCsv(report.games), 'utf8');
  return { runJson, gamesCsv, artifacts: artifactPaths };
}

/**
 * Execute a potentially large CLI batch while writing each replay artifact as
 * soon as its game finishes. Only compact metrics remain resident, avoiding a
 * heap-sized collection of full observation/action histories.
 */
export function runSimulationToDirectory(
  options: SimulationRunOptions,
  outDirectory: string,
  writeOptions: { overwrite?: boolean; summaryOnly?: boolean } = {},
): StreamedSimulationOutput {
  const normalized = normalizeRunOptions(options);
  const outputDirectory = isAbsolute(outDirectory) ? outDirectory : resolve(outDirectory);
  const overwrite = writeOptions.overwrite ?? false;
  const summaryOnly = writeOptions.summaryOnly ?? false;
  ensureOutputDirectory(outputDirectory, overwrite);
  const artifactDirectory = join(outputDirectory, ARTIFACT_DIRECTORY);
  ensureOutputDirectory(artifactDirectory, overwrite);
  const runJson = join(outputDirectory, RUN_JSON_FILE);
  const gamesCsv = join(outputDirectory, GAMES_CSV_FILE);
  if (!overwrite && (existsSync(runJson) || existsSync(gamesCsv))) {
    throw new Error(`Refusing to overwrite existing output in ${outputDirectory}`);
  }

  const games: GameMetrics[] = [];
  const failures: SimulationReport['failures'] = [];
  const artifactPaths: string[] = [];
  simulation: for (const agent of normalized.agents) {
    for (const seed of normalized.seeds) {
      const run = runAgentGame(seed, {
        strategy: agent,
        config: normalized.config,
        limits: normalized.limits,
        buildId: normalized.buildId,
        summaryOnly,
        gameFactory: options.gameFactory,
        debugSnapshot: options.debugSnapshot,
        assertInvariant: options.assertInvariant,
      });
      const artifactIndex = games.length;
      games.push(run.metrics);
      if (run.failure) {
        failures.push({
          agent: run.agent.id,
          seed: run.seed,
          artifactIndex,
          code: run.failure.code,
          message: run.failure.message,
        });
      }
      if (!summaryOnly) {
        const path = join(artifactDirectory, artifactFileName(artifactIndex, run.metrics));
        if (!overwrite && existsSync(path)) throw new Error(`Refusing to overwrite existing artifact: ${path}`);
        writeFileSync(path, `${JSON.stringify(run.artifact, null, 2)}\n`, 'utf8');
        artifactPaths.push(path);
      }
      if (normalized.failFast && run.technicalFailure) break simulation;
    }
  }

  const report = createSimulationReport(normalized, games, failures);
  writeFileSync(runJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(gamesCsv, metricsToCsv(report.games), 'utf8');
  return { report, paths: { runJson, gamesCsv, artifacts: artifactPaths } };
}

export function usage(): string {
  return `Usage: npx --no-install vite-node --script src/agent/sim-cli.ts --agent=balanced --games=1000 --seed=1 --summary-only --out=output/simulations/run-name

Options:
  --agent=random|balanced[,agent]   Agent strategy (default: balanced)
  --games=N                        Number of games (default: 1)
  --seed=N                         First seed (default: 1)
  --seeds=N,M,...                  Explicit seed list
  --config=PATH                    JSON GameConfig or override file
  --config-json=JSON               Inline JSON GameConfig or overrides
  --max-decisions-per-turn=N       Runner per-turn safety limit
  --max-decisions-per-game=N       Runner whole-game safety limit
  --max-turns=N                    Runner turn safety limit
  --fail-fast                      Stop after the first technical failure
  --out=PATH                       Output directory
  --overwrite                      Explicitly permit replacing output files
  --summary-only                   Write run.json and games.csv without full per-game Replay artifacts
  --help                            Show this help
`;
}

/** CLI entry point, kept separate so tests can invoke parsing and execution. */
export function runCli(argv: readonly string[] = process.argv.slice(2)): number {
  const parsed = parseSimulationArgs(argv);
  if (parsed.help) {
    process.stdout.write(usage());
    return 0;
  }
  const config = readConfig(parsed);
  const seeds = parsed.seeds ?? createSeeds(parsed.games, parsed.seed);
  const { report } = runSimulationToDirectory({
    agents: parsed.agents,
    seeds,
    config,
    limits: parsed.limits,
    failFast: parsed.failFast,
    buildId: parsed.buildId,
  }, parsed.out, { overwrite: parsed.overwrite, summaryOnly: parsed.summaryOnly });
  process.stdout.write(`${JSON.stringify({ output: resolve(parsed.out), games: report.games.length, technicalFailures: report.technicalFailureCount, exitCode: report.exitCode })}\n`);
  return report.exitCode;
}

const entry = process.argv[1];
const invokedAsCli = Boolean(
  (entry && import.meta.url === pathToFileURL(resolve(entry)).href)
  || process.argv.some((argument) => /(?:^|[\\/])sim-cli\.(?:ts|js|mjs)$/.test(argument)),
);
if (invokedAsCli) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
