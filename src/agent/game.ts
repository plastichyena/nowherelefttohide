import { assertValidGameConfig, cloneConfig, createDefaultConfig, DEFAULT_MAP_ID } from '../core/config';
import { GameEngine, getCheckpointPositionCandidates, validateAction } from '../core/engine';
import { hexKey } from '../core/hex';
import { getPlayerVisibleTileKeys } from '../core/visibility';
import type { DeepPartial, GameAction, GameConfig, GameEvent, GameState, JsonObject, JsonValue } from '../core/types';
import { actionKey, cloneAction, cloneJson, sortActions } from './action';
import { compactArtifactObservation, createAgentObservation, createAgentResult } from './observation';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  HIDDEN_NOISE_METRIC_KEYS,
  OBSERVATION_API_VERSION,
  type AgentActionError,
  type AgentGame,
  type AgentPublicConfig,
  type AgentPublicMetrics,
  type AgentPublicRunArtifact,
  type AgentObservation,
  type AgentPublicEvent,
  type AgentResetOptions,
  type AgentRunArtifact,
  type AgentStepResult,
} from './types';
import { collectGameMetrics } from './metrics';
import { createAgentApiInfo } from './apiInfo';

const DEFAULT_AGENT_SEED = 1;
const MAX_AGENT_ID_LENGTH = 64;
const MAX_CONFIG_JSON_LENGTH = 64_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateKnownKeys(value: unknown, template: unknown, path: string): void {
  if (!isPlainObject(value)) return;
  if (!isPlainObject(template)) throw new Error(`${path || 'configOverrides'} must not contain nested fields here`);
  for (const [key, child] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(template, key)) throw new Error(`Unknown field: ${path}${key}`);
    validateKnownKeys(child, template[key], `${path}${key}.`);
  }
}

function validateFiniteNumbers(value: unknown, path = 'options'): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
  if (Array.isArray(value)) value.forEach((item, index) => validateFiniteNumbers(item, `${path}[${index}]`));
  else if (isPlainObject(value)) Object.entries(value).forEach(([key, item]) => validateFiniteNumbers(item, `${path}.${key}`));
}

function normalizeResetOptions(value: AgentResetOptions | undefined): Required<Pick<AgentResetOptions, 'seed'>> & AgentResetOptions {
  const options = value ?? {};
  if (!isPlainObject(options)) throw new Error('Reset options must be an object');
  for (const key of Object.keys(options)) {
    if (!['seed', 'configOverrides', 'agent'].includes(key)) throw new Error(`Unknown reset option: ${key}`);
  }
  validateFiniteNumbers(options);
  const seedValue: unknown = options.seed ?? DEFAULT_AGENT_SEED;
  if (typeof seedValue !== 'number' || !Number.isSafeInteger(seedValue)) throw new Error('seed must be a safe integer');
  if (options.agent !== undefined) {
    if (!isPlainObject(options.agent) || Object.keys(options.agent).some((key) => key !== 'id')) {
      throw new Error('agent must contain only id');
    }
    if (typeof options.agent.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(options.agent.id) || options.agent.id.length > MAX_AGENT_ID_LENGTH) {
      throw new Error(`agent.id must use 1-${MAX_AGENT_ID_LENGTH} safe ASCII characters`);
    }
  }
  return { ...options, seed: seedValue };
}

function buildConfig(overrides: DeepPartial<GameConfig> | undefined): GameConfig {
  if (overrides !== undefined) {
    if (!isPlainObject(overrides)) throw new Error('configOverrides must be an object');
    if (JSON.stringify(overrides).length > MAX_CONFIG_JSON_LENGTH) throw new Error('configOverrides is too large');
    validateKnownKeys(overrides, createDefaultConfig(), 'configOverrides.');
  }
  const config = createDefaultConfig(overrides);
  if (config.mapId !== DEFAULT_MAP_ID) throw new Error(`mapId must be ${DEFAULT_MAP_ID}`);
  assertValidGameConfig(config);
  return config;
}

function publicError(code: string, message: string): AgentActionError {
  return { code, message };
}

function safeUnknownClone(value: unknown): unknown {
  try {
    return cloneJson(value as JsonValue);
  } catch {
    return null;
  }
}

/** Remove hidden-Zombie reaction counts from all production artifact paths. */
function publicMetrics(metrics: ReturnType<typeof collectGameMetrics>): AgentPublicMetrics {
  const value = cloneJson(metrics) as unknown as Record<string, unknown>;
  for (const key of HIDDEN_NOISE_METRIC_KEYS) delete value[key];
  value.config = createAgentPublicConfig(metrics.config);
  return value as AgentPublicMetrics;
}

/** Public AgentGame artifacts expose Noise classes, never exact radii. */
export function createAgentPublicConfig(config: GameConfig): AgentPublicConfig {
  const value = cloneJson(config) as unknown as Record<string, unknown>;
  const noise = isPlainObject(value.noise) ? value.noise : {};
  value.noise = { publicClass: cloneJson(noise.publicClass as JsonValue) };
  return value as unknown as AgentPublicConfig;
}

const INTERNAL_EVENT_TYPES = new Set([
  'zombie_idle',
  'horde_target_inherited',
  'horde_target_cleared',
  'noise_targeted',
  'noise_target_reached',
  'noise_target_overridden',
]);

function publicEvents(
  before: Readonly<GameState>,
  after: Readonly<GameState>,
  events: readonly GameEvent[],
): AgentPublicEvent[] {
  const visibleTiles = new Set([...getPlayerVisibleTileKeys(before), ...getPlayerVisibleTileKeys(after)]);
  const enemyById = new Map(
    [...before.units, ...after.units]
      .filter((unit) => !unit.isPlayerUnit)
      .map((unit) => [unit.id, unit] as const),
  );
  const visibleEnemyIds = new Set(
    [...enemyById.values()]
      .filter((unit) => visibleTiles.has(hexKey(unit.position)))
      .map((unit) => unit.id),
  );
  return events
    .filter((event) => !INTERNAL_EVENT_TYPES.has(event.type))
    .map((event) => {
      let payload = cloneJson(event.payload) as JsonObject;
      if (event.type === 'noise_emitted') {
        payload = Object.fromEntries(
          ['sourceUnitId', 'sourceUnitType', 'q', 'r', 'noiseClass']
            .filter((field) => Object.prototype.hasOwnProperty.call(payload, field))
            .map((field) => [field, payload[field]!]),
        ) as JsonObject;
      }
      if (event.type === 'horde_spawned') {
        for (const field of [
          'units', 'unit', 'spawnedUnits', 'position', 'positions', 'spawnGroupId', 'groupId',
          'count', 'hordeZombieCount', 'normalZombieCount', 'hordeZombies', 'normalZombies',
        ] as const) delete payload[field];
      }
      const spawnedEnemyId = event.type === 'horde_spawned' && typeof payload.zombieId === 'string'
        ? payload.zombieId
        : null;
      if (spawnedEnemyId && !visibleEnemyIds.has(spawnedEnemyId)) return null;
      for (const field of ['zombieId', 'unitId', 'sourceId', 'targetId', 'attackerId', 'defenderId'] as const) {
        const id = payload[field];
        if (typeof id === 'string' && enemyById.has(id) && !visibleEnemyIds.has(id)) delete payload[field];
      }
      if (typeof payload.source === 'string' && enemyById.has(payload.source) && !visibleEnemyIds.has(payload.source)) {
        delete payload.source;
      }
      if (typeof payload.q === 'number' && typeof payload.r === 'number' && !visibleTiles.has(hexKey({ q: payload.q, r: payload.r }))) {
        delete payload.q;
        delete payload.r;
      }
      delete payload.spawnGroupId;
      return { ...event, payload } as AgentPublicEvent;
    })
    .filter((event): event is AgentPublicEvent => event !== null)
    .filter((event) => Object.keys(event.payload).length > 0 || event.type === 'game_over');
}

/**
 * Exact public-state dependency key for the expensive all-road checkpoint
 * projection. It deliberately captures only inputs used by Core validation
 * and projected supply effects, so a domestic action can reuse the result
 * without hiding an updated candidate or reason code.
 */
function checkpointCandidateProjectionKey(state: Readonly<GameState>): string {
  const visibleTiles = getPlayerVisibleTileKeys(state);
  return JSON.stringify({
    phase: state.phase,
    gameOver: state.gameOver,
    actionBudgetReached: state.actionsTakenThisTurn >= state.config.maxActionsPerTurn,
    civilianGoods: state.resources.civilianGoods,
    facilities: state.facilities
      .map((facility) => [facility.id, facility.position.q, facility.position.r] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
    checkpoints: state.checkpoints
      .map((checkpoint) => [
        checkpoint.id,
        checkpoint.branchId ?? checkpoint.direction,
        checkpoint.position.q,
        checkpoint.position.r,
        checkpoint.status,
        checkpoint.infected,
      ] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
    roadBranches: state.roadBranches
      .map((branch) => [
        branch.branchId,
        branch.checkpointActionsThisTurn,
        branch.activeCheckpointId,
        [...branch.standbyCheckpointIds].sort(),
      ] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
    playerUnits: state.units
      .filter((unit) => unit.isPlayerUnit)
      .map((unit) => [unit.id, unit.position.q, unit.position.r] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
    visibleZombies: state.units
      .filter((unit) => !unit.isPlayerUnit && visibleTiles.has(hexKey(unit.position)))
      .map((unit) => [unit.id, unit.type, unit.position.q, unit.position.r] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
  });
}

export interface AgentGameAdapterOptions {
  buildId?: string;
  bridgeApiVersion?: string;
}

export class AgentGameAdapter implements AgentGame {
  private engine: GameEngine;
  private seed = DEFAULT_AGENT_SEED;
  private config = createDefaultConfig();
  private agentId = 'external-agent';
  private acceptedActions: GameAction[] = [];
  private invalidAttempts: AgentRunArtifact['invalidAttempts'] = [];
  private initialObservation: AgentObservation | null = null;
  private observations: AgentObservation[] = [];
  private events: AgentPublicEvent[] = [];
  /** State changes only through this Adapter, so this avoids duplicate Core enumeration. */
  private cachedLegalActions: GameAction[] | null = null;
  /**
   * The runner asks for the same post-step observation again before choosing
   * the next action. Keep one private snapshot for that state, while every
   * public boundary still receives a detached JSON clone.
   */
  private cachedObservation: AgentObservation | null = null;
  /** Checkpoint candidate projection keyed by every Core input it reads. */
  private cachedCheckpointPositionCandidates: {
    key: string;
    candidates: ReturnType<typeof getCheckpointPositionCandidates>;
  } | null = null;
  private readonly buildId: string;
  private readonly bridgeApiVersion: string;

  public constructor(options: AgentGameAdapterOptions = {}) {
    this.engine = new GameEngine(this.seed, this.config);
    this.buildId = options.buildId ?? 'local-unknown';
    this.bridgeApiVersion = options.bridgeApiVersion ?? BRIDGE_API_VERSION;
    const observation = this.getObservation();
    this.initialObservation = cloneJson(observation);
    this.observations = [cloneJson(observation)];
  }

  public getApiInfo() {
    return createAgentApiInfo(this.config, this.buildId, this.bridgeApiVersion);
  }

  public reset(options?: AgentResetOptions): AgentObservation {
    const normalized = normalizeResetOptions(options);
    const config = buildConfig(normalized.configOverrides);
    const next = new GameEngine(normalized.seed, config);
    this.engine = next;
    this.seed = normalized.seed;
    this.config = cloneConfig(config);
    this.agentId = normalized.agent?.id ?? 'external-agent';
    this.acceptedActions = [];
    this.invalidAttempts = [];
    this.events = [];
    this.cachedLegalActions = null;
    this.cachedObservation = null;
    this.cachedCheckpointPositionCandidates = null;
    const observation = this.getObservation();
    this.initialObservation = cloneJson(observation);
    this.observations = [cloneJson(observation)];
    return observation;
  }

  public getObservation(): AgentObservation {
    return cloneJson(this.currentObservation());
  }

  private currentObservation(): AgentObservation {
    if (this.cachedObservation === null) {
      const state = this.engine.getState();
      const checkpointCandidatesKey = checkpointCandidateProjectionKey(state);
      if (this.cachedCheckpointPositionCandidates?.key !== checkpointCandidatesKey) {
        this.cachedCheckpointPositionCandidates = {
          key: checkpointCandidatesKey,
          candidates: getCheckpointPositionCandidates(state),
        };
      }
      this.cachedObservation = createAgentObservation(state, {
        checkpointPositionCandidates: this.cachedCheckpointPositionCandidates.candidates,
      });
    }
    return this.cachedObservation;
  }

  public getLegalActions(): GameAction[] {
    return this.currentLegalActions().map(cloneAction);
  }

  private currentLegalActions(): GameAction[] {
    if (this.cachedLegalActions === null) {
      this.cachedLegalActions = sortActions(this.engine.getLegalActions()).map(cloneAction);
    }
    return this.cachedLegalActions;
  }

  public step(action: GameAction): AgentStepResult {
    // Legal actions are already cached for this state. `getLegalActions()`
    // clones for external callers, but a step only needs the private snapshot
    // to locate the canonical engine action.
    const legal = this.currentLegalActions();
    let matched: GameAction | undefined;
    try {
      const candidateKey = actionKey(action);
      matched = legal.find((candidate) => actionKey(candidate) === candidateKey);
    } catch {
      matched = undefined;
    }
    if (!matched) {
      let error = publicError('action_not_legal', 'Action is not in the current legal action list');
      if (
        action.type === 'BuildCheckpoint' ||
        action.type === 'RelocateCheckpoint' ||
        action.type === 'ActivateCheckpoint' ||
        action.type === 'BuildConstructibleFacility'
      ) {
        try {
          const coreError = validateAction(this.engine.getState(), action);
          if (coreError) error = publicError(coreError.code, coreError.message);
        } catch {
          // Direct TypeScript callers can still bypass the declared GameAction
          // shape at runtime. Keep malformed values at the generic boundary;
          // the Browser Bridge performs stricter shape validation first.
        }
      }
      this.invalidAttempts.push({ decision: this.acceptedActions.length + this.invalidAttempts.length + 1, action: safeUnknownClone(action), error });
      return {
        observation: this.getObservation(),
        events: [],
        error,
        gameOver: this.isGameOver(),
        result: this.getResult(),
      };
    }
    const before = this.engine.getState();
    const result = this.engine.step(matched);
    if (result.error) {
      const error = publicError(result.error.code, result.error.message);
      this.invalidAttempts.push({ decision: this.acceptedActions.length + this.invalidAttempts.length + 1, action: cloneAction(matched), error });
      const observation = this.getObservation();
      return { observation, events: [], error, gameOver: result.gameOver, result: this.getResult() };
    }
    this.acceptedActions.push(cloneAction(matched));
    this.cachedLegalActions = null;
    this.cachedObservation = null;
    const observation = this.currentObservation();
    const events = publicEvents(before, result.state, result.events);
    this.events.push(...events);
    this.observations.push(cloneJson(observation));
    return {
      observation: cloneJson(observation),
      events,
      error: null,
      gameOver: result.gameOver,
      result: this.getResult(),
    };
  }


  public isGameOver(): boolean {
    return this.engine.isGameOver();
  }

  public getResult() {
    return createAgentResult(this.engine.getResult());
  }

  public getRunArtifact(): AgentPublicRunArtifact {
    const observation = this.getObservation();
    const initialObservation = this.initialObservation ?? observation;
    const metrics = collectGameMetrics({
      initialObservation,
      finalObservation: observation,
      observations: this.observations.length > 0 ? this.observations : [observation],
      actions: this.acceptedActions,
      events: this.events,
      result: this.getResult(),
      invalidAttemptCount: this.invalidAttempts.length,
      invalidAttempts: this.invalidAttempts,
      totalAgentDecisions: this.acceptedActions.length + this.invalidAttempts.length,
      agent: { id: this.agentId, version: 'external' },
      config: this.config,
      buildId: this.buildId,
      seed: this.seed,
    });
    return cloneJson({
      artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      gameRulesVersion: observation.gameRulesVersion,
      agentApiVersion: AGENT_API_VERSION,
      observationApiVersion: OBSERVATION_API_VERSION,
      bridgeApiVersion: this.bridgeApiVersion,
      buildId: this.buildId,
      mapId: observation.map.id,
      seed: this.seed,
      config: createAgentPublicConfig(this.config),
      agent: { id: this.agentId },
      initialRoadArrivalSchedule: initialObservation.roadBranches.map((branch) => ({
        branchId: branch.branchId,
        nextArrivalTurn: branch.nextArrivalTurn,
      })),
      acceptedActions: this.acceptedActions,
      invalidAttempts: this.invalidAttempts,
      decisionTrace: [],
      result: this.getResult(),
      fixedMap: cloneJson(initialObservation.map),
      observationTrace: this.observations.map(compactArtifactObservation),
      metrics: publicMetrics(metrics),
      events: this.events,
    });
  }

  /** Local/CI failure diagnostics only. Not part of AgentGame or window.NLTH. */
  public getDebugState(): Readonly<GameState> {
    return this.engine.getState();
  }
}

export function createAgentGame(options: AgentGameAdapterOptions = {}): AgentGameAdapter {
  return new AgentGameAdapter(options);
}
