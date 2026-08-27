import { assertValidGameConfig, cloneConfig, createDefaultConfig } from '../core/config';
import type { GameAction, GameConfig } from '../core/types';
import { actionKey, cloneAction, cloneJson, sortActions } from './action';
import { collectGameMetrics, type GameMetrics } from './metrics';
import { createAgentGame } from './game';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  BRIDGE_API_VERSION,
  OBSERVATION_API_VERSION,
  type AgentActionError,
  type AgentDecision,
  type AgentDecisionTrace,
  type AgentGame,
  type AgentGameResult,
  type InvalidActionAttempt,
  type AgentObservation,
  type AgentPublicEvent,
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
    maxDecisionsPerGame: limits?.maxDecisionsPerGame ?? Math.max(1, Math.max(config.maxTurns, 100) * (Math.max(1, config.maxActionsPerTurn) + 1) + 1),
    maxTurns: limits?.maxTurns ?? Math.max(config.maxTurns, 100),
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

function defaultFactory(buildId: string | undefined): AgentGameFactory {
  return () => createAgentGame({ buildId });
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
): AgentRunArtifact {
  return {
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
    acceptedActions: clone([...actions]),
    invalidAttempts: [],
    decisionTrace: clone([...traces]),
    result: clone(result),
  };
}

function enrichArtifact(
  source: AgentRunArtifact | null,
  fallback: AgentRunArtifact,
  actions: readonly GameAction[],
  traces: readonly AgentDecisionTrace[],
  result: AgentGameResult | null,
  agent: GameAgent,
  strategy: string,
): AgentRunArtifact {
  const artifact = source && isRecord(source) ? clone(source) : fallback;
  artifact.appVersion = artifact.appVersion || APP_VERSION;
  artifact.gameRulesVersion = artifact.gameRulesVersion || fallback.gameRulesVersion;
  artifact.agentApiVersion = artifact.agentApiVersion || AGENT_API_VERSION;
  artifact.observationApiVersion = artifact.observationApiVersion || OBSERVATION_API_VERSION;
  artifact.bridgeApiVersion = artifact.bridgeApiVersion || BRIDGE_API_VERSION;
  artifact.buildId = artifact.buildId || fallback.buildId;
  artifact.mapId = artifact.mapId || fallback.mapId;
  artifact.seed = seedSafe(artifact.seed, fallback.seed);
  artifact.config = cloneConfig(fallback.config);
  artifact.agent = { id: agent.id, version: agent.version, strategy };
  artifact.acceptedActions = clone([...actions]);
  artifact.invalidAttempts = Array.isArray(artifact.invalidAttempts) ? clone(artifact.invalidAttempts) : [];
  artifact.decisionTrace = clone([...traces]);
  artifact.result = clone(result);
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
  const gameFactory = options.gameFactory ?? defaultFactory(buildId);
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
    observations.push(clone(observation));
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
      const trace: AgentDecisionTrace = {
        turn: turnForDecision,
        decision: actions.length + 1,
        priorityGoal: traceSource.priorityGoal,
        selectedAction: cloneAction(selected),
        selectedScore: traceSource.selectedScore,
        topCandidates: clone(traceSource.topCandidates ?? []),
        reasonCodes: [...(traceSource.reasonCodes ?? [])],
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
    observations.push(clone(observation));
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

  let sourceArtifact: AgentRunArtifact | null = null;
  if (game) {
    try {
      sourceArtifact = clone(game.getRunArtifact());
    } catch (thrown) {
      if (!runFailure) fail('ARTIFACT_THREW', thrown instanceof Error ? thrown.message : String(thrown), null, thrown);
    }
  }
  const fallback = placeholderArtifact(seed, config, agent, buildId, actions, decisionTrace, result);
  const strategyName = strategyForAgent(agent, options.strategy);
  const baseArtifact = enrichArtifact(sourceArtifact, fallback, actions, decisionTrace, result, agent, strategyName);
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
      maxTurns: config.maxTurns,
      phase: 'gameOver',
      map: { id: config.mapId, width: 15, height: 15, coordinateSystem: 'axial-q-r', tiles: [] },
      resources: { food: 0, civilianGoods: 0, militaryGoods: 0, fuel: 0, electricityCapacity: 0, electricityRequired: 0, militarySupplyAvailable: false },
      population: { healthyCivilians: 0, cityResidents: 0, productionWorkers: 0, unitPopulation: 0, waitingRefugees: 0, screeningRefugees: 0, approvedRefugees: 0, infected: 0 },
      facilities: [], units: [], zombies: [], checkpoints: [],
      horde: { direction: 'north', turnsRemaining: 0, nextSpawnTurn: null },
      endTurnForecast: { populationConsumers: 0, overcrowding: { cities: [], additionalFood: 0, additionalCivilianGoods: 0 }, food: { available: 0, maintenanceRequired: 0, productionInputRequired: 0, required: 0, shortage: 0 }, civilianGoods: { available: 0, maintenanceRequired: 0, productionInputRequired: 0, required: 0, shortage: 0 }, militaryGoods: { available: 0, maintenanceRequired: 0, productionInputRequired: 0, required: 0, shortage: 0 }, fuel: { available: 0, maintenanceRequired: 0, productionInputRequired: 0, required: 0, shortage: 0 }, electricity: { capacity: 0, required: 0, shortage: 0 } },
      gameOver: true,
      result: null,
    } as AgentObservation),
    finalObservation,
    observations,
    actions,
    events,
    decisionTrace,
    result,
    invalidAttemptCount: invalidAttempts.length,
    totalAgentDecisions,
    agent: { id: agent.id, version: agent.version, strategy: strategyName },
    config,
    buildId,
    seed,
    failure: metricFailure,
  });

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
  const config = cloneConfig(options.config ?? artifact.config);
  const agent = artifact.agent.strategy === 'random' ? new RandomAgent(artifact.seed) : new BalancedAgent();
  const game = (options.gameFactory ?? defaultFactory(options.buildId ?? artifact.buildId))(artifact.seed, config, agent);
  let observation: AgentObservation;
  try {
    observation = clone(game.reset({ seed: artifact.seed, configOverrides: config, agent: { id: agent.id } }));
  } catch (thrown) {
    return { result: null, observation: null, actionsReplayed: 0, error: publicActionError('RESET_THREW', thrown instanceof Error ? thrown.message : String(thrown)), reproduced: false, mismatch: 'Replay reset failed' };
  }
  let actionsReplayed = 0;
  for (const action of artifact.acceptedActions) {
    const step = game.step(cloneAction(action));
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
    if (step.gameOver || observation.gameOver) break;
  }
  const result = clone(game.getResult());
  let mismatch: string | null = null;
  if (actionsReplayed !== artifact.acceptedActions.length) mismatch = 'Replay did not consume the complete accepted action list';
  if (!mismatch && artifact.result && JSON.stringify(artifact.result) !== JSON.stringify(result)) mismatch = 'Replay final result differs from the artifact';
  if (!mismatch && artifact.result && (!observation.gameOver || observation.turn !== artifact.result.turn)) mismatch = 'Replay final observation differs from the artifact result';
  return { result, observation, actionsReplayed, error: null, reproduced: mismatch === null, mismatch };
}
