import { cloneAction, cloneJson } from '../agent/action';
import { createAgentGame } from '../agent/game';
import { collectGameMetrics } from '../agent/metrics';
import {
  BRIDGE_API_VERSION,
  type AgentActionError,
  type AgentApiInfo,
  type AgentGame,
  type AgentObservation,
  type AgentResetOptions,
  type AgentRunArtifact,
  type AgentStepResult,
} from '../agent/types';
import type { GameAction, JsonValue } from '../core/types';

/**
 * The browser-facing API is intentionally a small closure around an
 * AgentGame.  In particular, it never receives the GameEngine used by the
 * normal UI and it does not import the persistence layer.
 */
export interface BrowserBridgeApi {
  readonly getApiInfo: () => AgentApiInfo;
  readonly reset: (options?: AgentResetOptions) => AgentObservation;
  readonly getObservation: () => AgentObservation;
  readonly getLegalActions: () => GameAction[];
  readonly step: (action: GameAction) => AgentStepResult;
  readonly isGameOver: () => boolean;
  readonly getResult: () => AgentRunArtifact['result'];
  readonly getRunArtifact: () => AgentRunArtifact;
}

export interface BrowserBridgeOptions {
  /** Build metadata is supplied by CI; local builds use local-unknown. */
  buildId?: string;
}

const MAX_INPUT_DEPTH = 32;
const MAX_INPUT_STRING_LENGTH = 256;
const MAX_INPUT_ARRAY_LENGTH = 4096;
const MAX_INPUT_KEYS = 128;
const MAX_ACTION_JSON_LENGTH = 16_384;
const MAX_RESET_JSON_LENGTH = 65_536;
const MAX_COORDINATE = 1_000;
const MAX_POPULATION_VALUE = 100_000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;

const INVALID_ACTION = { type: '__invalid_browser_bridge_action__' } as unknown as GameAction;

interface BridgeInvalidAttempt {
  decision: number;
  action: unknown;
  error: AgentActionError;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Guard external values before they reach JSON cloning or the Adapter. */
function isBoundedJson(value: unknown, depth = 0, seen = new WeakSet<object>()): value is JsonValue {
  if (depth > MAX_INPUT_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= MAX_POPULATION_VALUE;
  if (typeof value === 'string') return value.length <= MAX_INPUT_STRING_LENGTH;
  if (typeof value !== 'object') return false;

  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_INPUT_ARRAY_LENGTH) return false;
      return value.every((item) => isBoundedJson(item, depth + 1, seen));
    }
    if (!isPlainObject(value)) return false;
    const entries = Object.entries(value);
    if (entries.length > MAX_INPUT_KEYS) return false;
    return entries.every(([key, item]) => key.length <= MAX_INPUT_STRING_LENGTH && isBoundedJson(item, depth + 1, seen));
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}

function boundedJsonLength(value: unknown): number | null {
  try {
    if (!isBoundedJson(value)) return null;
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized.length : null;
  } catch {
    return null;
  }
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

function isCoordinate(value: unknown): value is { q: number; r: number } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('q') || !keys.includes('r')) return false;
  return (
    typeof value.q === 'number' &&
    Number.isSafeInteger(value.q) &&
    Math.abs(value.q) <= MAX_COORDINATE &&
    typeof value.r === 'number' &&
    Number.isSafeInteger(value.r) &&
    Math.abs(value.r) <= MAX_COORDINATE
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_POPULATION_VALUE;
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && keys.every((key) => allowed.has(key));
}

/**
 * Shape validation is separate from legality validation.  The Adapter still
 * decides whether a well-formed action is legal for the current state.
 */
function isBridgeAction(value: unknown): value is GameAction {
  if (!isPlainObject(value) || boundedJsonLength(value) === null || boundedJsonLength(value)! > MAX_ACTION_JSON_LENGTH) return false;
  try {
    switch (value.type) {
      case 'Move':
        return hasOnlyKeys(value, ['type', 'unitId', 'destination']) && isSafeId(value.unitId) && isCoordinate(value.destination);
      case 'Attack':
        return hasOnlyKeys(value, ['type', 'attackerId', 'targetId']) && isSafeId(value.attackerId) && isSafeId(value.targetId);
      case 'Wait':
        return hasOnlyKeys(value, ['type', 'unitId']) && isSafeId(value.unitId);
      case 'AssignWorkers':
        return hasOnlyKeys(value, ['type', 'facilityId', 'workers']) && isSafeId(value.facilityId) && isNonNegativeSafeInteger(value.workers);
      case 'TransferPopulation':
        return (
          hasOnlyKeys(value, ['type', 'fromFacilityId', 'toFacilityId', 'people']) &&
          isSafeId(value.fromFacilityId) &&
          isSafeId(value.toFacilityId) &&
          isNonNegativeSafeInteger(value.people)
        );
      case 'SetCheckpointPolicy':
        return (
          hasOnlyKeys(value, ['type', 'checkpointId', 'policy']) &&
          isSafeId(value.checkpointId) &&
          (value.policy === 'passThrough' || value.policy === 'normal' || value.policy === 'strict')
        );
      case 'BuildCheckpoint':
        return hasOnlyKeys(value, ['type', 'position'], ['branchId']) &&
          isCoordinate(value.position) &&
          (value.branchId === undefined || isSafeId(value.branchId));
      case 'RelocateCheckpoint':
        return hasOnlyKeys(value, ['type', 'checkpointId', 'position'], ['branchId']) &&
          isSafeId(value.checkpointId) &&
          isCoordinate(value.position) &&
          (value.branchId === undefined || isSafeId(value.branchId));
      case 'ProduceUnit':
        return (
          hasOnlyKeys(value, ['type', 'unitType'], ['destination']) &&
          (value.unitType === 'police' || value.unitType === 'nationalGuard') &&
          (value.destination === undefined || isCoordinate(value.destination))
        );
      case 'EndTurn':
        return hasOnlyKeys(value, ['type']);
      default:
        // StartNewGame and LoadSnapshot are intentionally not bridge actions.
        return false;
    }
  } catch {
    return false;
  }
}

function resolveBuildId(explicit: string | undefined): string {
  if (typeof explicit === 'string' && explicit.length > 0 && explicit.length <= MAX_INPUT_STRING_LENGTH) return explicit;
  // Vite replaces import.meta.env.VITE_BUILD_ID in CI builds.  Avoid reading
  // any browser storage or network metadata for this value.
  const viteBuildId = (import.meta as ImportMeta & { env?: { VITE_BUILD_ID?: string } }).env?.VITE_BUILD_ID;
  if (typeof viteBuildId === 'string' && viteBuildId.length > 0 && viteBuildId.length <= MAX_INPUT_STRING_LENGTH) return viteBuildId;
  return 'local-unknown';
}

function cloneError(error: AgentActionError): AgentActionError {
  return cloneJson(error);
}

function invalidActionError(message: string): AgentActionError {
  return { code: 'invalid_action_input', message };
}

function invalidStepResult(game: AgentGame, error: AgentActionError): AgentStepResult {
  return cloneJson({
    observation: game.getObservation(),
    events: [],
    error,
    gameOver: game.isGameOver(),
    result: game.getResult(),
  });
}

function cloneAttemptAction(value: unknown): unknown {
  return isBoundedJson(value) ? cloneJson(value) : { type: '__invalid_browser_bridge_input__' };
}

export function createBrowserBridge(options: BrowserBridgeOptions = {}): BrowserBridgeApi {
  const game = createAgentGame({ buildId: resolveBuildId(options.buildId), bridgeApiVersion: BRIDGE_API_VERSION });
  let decision = 0;
  let invalidAttempts: BridgeInvalidAttempt[] = [];

  const getApiInfo = (): AgentApiInfo => cloneJson(game.getApiInfo());
  const reset = (input?: AgentResetOptions): AgentObservation => {
    if (input !== undefined) {
      const length = boundedJsonLength(input);
      if (!isPlainObject(input) || length === null || length > MAX_RESET_JSON_LENGTH) {
        throw new Error('Invalid reset options: expected bounded JSON object');
      }
    }
    const observation = game.reset(input);
    decision = 0;
    invalidAttempts = [];
    return cloneJson(observation);
  };
  const getObservation = (): AgentObservation => cloneJson(game.getObservation());
  const getLegalActions = (): GameAction[] => game.getLegalActions().map(cloneAction);
  const step = (input: GameAction): AgentStepResult => {
    decision += 1;
    if (!isBridgeAction(input)) {
      const error = invalidActionError('Action must be one bounded, JSON-compatible GameAction from getLegalActions; LoadSnapshot and StartNewGame are not exposed');
      invalidAttempts.push({ decision, action: cloneAttemptAction(input), error: cloneError(error) });
      return invalidStepResult(game, error);
    }
    const result = game.step(input);
    if (result.error) {
      invalidAttempts.push({ decision, action: cloneAttemptAction(input), error: cloneError(result.error) });
    }
    return cloneJson(result);
  };
  const isGameOver = (): boolean => game.isGameOver();
  const getResult = (): AgentRunArtifact['result'] => cloneJson(game.getResult());
  const getRunArtifact = (): AgentRunArtifact => {
    const artifact = game.getRunArtifact();
    // The Adapter records semantically invalid actions.  Replace its decision
    // list with the bridge-level chronological list so malformed boundary
    // inputs are visible too, without exposing GameState.
    const observationTrace = artifact.observationTrace ?? [game.getObservation()];
    const initialObservation = observationTrace[0]!;
    const finalObservation = observationTrace.at(-1) ?? initialObservation;
    const events = artifact.events ?? [];
    const actions = artifact.acceptedActions ?? [];
    const metrics = collectGameMetrics({
      initialObservation,
      finalObservation,
      observations: observationTrace,
      actions,
      events,
      result: artifact.result,
      invalidAttemptCount: invalidAttempts.length,
      invalidAttempts,
      totalAgentDecisions: actions.length + invalidAttempts.length,
      agent: { id: artifact.agent.id, version: artifact.agent.version ?? 'external' },
      config: artifact.config,
      buildId: artifact.buildId,
      seed: artifact.seed,
      appVersion: artifact.appVersion,
      gameRulesVersion: artifact.gameRulesVersion,
      agentApiVersion: artifact.agentApiVersion,
      observationApiVersion: artifact.observationApiVersion,
      bridgeApiVersion: artifact.bridgeApiVersion,
    });
    return cloneJson({ ...artifact, invalidAttempts, metrics });
  };

  return Object.freeze({
    getApiInfo,
    reset,
    getObservation,
    getLegalActions,
    step,
    isGameOver,
    getResult,
    getRunArtifact,
  });
}

export function installBrowserBridge(options: BrowserBridgeOptions = {}): BrowserBridgeApi {
  if (typeof window === 'undefined') throw new Error('Browser Bridge requires a browser window');
  const api = createBrowserBridge(options);
  window.NLTH = api;
  return api;
}

declare global {
  interface Window {
    NLTH: BrowserBridgeApi;
  }
}
