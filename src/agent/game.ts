import { assertValidGameConfig, cloneConfig, createDefaultConfig, DEFAULT_MAP_ID } from '../core/config';
import { GameEngine, validateAction } from '../core/engine';
import { hexKey } from '../core/hex';
import { getPlayerVisibleTileKeys } from '../core/visibility';
import type { DeepPartial, GameAction, GameConfig, GameEvent, GameState, JsonObject, JsonValue } from '../core/types';
import { actionKey, cloneAction, cloneJson, sortActions } from './action';
import { createAgentObservation, createAgentResult } from './observation';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  OBSERVATION_API_VERSION,
  type AgentActionError,
  type AgentGame,
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

const INTERNAL_EVENT_TYPES = new Set([
  'zombie_idle',
  'horde_target_inherited',
  'horde_target_cleared',
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
      const payload = cloneJson(event.payload) as JsonObject;
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
    const observation = this.getObservation();
    this.initialObservation = cloneJson(observation);
    this.observations = [cloneJson(observation)];
    return observation;
  }

  public getObservation(): AgentObservation {
    return createAgentObservation(this.engine.getState());
  }

  public getLegalActions(): GameAction[] {
    return sortActions(this.engine.getLegalActions()).map(cloneAction);
  }

  public step(action: GameAction): AgentStepResult {
    const legal = this.getLegalActions();
    let matched: GameAction | undefined;
    try {
      const candidateKey = actionKey(action);
      matched = legal.find((candidate) => actionKey(candidate) === candidateKey);
    } catch {
      matched = undefined;
    }
    if (!matched) {
      let error = publicError('action_not_legal', 'Action is not in the current legal action list');
      if (action.type === 'BuildCheckpoint' || action.type === 'RelocateCheckpoint') {
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
    const observation = this.getObservation();
    const events = publicEvents(before, result.state, result.events);
    this.events.push(...events);
    this.observations.push(cloneJson(observation));
    return {
      observation,
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

  public getRunArtifact(): AgentRunArtifact {
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
      artifactType: this.isGameOver() ? 'replay' : undefined,
      appVersion: APP_VERSION,
      gameRulesVersion: observation.gameRulesVersion,
      agentApiVersion: AGENT_API_VERSION,
      observationApiVersion: OBSERVATION_API_VERSION,
      bridgeApiVersion: this.bridgeApiVersion,
      buildId: this.buildId,
      mapId: observation.map.id,
      seed: this.seed,
      config: this.config,
      agent: { id: this.agentId },
      initialRoadArrivalSchedule: initialObservation.roadBranches.map((branch) => ({
        branchId: branch.branchId,
        nextArrivalTurn: branch.nextArrivalTurn,
      })),
      acceptedActions: this.acceptedActions,
      invalidAttempts: this.invalidAttempts,
      decisionTrace: [],
      result: this.getResult(),
      observationTrace: this.observations,
      metrics,
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
