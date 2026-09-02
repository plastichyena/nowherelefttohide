import { assertValidGameConfig, cloneConfig, createDefaultConfig } from '../core/config';
import type { GameAction, GameConfig, GameEvent } from '../core/types';
import { actionKey, cloneAction, cloneJson, sortActions } from './action';
import { collectGameMetrics, type GameMetrics } from './metrics';
import { createAgentGame } from './game';
import { compactArtifactObservation, restoreArtifactObservation } from './observation';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  GAME_RULES_VERSION,
  OBSERVATION_API_VERSION,
  type AgentActionError,
  type AgentDecision,
  type AgentDecisionTrace,
  type AgentGame,
  type AgentGameResult,
  type InvalidActionAttempt,
  type AgentObservation,
  type AgentPublicEvent,
  type AgentPublicRunArtifact,
  type AgentRunArtifact,
  type AgentStepResult,
  type AgentStrategyId,
  type GameAgent,
} from './types';
import { RandomAgent } from './randomAgent';
export { RandomAgent, createRandomAgent } from './randomAgent';
import { BalancedAgent, createBalancedAgent } from './balancedAgent';
export { BalancedAgent, createBalancedAgent } from './balancedAgent';

/** A technical failure is intentionally distinct from an in-game loss. */
export interface AgentTechnicalFailure {
  code: string;
  message: string;
  stack?: string;
  decision: number;
  turn: number;
  phase: string;
  action?: GameAction | null;
  observationBeforeFailure: AgentObservation | null;
  observationAfterFailure: AgentObservation | null;
  stateBeforeFailure?: unknown;
  stateAfterFailure?: unknown;
}

export interface AgentFailureArtifact extends AgentRunArtifact {
  artifactType: 'failure';
  metrics: GameMetrics;
  events: AgentPublicEvent[];
  failure: AgentTechnicalFailure;
}

export interface AgentReplayArtifact extends AgentRunArtifact {
  artifactType: 'replay';
  metrics: GameMetrics;
  events: AgentPublicEvent[];
}

export interface AgentRun {
  seed: number;
  agent: { id: string; version: string; strategy: string };
  config: GameConfig;
  initialObservation: AgentObservation | null;
  finalObservation: AgentObservation | null;
  /** Includes initial and all post-step observations; useful for metrics only. */
  observations: AgentObservation[];
  actions: GameAction[];
  events: AgentPublicEvent[];
  decisionTrace: AgentDecisionTrace[];
  result: AgentGameResult | null;
  metrics: GameMetrics;
  artifact: AgentReplayArtifact | AgentFailureArtifact;
  failure: AgentTechnicalFailure | null;
  technicalFailure: boolean;
}

export interface AgentRunnerLimits {
  /** Includes the EndTurn action when one is forced at the limit. */
  maxDecisionsPerTurn: number;
  maxDecisionsPerGame: number;
  /** Safety limit owned by the runner, not by GameConfig. */
  maxTurns: number;
}

export const DEFAULT_AGENT_RUNNER_LIMITS: AgentRunnerLimits = {
  maxDecisionsPerTurn: 100,
  maxDecisionsPerGame: 3_100,
  maxTurns: 100,
};

export interface AgentRunnerGameOptions {
  config?: GameConfig;
  buildId?: string;
  strategy?: AgentStrategyId;
  agent?: GameAgent;
  /** One fresh AgentGame is created for each call. */
  gameFactory?: AgentGameFactory;
  limits?: Partial<AgentRunnerLimits>;
  /** Stop the runner when a callback cannot inspect/assert a debug snapshot. */
  debugSnapshot?: (game: AgentGame) => unknown;
  assertInvariant?: (snapshot: unknown, stage: 'before' | 'after') => void;
  failFast?: boolean;
  /** Keep only fields consumed by metrics and omit the in-adapter Replay trace. */
  summaryOnly?: boolean;
}

export interface AgentGameFactory {
  (seed: number, config: GameConfig, agent: GameAgent): AgentGame;
}

export interface AgentBatchOptions extends AgentRunnerGameOptions {
  seeds?: readonly number[];
  seed?: number;
  games?: number;
  failFast?: boolean;
}

export interface AgentBatchRun {
  seeds: number[];
  games: AgentRun[];
  completed: number;
  technicalFailures: number;
  stoppedEarly: boolean;
}

function clone<T>(value: T): T {
  return cloneJson(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compare JSON-compatible values without treating object key insertion order as game state. */
function jsonEquivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEquivalent(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && jsonEquivalent(left[key], right[key]));
}

function errorFromUnknown(error: unknown, fallbackCode: string, fallbackMessage: string): AgentActionError {
  if (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { code: fallbackCode, message: error.message || fallbackMessage };
  return { code: fallbackCode, message: String(error) || fallbackMessage };
}

function normalizeLimits(config: GameConfig, limits: Partial<AgentRunnerLimits> | undefined): AgentRunnerLimits {
  const values = {
    maxDecisionsPerTurn: limits?.maxDecisionsPerTurn ?? Math.max(1, config.maxActionsPerTurn),
    // This is a runner-owned technical safety budget.  In particular it must
    // not grow when a scenario moves the in-game Final Horde later.
    maxDecisionsPerGame: limits?.maxDecisionsPerGame ?? Math.max(
      1,
      DEFAULT_AGENT_RUNNER_LIMITS.maxTurns * (Math.max(1, config.maxActionsPerTurn) + 1) + 1,
    ),
    maxTurns: limits?.maxTurns ?? DEFAULT_AGENT_RUNNER_LIMITS.maxTurns,
  };
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive safe integer`);
  }
  return values;
}

function strategyForAgent(agent: GameAgent, requested?: AgentStrategyId): string {
  if (requested) return requested;
  if (agent.id === 'random') return 'random';
  if (agent.id === 'balanced') return 'balanced';
  return agent.id;
}

function defaultFactory(buildId: string | undefined, recordHistory = true): AgentGameFactory {
  return () => createAgentGame({ buildId, recordHistory });
}

function metricObservation(observation: AgentObservation): AgentObservation {
  const recorded = clone(observation);
  // These projections dominate a 31x31 observation but collectGameMetrics
  // intentionally never reads them. Dropping them keeps long summary batches
  // bounded without changing Agent decisions or full Replay runs.
  recorded.map.tiles = [];
  recorded.supply.suppliedTileKeys = [];
  recorded.constructibleFacilityPositionCandidates = [];
  return recorded;
}

function defaultAgent(strategy: AgentStrategyId, seed: number): GameAgent {
  if (strategy === 'random') return new RandomAgent(seed);
  return createBalancedAgent();
}

function phaseOf(observation: AgentObservation | null): string {
  return observation?.phase ?? 'unknown';
}

function asPublicEvents(events: readonly unknown[]): AgentPublicEvent[] {
  return events.filter((event): event is AgentPublicEvent => isRecord(event) && typeof event.type === 'string').map((event) => clone(event as AgentPublicEvent));
}

function verificationEventsFromSnapshot(snapshot: unknown): GameEvent[] {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.events)) return [];
  return snapshot.events
    .filter((event): event is GameEvent => isRecord(event) && typeof event.type === 'string')
    .map((event) => clone(event));
}

/** Exact statistics stay in local/CI verification artifacts only. */
function verificationStatisticsFromSnapshot(snapshot: unknown): unknown {
  if (!isRecord(snapshot) || !isRecord(snapshot.statistics)) return undefined;
  return clone(snapshot.statistics);
}

function publicActionError(code: string, message: string): AgentActionError {
  return { code, message };
}

function placeholderArtifact(
  seed: number,
  config: GameConfig,
  agent: GameAgent,
  buildId: string,
  actions: readonly GameAction[],
  traces: readonly AgentDecisionTrace[],
  result: AgentGameResult | null,
  initialObservation: AgentObservation | null,
): AgentRunArtifact {
  return {
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    gameRulesVersion: config.version,
    agentApiVersion: AGENT_API_VERSION,
    observationApiVersion: OBSERVATION_API_VERSION,
    bridgeApiVersion: BRIDGE_API_VERSION,
    buildId,
    mapId: config.mapId,
    seed,
    config: cloneConfig(config),
    agent: { id: agent.id, version: agent.version, strategy: strategyForAgent(agent) },
    initialRoadArrivalSchedule: initialObservation?.roadBranches.map((branch) => ({
      branchId: branch.branchId,
      nextArrivalTurn: branch.nextArrivalTurn,
    })) ?? [],
    acceptedActions: clone([...actions]),
    invalidAttempts: [],
    decisionTrace: clone([...traces]),
    result: clone(result),
    fixedMap: initialObservation ? clone(initialObservation.map) : undefined,
  };
}

function finalHordeTurnFromConfig(config: GameConfig): number {
  return config.horde.waves.find((wave) => wave.final)?.turn ?? 0;
}

function enrichArtifact(
  source: AgentPublicRunArtifact | AgentRunArtifact | null,
  fallback: AgentRunArtifact,
  actions: readonly GameAction[],
  traces: readonly AgentDecisionTrace[],
  result: AgentGameResult | null,
  agent: GameAgent,
  strategy: string,
): AgentRunArtifact {
  const artifact: AgentRunArtifact = source && isRecord(source)
    ? clone(source) as unknown as AgentRunArtifact
    : fallback;
  artifact.artifactSchemaVersion = ARTIFACT_SCHEMA_VERSION;
  artifact.appVersion = APP_VERSION;
  artifact.gameRulesVersion = fallback.gameRulesVersion;
  artifact.agentApiVersion = AGENT_API_VERSION;
  artifact.observationApiVersion = OBSERVATION_API_VERSION;
  artifact.bridgeApiVersion = BRIDGE_API_VERSION;
  artifact.buildId = artifact.buildId || fallback.buildId;
  artifact.mapId = artifact.mapId || fallback.mapId;
  artifact.seed = seedSafe(artifact.seed, fallback.seed);
  artifact.config = cloneConfig(fallback.config);
  artifact.agent = { id: agent.id, version: agent.version, strategy };
  artifact.acceptedActions = clone([...actions]);
  artifact.invalidAttempts = Array.isArray(artifact.invalidAttempts) ? clone(artifact.invalidAttempts) : [];
  artifact.decisionTrace = clone([...traces]);
  artifact.result = clone(result);
  if (!artifact.fixedMap && fallback.fixedMap) artifact.fixedMap = clone(fallback.fixedMap);
  if (!Array.isArray(artifact.initialRoadArrivalSchedule)) {
    artifact.initialRoadArrivalSchedule = clone(fallback.initialRoadArrivalSchedule);
  }
  return artifact;
}

function seedSafe(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

function failure(
  code: string,
  message: string,
  observation: AgentObservation | null,
  action: GameAction | null,
  decision: number,
  beforeState: unknown,
  afterState: unknown,
  error?: unknown,
): AgentTechnicalFailure {
  let actionCopy: GameAction | null = null;
  if (action) {
    try {
      actionCopy = cloneAction(action);
    } catch {
      actionCopy = action;
    }
  }
  return {
    code,
    message,
    stack: error instanceof Error ? error.stack : undefined,
    decision,
    turn: observation?.turn ?? 0,
    phase: phaseOf(observation),
    action: actionCopy,
    observationBeforeFailure: observation ? clone(observation) : null,
    observationAfterFailure: null,
    stateBeforeFailure: beforeState,
    stateAfterFailure: afterState,
  };
}

function asFailureError(error: AgentTechnicalFailure): AgentActionError {
  return publicActionError(error.code, error.message);
}

/**
 * Run one Agent through the same AgentGame contract used by a browser Agent.
 * No GameState is read here; optional debugSnapshot is explicitly opt-in and
 * is used only to make local/CI technical failures diagnosable.
 */
export function runAgentGame(seed: number, options: AgentRunnerGameOptions = {}): AgentRun {
  if (!Number.isSafeInteger(seed)) throw new Error('seed must be a safe integer');
  const config = cloneConfig(options.config ?? createDefaultConfig());
  assertValidGameConfig(config);
  const strategy = options.strategy ?? 'balanced';
  const agent = options.agent ?? defaultAgent(strategy, seed);
  const buildId = options.buildId ?? 'local-unknown';
  const limits = normalizeLimits(config, options.limits);
  const gameFactory = options.gameFactory ?? defaultFactory(buildId, !options.summaryOnly);
  const actions: GameAction[] = [];
  const events: AgentPublicEvent[] = [];
  const observations: AgentObservation[] = [];
  const decisionTrace: AgentDecisionTrace[] = [];
  const invalidAttempts: InvalidActionAttempt[] = [];
  let observation: AgentObservation | null = null;
  let finalObservation: AgentObservation | null = null;
  let result: AgentGameResult | null = null;
  let game: AgentGame | null = null;
  let runFailure: AgentTechnicalFailure | null = null;
  let debugBefore: unknown;
  let debugAfter: unknown;
  let currentTurn = -1;
  let decisionsThisTurn = 0;
  let totalAgentDecisions = 0;

  const fail = (code: string, message: string, action: GameAction | null = null, thrown?: unknown): void => {
    if (runFailure) return;
    if (action) {
      let actionCopy: unknown = action;
      try { actionCopy = cloneAction(action); } catch { actionCopy = clone(action); }
      invalidAttempts.push({ decision: actions.length + 1, action: actionCopy, error: publicActionError(code, message) });
    }
    runFailure = failure(code, message, observation, action, actions.length + 1, debugBefore, debugAfter, thrown);
  };
  const snapshot = (stage: 'before' | 'after'): void => {
    if (!options.debugSnapshot || !game) return;
    try {
      const value = clone(options.debugSnapshot(game));
      if (stage === 'before') debugBefore = value;
      else debugAfter = value;
      if (options.assertInvariant) options.assertInvariant(value, stage);
    } catch (thrown) {
      fail('INVARIANT_FAILURE', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
    }
  };

  const snapshotFromGame = (stage: 'before' | 'after'): void => {
    if (options.debugSnapshot || !game) {
      snapshot(stage);
      return;
    }
    const candidate = game as AgentGame & { getDebugState?: () => unknown };
    if (typeof candidate.getDebugState !== 'function') return;
    try {
      const value = clone(candidate.getDebugState());
      if (stage === 'before') debugBefore = value;
      else debugAfter = value;
      if (options.assertInvariant) options.assertInvariant(value, stage);
    } catch (thrown) {
      fail('INVARIANT_FAILURE', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
    }
  };

  try {
    game = gameFactory(seed, config, agent);
    if (!game || typeof game.reset !== 'function') throw new Error('AgentGame factory returned an invalid game');
    observation = clone(game.reset({
      seed,
      configOverrides: config,
      agent: { id: agent.id },
    }));
    currentTurn = observation.turn;
    decisionsThisTurn = 0;
    observations.push(options.summaryOnly ? metricObservation(observation) : clone(observation));
    snapshotFromGame('before');
  } catch (thrown) {
    fail('RESET_THREW', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
  }

  while (!runFailure && observation && game) {
    if (observation.gameOver || game.isGameOver()) {
      finalObservation = clone(observation);
      try {
        result = clone(game.getResult());
      } catch (thrown) {
        fail('RESULT_THREW', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
      }
      break;
    }
    if (observation.turn > limits.maxTurns) {
      fail('TURN_SAFETY_LIMIT', `Runner maximum turn limit (${limits.maxTurns}) reached`);
      break;
    }
    if (observation.turn !== currentTurn) {
      currentTurn = observation.turn;
      decisionsThisTurn = 0;
    }
    if (actions.length >= limits.maxDecisionsPerGame) {
      fail('GAME_DECISION_SAFETY_LIMIT', `Runner maximum game decisions (${limits.maxDecisionsPerGame}) reached`);
      break;
    }

    let legal: GameAction[];
    try {
      const candidate = game.getLegalActions();
      if (!Array.isArray(candidate)) throw new Error('getLegalActions() did not return an array');
      legal = sortActions(candidate.map(cloneAction));
    } catch (thrown) {
      fail('LEGAL_ACTIONS_FAILED', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
      break;
    }
    if (legal.length === 0) {
      fail('NO_LEGAL_ACTIONS', 'AgentGame returned no legal actions before Game Over');
      break;
    }

    const turnForDecision = observation.turn;
    let decision: AgentDecision;
    try {
      if (decisionsThisTurn >= limits.maxDecisionsPerTurn) {
        const endTurn = legal.find((candidate) => candidate.type === 'EndTurn');
        if (!endTurn) {
          fail('TURN_DECISION_SAFETY_LIMIT', `Runner maximum decisions for turn ${currentTurn} reached`);
          break;
        }
        totalAgentDecisions += 1;
        decision = { action: cloneAction(endTurn), trace: { priorityGoal: 'end_turn', selectedAction: cloneAction(endTurn), selectedScore: 0, topCandidates: [], reasonCodes: ['runner_turn_limit'] } };
      } else {
        totalAgentDecisions += 1;
        const decided = agent.decide(clone(observation), clone(legal));
        if (!decided || typeof decided !== 'object' || !('action' in decided)) throw new Error('Agent decision did not contain an action');
        decision = decided;
      }
    } catch (thrown) {
      fail('AGENT_THREW', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
      break;
    }

    let selected: GameAction;
    try {
      const key = actionKey(decision.action);
      const matching = legal.find((candidate) => actionKey(candidate) === key);
      if (!matching) {
        fail('AGENT_RETURNED_ILLEGAL_ACTION', 'Agent selected an action outside getLegalActions()', decision.action);
        break;
      }
      selected = cloneAction(matching);
    } catch (thrown) {
      fail('AGENT_RETURNED_INVALID_ACTION', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
      break;
    }

    const traceSource = decision.trace;
    if (traceSource) {
      const reasonCodes = [...(traceSource.reasonCodes ?? [])];
      const publicSummary = traceSource.decisionSummary?.trim()
        || `${traceSource.priorityGoal}: ${reasonCodes.slice(0, 3).join(', ') || 'selected highest-ranked legal action'}`;
      const trace: AgentDecisionTrace = {
        turn: turnForDecision,
        decision: actions.length + 1,
        priorityGoal: traceSource.priorityGoal,
        selectedAction: cloneAction(selected),
        selectedScore: traceSource.selectedScore,
        topCandidates: clone(traceSource.topCandidates ?? []),
        reasonCodes,
        decisionSummary: [...publicSummary].slice(0, 500).join(''),
      };
      decisionTrace.push(trace);
    }

    snapshotFromGame('before');
    if (runFailure) break;
    let stepResult: AgentStepResult;
    try {
      stepResult = game.step(selected);
    } catch (thrown) {
      fail('STEP_THREW', thrown instanceof Error ? thrown.message : String(thrown), selected, thrown);
      snapshotFromGame('after');
      const recordedFailure = runFailure as AgentTechnicalFailure | null;
      if (recordedFailure) recordedFailure.stateAfterFailure = debugAfter;
      break;
    }
    if (!stepResult || typeof stepResult !== 'object' || !stepResult.observation) {
      fail('INVALID_STEP_RESULT', 'AgentGame.step() returned an invalid result', selected);
      break;
    }
    const nextObservation = clone(stepResult.observation);
    if (stepResult.error) {
      const publicError = errorFromUnknown(stepResult.error, 'ACTION_REJECTED', 'AgentGame rejected a legal action');
      fail('ACTION_REJECTED', `${publicError.code}: ${publicError.message}`, selected);
      const recordedFailure = runFailure as AgentTechnicalFailure | null;
      if (recordedFailure) recordedFailure.observationAfterFailure = nextObservation;
      snapshotFromGame('after');
      if (recordedFailure) recordedFailure.stateAfterFailure = debugAfter;
      break;
    }
    actions.push(cloneAction(selected));
    events.push(...asPublicEvents(stepResult.events ?? []));
    observation = nextObservation;
    observations.push(options.summaryOnly ? metricObservation(observation) : clone(observation));
    finalObservation = clone(observation);
    decisionsThisTurn += 1;
    snapshotFromGame('after');
    if (runFailure) break;
    if (stepResult.gameOver || observation.gameOver) {
      try {
        result = clone(stepResult.result ?? game.getResult());
      } catch (thrown) {
        fail('RESULT_THREW', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
      }
      break;
    }
  }

  if (!runFailure && !result && finalObservation?.gameOver === true) {
    try {
      result = clone(game?.getResult() ?? null);
    } catch (thrown) {
      fail('RESULT_THREW', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
    }
  }
  if (!runFailure && finalObservation?.gameOver && !result) {
    fail('RESULT_MISSING', 'AgentGame reached Game Over without a result');
  }

  let sourceArtifact: AgentPublicRunArtifact | null = null;
  if (game && !options.summaryOnly) {
    try {
      sourceArtifact = clone(game.getRunArtifact());
    } catch (thrown) {
      if (!runFailure) fail('ARTIFACT_THREW', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
    }
  }
  const fallback = placeholderArtifact(seed, config, agent, buildId, actions, decisionTrace, result, observations[0] ?? null);
  const strategyName = strategyForAgent(agent, options.strategy);
  const baseArtifact = enrichArtifact(sourceArtifact, fallback, actions, decisionTrace, result, agent, strategyName);
  baseArtifact.observationTrace = options.summaryOnly
    ? observations.length > 0
      ? [compactArtifactObservation(observations[0]), compactArtifactObservation(observations.at(-1) ?? observations[0])]
      : []
    : observations.map(compactArtifactObservation);
  if (observations[0] && !options.summaryOnly) baseArtifact.fixedMap = clone(observations[0].map);
  else delete baseArtifact.fixedMap;
  delete baseArtifact.verificationEvents;
  const verificationEvents = verificationEventsFromSnapshot(debugAfter);
  if (verificationEvents.length > 0) baseArtifact.verificationEvents = verificationEvents;
  if (observations[0]) {
    baseArtifact.initialRoadArrivalSchedule = observations[0].roadBranches.map((branch) => ({
      branchId: branch.branchId,
      nextArrivalTurn: branch.nextArrivalTurn,
    }));
  }
  if (invalidAttempts.length > 0) {
    const existing = baseArtifact.invalidAttempts;
    for (const attempt of invalidAttempts) {
      const duplicate = existing.some((candidate) => candidate.decision === attempt.decision && candidate.error.code === attempt.error.code);
      if (!duplicate) existing.push(clone(attempt));
    }
  }
  const recordedFailure = runFailure as AgentTechnicalFailure | null;
  const metricFailure = recordedFailure ? { code: recordedFailure.code, message: recordedFailure.message } : null;
  const metrics = collectGameMetrics({
    initialObservation: observations[0] ?? ({
      apiVersion: OBSERVATION_API_VERSION,
      gameRulesVersion: config.version,
      turn: 0,
      finalHordeTurn: finalHordeTurnFromConfig(config),
      phase: 'gameOver',
      map: { id: config.mapId, width: 31, height: 31, coordinateSystem: 'axial-q-r', tiles: [], hordeSpawnReserve: [] },
      roadBranches: [],
      supply: { initialRadius: config.checkpoint.initialSupplyRadius, suppliedTileKeys: [], branchRadii: [] },
      resources: { food: 0, civilianGoods: 0, militaryGoods: 0, fuel: 0, electricityCapacity: 0, electricityRequired: 0 },
      population: { healthyCivilians: 0, cityResidents: 0, productionWorkers: 0, unitPopulation: 0, waitingRefugees: 0, screeningRefugees: 0, approvedRefugees: 0, infected: 0 },
      facilities: [], units: [], zombies: [], checkpoints: [], checkpointPositionCandidates: [], constructibleFacilityPositionCandidates: [],
      horde: {
        warningType: 'none',
        warningDirections: [],
        nextWaveIndex: null,
        nextWave: null,
        spawnTurn: null,
        finalHordeStatus: 'notStarted',
        turnsRemaining: 0,
        nextSpawnTurn: null,
      },
      victory: {
        finalHordeDefeated: false,
        suppliedAreaZombieClear: false,
        suppliedAreaInfectionClear: false,
      },
      finalHordeDefeated: false,
      suppliedAreaZombieClear: false,
      suppliedAreaInfectionClear: false,
      endTurnForecast: {
        populationConsumers: 0,
        overcrowding: { cities: [], additionalFood: 0, additionalCivilianGoods: 0 },
        food: { startingStock: 0, projectedProduction: 0, maintenanceRequired: 0, endingStock: 0, available: 0, productionInputRequired: 0, required: 0, shortage: 0 },
        civilianGoods: { startingStock: 0, projectedProduction: 0, maintenanceRequired: 0, endingStock: 0, available: 0, productionInputRequired: 0, required: 0, shortage: 0, productionInputDemand: 0, productionInputAllocated: 0, productionInputShortage: 0, maintenanceShortage: 0 },
        militaryGoods: {
          startingStock: 0,
          projectedProduction: 0,
          totalRefillDemand: 0,
          projectedTotalRefilled: 0,
          totalUnfilledRefillDemand: 0,
          projectedEndingStock: 0,
          units: [],
        },
        fuel: { startingStock: 0, projectedProduction: 0, maintenanceRequired: 0, endingStock: 0, available: 0, productionInputRequired: 0, required: 0, shortage: 0, turnStartFuel: 0, windPowerAvailable: 0, powerPlantPhysicalCapacity: 0, projectedPowerFuelDemand: 0, projectedPowerFuelUsed: 0, fuelAfterPower: 0, projectedUnitRefillDemand: 0, projectedUnitFuelRefilled: 0, projectedTotalFuelDemand: 0, projectedRefineryProduction: 0, projectedEndingFuel: 0, powerFuelShortage: 0, unitRefillFuelShortage: 0, totalFuelShortage: 0, generationFuelDemand: 0, projectedFuelUsed: 0, generationFuelShortage: 0 },
        electricity: { physicalGenerationCapacity: 0, fuelLimitedGenerationCapacity: 0, availableGenerationCapacity: 0, requiredPowerDemand: 0, requiredPowerAllocated: 0, unpoweredFacilities: [], capacity: 0, required: 0, shortage: 0 },
      },
      strategicForecast: {
        resources: {
          food: { resource: 'food', currentSupply: 0, currentDemand: 0, contributors: [], largestContributorFacilityId: null, projectedSupplyWithoutLargestContributor: 0, shortageWithoutLargestContributor: 0, singlePointOfFailure: false, currentlyShort: false },
          civilianGoods: { resource: 'civilianGoods', currentSupply: 0, currentDemand: 0, contributors: [], largestContributorFacilityId: null, projectedSupplyWithoutLargestContributor: 0, shortageWithoutLargestContributor: 0, singlePointOfFailure: false, currentlyShort: false },
          militaryGoods: { resource: 'militaryGoods', currentSupply: 0, currentDemand: 0, contributors: [], largestContributorFacilityId: null, projectedSupplyWithoutLargestContributor: 0, shortageWithoutLargestContributor: 0, singlePointOfFailure: false, currentlyShort: false },
          fuel: { resource: 'fuel', currentSupply: 0, currentDemand: 0, contributors: [], largestContributorFacilityId: null, projectedSupplyWithoutLargestContributor: 0, shortageWithoutLargestContributor: 0, singlePointOfFailure: false, currentlyShort: false },
          electricity: { resource: 'electricity', currentSupply: 0, currentDemand: 0, contributors: [], largestContributorFacilityId: null, projectedSupplyWithoutLargestContributor: 0, shortageWithoutLargestContributor: 0, singlePointOfFailure: false, currentlyShort: false },
        },
        guaranteedDefeat: { guaranteed: false, causeResource: null, foodShortage: 0, civilianGoodsShortage: 0, projectedHealthyCivilians: 0, defeatReason: null },
      },
      gameOver: true,
      result: null,
    } as unknown as AgentObservation),
    finalObservation,
    observations,
    actions,
    events,
    decisionTrace,
    result,
    invalidAttemptCount: baseArtifact.invalidAttempts.length,
    invalidAttempts: baseArtifact.invalidAttempts,
    totalAgentDecisions,
    agent: { id: agent.id, version: agent.version, strategy: strategyName },
    config,
    buildId,
    seed,
    failure: metricFailure,
    verificationStatistics: verificationStatisticsFromSnapshot(debugAfter),
  });

  baseArtifact.metrics = clone(metrics);
  baseArtifact.events = clone(events);
  baseArtifact.artifactType = recordedFailure ? 'failure' : 'replay';
  const replayArtifact: AgentReplayArtifact = {
    ...baseArtifact,
    artifactType: runFailure ? 'failure' : 'replay',
    metrics,
    events: clone(events),
  } as AgentReplayArtifact;
  if (recordedFailure) {
    const failureArtifact: AgentFailureArtifact = {
      ...replayArtifact,
      artifactType: 'failure',
      failure: clone(recordedFailure),
    };
    return {
      seed,
      agent: { id: agent.id, version: agent.version, strategy: strategyName },
      config,
      initialObservation: observations[0] ?? null,
      finalObservation,
      observations,
      actions,
      events,
      decisionTrace,
      result,
      metrics,
      artifact: failureArtifact,
      failure: recordedFailure,
      technicalFailure: true,
    };
  }
  return {
    seed,
    agent: { id: agent.id, version: agent.version, strategy: strategyName },
    config,
    initialObservation: observations[0] ?? null,
    finalObservation,
    observations,
    actions,
    events,
    decisionTrace,
    result,
    metrics,
    artifact: replayArtifact,
    failure: null,
    technicalFailure: false,
  };
}

export function runAgentGames(seeds: readonly number[], options: AgentRunnerGameOptions = {}): AgentBatchRun {
  const normalizedSeeds = [...seeds];
  const games: AgentRun[] = [];
  const failFast = (options as AgentBatchOptions).failFast ?? false;
  for (const seed of normalizedSeeds) {
    const run = runAgentGame(seed, options);
    games.push(run);
    if (failFast && run.technicalFailure) break;
  }
  return {
    seeds: normalizedSeeds,
    games,
    completed: games.filter((game) => !game.technicalFailure).length,
    technicalFailures: games.filter((game) => game.technicalFailure).length,
    stoppedEarly: games.length < normalizedSeeds.length,
  };
}

export function createSeeds(games: number, seed = 1): number[] {
  if (!Number.isSafeInteger(games) || games < 0) throw new Error('games must be a non-negative safe integer');
  if (!Number.isSafeInteger(seed)) throw new Error('seed must be a safe integer');
  return Array.from({ length: games }, (_, index) => seed + index);
}

export function resolveSeeds(options: Pick<AgentBatchOptions, 'seeds' | 'seed' | 'games'>): number[] {
  if (options.seeds !== undefined) {
    const values = [...options.seeds];
    if (values.some((seed) => !Number.isSafeInteger(seed))) throw new Error('seeds must contain only safe integers');
    return values;
  }
  return createSeeds(options.games ?? 1, options.seed ?? 1);
}

export function runAgentBatch(options: AgentBatchOptions = {}): AgentBatchRun {
  return runAgentGames(resolveSeeds(options), options);
}

export class AgentRunner {
  public readonly options: AgentRunnerGameOptions;

  public constructor(options: AgentRunnerGameOptions = {}) {
    this.options = { ...options, config: cloneConfig(options.config ?? createDefaultConfig()) };
  }

  public run(seed: number): AgentRun {
    return runAgentGame(seed, this.options);
  }

  public runMany(seeds: readonly number[], failFast = false): AgentBatchRun {
    return runAgentGames(seeds, { ...this.options, failFast });
  }
}

export function createAgent(strategy: AgentStrategyId, seed: number): GameAgent {
  return defaultAgent(strategy, seed);
}

function artifactValidationError(artifact: AgentRunArtifact): AgentActionError | null {
  if (!isRecord(artifact)) return publicActionError('artifact_invalid', 'Replay artifact must be a JSON object');
  if (typeof artifact.appVersion !== 'string' || artifact.appVersion.length === 0) {
    return publicActionError('artifact_invalid', 'Replay artifact appVersion metadata must be a non-empty string');
  }
  const versions: Array<[string, unknown, string]> = [
    ['artifactSchemaVersion', artifact.artifactSchemaVersion, ARTIFACT_SCHEMA_VERSION],
    ['gameRulesVersion', artifact.gameRulesVersion, GAME_RULES_VERSION],
    ['agentApiVersion', artifact.agentApiVersion, AGENT_API_VERSION],
    ['observationApiVersion', artifact.observationApiVersion, OBSERVATION_API_VERSION],
    ['bridgeApiVersion', artifact.bridgeApiVersion, BRIDGE_API_VERSION],
  ];
  const mismatch = versions.find(([, actual, expected]) => actual !== expected);
  if (mismatch) return publicActionError('artifact_version_unsupported', `${mismatch[0]} must be ${mismatch[2]}`);
  if (artifact.artifactType === 'failure') return publicActionError('artifact_not_replayable', 'Failure artifacts are diagnostics and cannot be replayed');
  if (!Number.isSafeInteger(artifact.seed)) return publicActionError('artifact_invalid', 'Replay artifact seed is invalid');
  if (!isRecord(artifact.config)) return publicActionError('artifact_invalid', 'Replay artifact config is invalid');
  if (artifact.config.version !== GAME_RULES_VERSION) {
    return publicActionError('artifact_version_unsupported', `config.version must be ${GAME_RULES_VERSION}`);
  }
  if (typeof artifact.config.mapId !== 'string' || artifact.config.mapId !== artifact.mapId) {
    return publicActionError('artifact_invalid', 'Replay artifact map metadata does not match its config');
  }
  if (!artifact.fixedMap || !isRecord(artifact.fixedMap) || artifact.fixedMap.id !== artifact.mapId || !Array.isArray(artifact.fixedMap.tiles)) {
    return publicActionError('artifact_invalid', 'Replay artifact fixedMap is missing or does not match map metadata');
  }
  if (!Array.isArray(artifact.acceptedActions)) return publicActionError('artifact_invalid', 'Replay artifact acceptedActions is invalid');
  if (!Array.isArray(artifact.initialRoadArrivalSchedule)) return publicActionError('artifact_invalid', 'Replay artifact road schedule is missing');
  if (!artifact.result) return publicActionError('artifact_incomplete', 'Replay requires a completed Result');
  if (!isRecord(artifact.agent) || typeof artifact.agent.id !== 'string') return publicActionError('artifact_invalid', 'Replay artifact agent metadata is invalid');
  if (artifact.observationTrace !== undefined && (
    !Array.isArray(artifact.observationTrace) ||
    artifact.observationTrace.length !== artifact.acceptedActions.length + 1 ||
    artifact.observationTrace.some((trace) => !isRecord(trace) || trace.mapId !== artifact.mapId || !Array.isArray(trace.visibleTileKeys))
  )) return publicActionError('artifact_invalid', 'Replay artifact observation trace is incomplete');
  if (artifact.verificationEvents !== undefined && !Array.isArray(artifact.verificationEvents)) {
    return publicActionError('artifact_invalid', 'Replay artifact verificationEvents must be an array');
  }
  const strategy = artifact.agent?.strategy;
  if (strategy !== undefined && strategy !== 'random' && strategy !== 'balanced') {
    return publicActionError('artifact_invalid', 'Replay artifact agent strategy is unsupported');
  }
  return null;
}

function scheduleFromObservation(observation: AgentObservation): Array<{ branchId: string; nextArrivalTurn: number }> {
  return observation.roadBranches
    .map((branch) => ({ branchId: branch.branchId, nextArrivalTurn: branch.nextArrivalTurn }))
    .sort((left, right) => left.branchId.localeCompare(right.branchId));
}

/** Replay a completed artifact through a fresh AgentGame. */
export function replayArtifact(
  artifact: AgentRunArtifact,
  options: Pick<AgentRunnerGameOptions, 'gameFactory' | 'buildId' | 'config'> = {},
): {
  result: AgentGameResult | null;
  observation: AgentObservation | null;
  actionsReplayed: number;
  error: AgentActionError | null;
  reproduced: boolean;
  mismatch: string | null;
} {
  const validationError = artifactValidationError(artifact);
  if (validationError) {
    return {
      result: null,
      observation: null,
      actionsReplayed: 0,
      error: validationError,
      reproduced: false,
      mismatch: validationError.message,
    };
  }
  let config: GameConfig;
  try {
    config = cloneConfig(options.config ?? artifact.config);
    assertValidGameConfig(config);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : 'Replay artifact config is invalid';
    return { result: null, observation: null, actionsReplayed: 0, error: publicActionError('artifact_invalid', message), reproduced: false, mismatch: message };
  }
  const agent = artifact.agent.strategy === 'random' ? new RandomAgent(artifact.seed) : new BalancedAgent();
  const game = (options.gameFactory ?? defaultFactory(options.buildId ?? artifact.buildId))(artifact.seed, config, agent);
  let observation: AgentObservation;
  try {
    observation = clone(game.reset({ seed: artifact.seed, configOverrides: config, agent: { id: agent.id } }));
  } catch (thrown) {
    return { result: null, observation: null, actionsReplayed: 0, error: publicActionError('RESET_THREW', thrown instanceof Error ? thrown.message : String(thrown)), reproduced: false, mismatch: 'Replay reset failed' };
  }
  const expectedSchedule = artifact.initialRoadArrivalSchedule
    .map((entry) => ({ branchId: entry.branchId, nextArrivalTurn: entry.nextArrivalTurn }))
    .sort((left, right) => left.branchId.localeCompare(right.branchId));
  if (!jsonEquivalent(scheduleFromObservation(observation), expectedSchedule)) {
    return {
      result: null,
      observation,
      actionsReplayed: 0,
      error: publicActionError('replay_schedule_mismatch', 'Replay initial road-arrival schedule differs from the artifact'),
      reproduced: false,
      mismatch: 'Replay initial road-arrival schedule differs from the artifact',
    };
  }
  let expectedObservations: AgentObservation[] | undefined;
  try {
    expectedObservations = artifact.observationTrace?.map((trace) => restoreArtifactObservation(trace, artifact.fixedMap!));
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : 'Replay artifact observation trace is invalid';
    return {
      result: null,
      observation: null,
      actionsReplayed: 0,
      error: publicActionError('artifact_invalid', message),
      reproduced: false,
      mismatch: message,
    };
  }
  if (expectedObservations && !jsonEquivalent(expectedObservations[0], observation)) {
    return {
      result: null,
      observation,
      actionsReplayed: 0,
      error: publicActionError('replay_observation_mismatch', 'Replay initial observation differs from the artifact'),
      reproduced: false,
      mismatch: 'Replay initial observation differs from the artifact',
    };
  }
  let actionsReplayed = 0;
  for (const action of artifact.acceptedActions) {
    let replayAction: GameAction;
    try {
      replayAction = cloneAction(action);
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : 'Replay action is invalid';
      return {
        result: clone(game.getResult()),
        observation,
        actionsReplayed,
        error: publicActionError('artifact_invalid', message),
        reproduced: false,
        mismatch: `Replay action ${actionsReplayed + 1} is invalid`,
      };
    }
    let step: AgentStepResult;
    try {
      step = game.step(replayAction);
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : 'Replay step failed';
      return {
        result: clone(game.getResult()),
        observation,
        actionsReplayed,
        error: publicActionError('REPLAY_STEP_THREW', message),
        reproduced: false,
        mismatch: `Replay action ${actionsReplayed + 1} threw`,
      };
    }
    if (step.error) return {
      result: clone(game.getResult()),
      observation: clone(step.observation),
      actionsReplayed,
      error: errorFromUnknown(step.error, 'ACTION_REJECTED', 'Replay action rejected'),
      reproduced: false,
      mismatch: `Replay action ${actionsReplayed + 1} was rejected`,
    };
    actionsReplayed += 1;
    observation = clone(step.observation);
    if (expectedObservations && !jsonEquivalent(expectedObservations[actionsReplayed], observation)) {
      return {
        result: clone(game.getResult()),
        observation,
        actionsReplayed,
        error: publicActionError('replay_observation_mismatch', `Replay observation ${actionsReplayed} differs from the artifact`),
        reproduced: false,
        mismatch: `Replay observation ${actionsReplayed} differs from the artifact`,
      };
    }
    if (step.gameOver || observation.gameOver) break;
  }
  const result = clone(game.getResult());
  let mismatch: string | null = null;
  if (actionsReplayed !== artifact.acceptedActions.length) mismatch = 'Replay did not consume the complete accepted action list';
  if (!mismatch && artifact.result && !jsonEquivalent(artifact.result, result)) mismatch = 'Replay final result differs from the artifact';
  if (!mismatch && artifact.result && (!observation.gameOver || observation.turn !== artifact.result.turn)) mismatch = 'Replay final observation differs from the artifact result';
  if (!mismatch && artifact.verificationEvents) {
    const candidate = game as AgentGame & { getDebugState?: () => unknown };
    if (typeof candidate.getDebugState !== 'function') {
      mismatch = 'Replay game cannot validate internal verification events';
    } else {
      const replayVerificationEvents = verificationEventsFromSnapshot(candidate.getDebugState());
      if (!jsonEquivalent(artifact.verificationEvents, replayVerificationEvents)) {
        mismatch = 'Replay internal verification events differ from the artifact';
      }
    }
  }
  return { result, observation, actionsReplayed, error: null, reproduced: mismatch === null, mismatch };
}
