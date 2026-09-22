import { buildContextHandoff, handoffJson, type ContextHandoff } from './context-handoff';
import { isGameActionInput, isPlainObject, isBoundedJson, hasOnlyKeys, isSafeId } from '../agent/action-input';
import { cloneAction, cloneJson, actionKey, matchLegalAction } from '../agent/action';
import { checkpointSupplyExplanation, deriveImportantChanges } from '../agent/decision-summary';
import { createAgentGame } from '../agent/game';
import {
  QUERY_FILTER_SCHEMAS,
  publicQueryContract,
  validateQuerySchema,
  type PublicQueryTarget,
} from '../agent/query-contract';
import { queryRoute, RouteQueryInputError, type RouteQueryInput } from '../agent/route-query';
import { deriveStrategicMap, strategicMapItems } from '../agent/strategic-map';
import type { AgentGameResult, AgentObservation, AgentStepResult } from '../agent/types';
import type { GameAction, JsonObject, JsonValue } from '../core/types';
import {
  AI_SESSION_CONTRACT_VERSION,
  AI_SESSION_DEFAULT_QUERY_PAGE_SIZE,
  AI_SESSION_MAX_COMMENT_CODE_POINTS,
  AI_SESSION_MAX_QUERY_PAGE_SIZE,
  AI_SESSION_MAX_REQUEST_ID_CODE_POINTS,
  type AiSessionActInput,
  type AiSessionActResult,
  type AiSessionCommentLocale,
  type AiSessionContext,
  type AiSessionCreateOptions,
  type AiSessionDecisionRecord,
  type AiSessionEndResult,
  type AiSessionError,
  type AiSessionFailure,
  type AiSessionGameResult,
  type AiSessionLegalActionsInput,
  type AiSessionLegalActionsResult,
  type AiSessionLifecycle,
  type AiSessionObservationSummary,
  type AiSessionPort,
  type AiSessionPreviewInput,
  type AiSessionPreviewResult,
  type AiSessionPublicArtifact,
  type AiSessionQueryInput,
  type AiSessionQueryResult,
  type AiSessionRequestResult,
  type AiSessionResponse,
  type AiSessionStateDelta,
} from './ai-session-contract';

/**
 * The application service deliberately contains no browser, filesystem,
 * crypto-module, network, or SDK dependency. It owns exactly one AgentGame,
 * revision sequence, and request ledger per created instance.
 */

const ZERO_HASH = '0'.repeat(64);
const QUERY_TARGETS = Object.keys(QUERY_FILTER_SCHEMAS) as PublicQueryTarget[];

interface CursorValue {
  sessionId: string;
  generation: number;
  revision: number;
  target: PublicQueryTarget;
  offset: number;
  filtersHash: string;
}

interface RequestLedgerEntry {
  requestHash: string;
  result: AiSessionActResult;
}

interface NormalizedActInput {
  generation: number;
  baseRevision: number;
  requestId: string;
  action: GameAction;
  decisionSummary: string | null;
  requestedCommentLocale: AiSessionCommentLocale;
}

function normalizeComment(value: unknown): string | null | AiSessionError {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return { code: 'invalid_request', message: 'decisionSummary must be a Unicode string when supplied' };
  const length = Array.from(value).length;
  if (length < 1 || length > AI_SESSION_MAX_COMMENT_CODE_POINTS) {
    return { code: 'invalid_request', message: `decisionSummary must contain 1-${AI_SESSION_MAX_COMMENT_CODE_POINTS} Unicode code points` };
  }
  return value;
}

function normalizeLocale(value: unknown, fallback: AiSessionCommentLocale): AiSessionCommentLocale | AiSessionError {
  if (value === undefined) return fallback;
  if (value === 'ja' || value === 'en') return value;
  return { code: 'invalid_request', message: 'requestedCommentLocale must be ja or en' };
}

function isError(value: unknown): value is AiSessionError {
  return isPlainObject(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Value is not JSON-compatible');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) throw new Error('Value is not JSON-compatible');
  const out: JsonObject = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) out[key] = canonicalize(value[key]);
  return out;
}

export function canonicalAiSessionJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new Error('Value is not JSON-compatible');
  return encoded;
}

function utf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let point = value.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00;
        index += 1;
      }
    }
    if (point <= 0x7f) bytes.push(point);
    else if (point <= 0x7ff) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point <= 0xffff) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
  }
  return Uint8Array.from(bytes);
}

/** Small synchronous SHA-256 implementation so decision hashes stay portable in every transport. */
export function sha256AiSessionJson(value: unknown): string {
  const source = utf8(canonicalAiSessionJson(value));
  const bitLength = BigInt(source.length) * 8n;
  const totalLength = Math.ceil((source.length + 1 + 8) / 64) * 64;
  const bytes = new Uint8Array(totalLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  for (let offset = 0; offset < 8; offset += 1) {
    bytes[bytes.length - 1 - offset] = Number((bitLength >> BigInt(offset * 8)) & 0xffn);
  }
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rightRotate = (input: number, shift: number): number => (input >>> shift) | (input << (32 - shift));
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = ((bytes[start]! << 24) | (bytes[start + 1]! << 16) | (bytes[start + 2]! << 8) | bytes[start + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15]!, 7) ^ rightRotate(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3);
      const s1 = rightRotate(words[index - 2]!, 17) ^ rightRotate(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[index]! + words[index]!) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, '0')).join('');
}

function matchesFilters(item: JsonValue, filters: Record<string, JsonValue>): boolean {
  if (!isPlainObject(item)) return Object.keys(filters).length === 0;
  return Object.entries(filters).every(([key, expected]) => {
    if (key === 'fromDecision' || key === 'toDecision') return true;
    if (key === 'qMin' || key === 'qMax' || key === 'rMin' || key === 'rMax') {
      const position = isPlainObject(item.position) ? item.position : item;
      const axis = key[0]!.toLowerCase();
      const actual = position[axis];
      return typeof actual === 'number' && typeof expected === 'number' && (key.endsWith('Min') ? actual >= expected : actual <= expected);
    }
    if (key === 'legalOnly') return expected !== true || item.legal === true;
    if (key === 'q' || key === 'r') {
      const position = isPlainObject(item.position) ? item.position : item;
      return position[key] === expected;
    }
    if (key === 'actionType') return (item.actionType ?? item.type) === expected;
    return item[key] === expected;
  });
}

function observationSummary(observation: AgentObservation, gameOver: boolean, result: AgentGameResult | null): AiSessionObservationSummary {
  return cloneJson({
    turn: observation.turn,
    phase: observation.phase,
    gameOver,
    map: {
      id: observation.map.id,
      width: observation.map.width,
      height: observation.map.height,
      visibleTileCount: observation.map.tiles.filter((tile) => tile.visibleToPlayer).length,
    },
    resources: observation.resources,
    population: observation.population,
    horde: observation.horde,
    result,
  });
}

function pageSize(value: unknown): number | AiSessionError {
  const size = value ?? AI_SESSION_DEFAULT_QUERY_PAGE_SIZE;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > AI_SESSION_MAX_QUERY_PAGE_SIZE) {
    return { code: 'invalid_page_size', message: `pageSize must be an integer from 1 to ${AI_SESSION_MAX_QUERY_PAGE_SIZE}` };
  }
  return size;
}

function encodeCursor(value: CursorValue): string {
  return canonicalAiSessionJson(value);
}

function decodeCursor(value: unknown): CursorValue | AiSessionError {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) return { code: 'invalid_cursor', message: 'query cursor is malformed' };
  try {
    const decoded = JSON.parse(value) as unknown;
    if (!isPlainObject(decoded)) return { code: 'invalid_cursor', message: 'query cursor is malformed' };
    const { sessionId, generation, revision, target, offset, filtersHash } = decoded;
    if (!isSafeId(sessionId)
      || typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1
      || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
      || typeof target !== 'string' || !QUERY_TARGETS.includes(target as PublicQueryTarget)
      || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
      || typeof filtersHash !== 'string' || !/^[0-9a-f]{64}$/u.test(filtersHash)) {
      return { code: 'invalid_cursor', message: 'query cursor is malformed' };
    }
    return { sessionId, generation, revision, target: target as PublicQueryTarget, offset, filtersHash };
  } catch {
    return { code: 'invalid_cursor', message: 'query cursor is malformed' };
  }
}

function cloneStepDelta(step: AgentStepResult, before: AgentObservation): AiSessionStateDelta {
  return cloneJson({
    facilityChanges: step.facilityChanges ?? null,
    branchFlowChanges: step.branchFlowChanges ?? null,
    eventCount: step.events.length,
    beforeTurn: before.turn,
    afterTurn: step.observation.turn,
  });
}

/** Programmatic lifecycle factory. No global registry is created. */
export function createAiSession(options: AiSessionCreateOptions = {}): AiSessionPort {
  return new AiSession(options);
}

export class AiSession implements AiSessionPort {
  private readonly game;
  private readonly sessionId: string;
  private readonly preferredCommentLocale: AiSessionCommentLocale;
  private readonly previewProjector: AiSessionCreateOptions['previewProjector'];
  private readonly requestLedger = new Map<string, RequestLedgerEntry>();
  private readonly decisions: AiSessionDecisionRecord[] = [];
  private automaticContextCheckpoint: ContextHandoff | null = null;
  private handoff() { return buildContextHandoff(this.game.getObservation(), { sessionId: this.sessionId, revision: this.revision, preferredCommentLocale: this.preferredCommentLocale, branchLineage: null }, this.decisions); }
  private lifecycle: AiSessionLifecycle = 'active';
  private revision = 0;
  private acting = false;
  private readonly generation = 1;

  public constructor(options: AiSessionCreateOptions = {}) {
    if (options.sessionId !== undefined && !isSafeId(options.sessionId)) throw new Error('sessionId must use 1-128 safe ASCII characters');
    if (options.preferredCommentLocale !== undefined && options.preferredCommentLocale !== 'ja' && options.preferredCommentLocale !== 'en') {
      throw new Error('preferredCommentLocale must be ja or en');
    }
    this.sessionId = options.sessionId ?? 'ai-session';
    this.preferredCommentLocale = options.preferredCommentLocale ?? 'en';
    this.previewProjector = options.previewProjector;
    this.game = createAgentGame({
      ...(options.buildId === undefined ? {} : { buildId: options.buildId }),
      ...(options.bridgeApiVersion === undefined ? {} : { bridgeApiVersion: options.bridgeApiVersion }),
      recordHistory: true,
    });
    if (options.initial !== undefined) this.game.reset(options.initial);
  }

  public getContext(): AiSessionContext {
    const actionReasonCode = this.lifecycle === 'paused' ? 'paused' : this.lifecycle === 'ended' ? 'session_ended' : null;
    return cloneJson({
      contextHandoff: this.handoff(),
      contractVersion: AI_SESSION_CONTRACT_VERSION,
      sessionId: this.sessionId,
      generation: this.generation,
      revision: this.revision,
      lifecycle: this.lifecycle,
      actionReasonCode,
      preferredCommentLocale: this.preferredCommentLocale,
      api: this.game.getApiInfo(),
      capabilities: {
        observe: true,
        boundedQuery: true,
        legalActions: true,
        previewAction: true,
        act: true,
        requestResult: true,
        gameResult: true,
        publicArtifact: true,
        maximumQueryPageSize: AI_SESSION_MAX_QUERY_PAGE_SIZE,
        commentCodePointRange: { min: 1, max: AI_SESSION_MAX_COMMENT_CODE_POINTS },
        preview: { legalActionCheck: true, economyProjection: 'core_projector_optional' },
      },
    });
  }

  public observe(): AiSessionResponse<{ observation: AiSessionObservationSummary; availableQueryTargets: PublicQueryTarget[] }> {
    const observation = this.game.getObservation();
    return this.success({
      observation: observationSummary(observation, this.game.isGameOver(), this.game.getResult()),
      availableQueryTargets: [...QUERY_TARGETS],
    });
  }

  public getLegalActions(input: AiSessionLegalActionsInput): AiSessionResponse<AiSessionLegalActionsResult> {
    if (!isPlainObject(input) || !hasOnlyKeys(input, [], ['generation', 'baseRevision', 'actionKind', 'cursor', 'pageSize'])) {
      return this.failure('invalid_request', 'legal-actions input is malformed');
    }
    const revisionFailure = this.requireCurrentRevision(input.generation, input.baseRevision, false);
    if (revisionFailure) return revisionFailure;
    if (input.actionKind !== undefined && (typeof input.actionKind !== 'string' || input.actionKind.length < 1 || input.actionKind.length > 64)) {
      return this.failure('invalid_request', 'actionKind must be a bounded action type');
    }
    const actions = this.game.getLegalActions().filter((action) => input.actionKind === undefined || action.type === input.actionKind);
    const filtersHash = sha256AiSessionJson({ actionKind: input.actionKind ?? null });
    return this.paginate(input.cursor, input.pageSize, 'legal-actions', filtersHash, actions as unknown as JsonValue[], (items, count, total, hasMore, nextCursor) => ({
      actions: cloneJson(items) as unknown as GameAction[], count, total, hasMore, nextCursor,
    }));
  }

  public previewAction(input: AiSessionPreviewInput): AiSessionResponse<AiSessionPreviewResult> {
    if (!isPlainObject(input) || !hasOnlyKeys(input, ['generation', 'baseRevision', 'action'])) {
      return this.failure('invalid_request', 'preview input requires generation, baseRevision, and action');
    }
    const revisionFailure = this.requireCurrentRevision(input.generation, input.baseRevision, true);
    if (revisionFailure) return revisionFailure;
    const legalActions = this.game.getLegalActions();
    const action = isGameActionInput(input.action) ? cloneAction(input.action) : null;
    if (!action) return this.failure('invalid_action_input', 'action must be one bounded, JSON-compatible GameAction');
    const legal = !!matchLegalAction(action,legalActions);
    let projection: AiSessionPreviewResult['projection'] = {
      kind: 'legal_action_check_only', reasonCode: 'economy_preview_unavailable', value: null,
    };
    if (this.previewProjector) {
      try {
        const value = this.previewProjector({
          generation: this.generation,
          baseRevision: this.revision,
          action: cloneAction(action),
          observation: this.game.getObservation(),
          legalActions: legalActions.map(cloneAction),
        });
        projection = { kind: 'core_projection', reasonCode: null, value: cloneJson(value) };
      } catch {
        // A missing/incomplete future economics projection must be explicit,
        // not silently treated as an action result.
      }
    } else if (this.game.previewAction) {
      try {
        projection = {
          kind: 'core_projection',
          reasonCode: null,
          value: cloneJson(this.game.previewAction(action, this.revision)),
        };
      } catch {
        // Keep the explicit unavailable projection if Core cannot calculate it.
      }
    }
    return this.success({
      action: cloneAction(action),
      legal,
      reasonCode: legal ? null : 'action_not_legal',
      projection,
    });
  }

  public act(input: AiSessionActInput): AiSessionResponse<AiSessionActResult> {
    const normalized = this.normalizeActInput(input);
    if (isError(normalized)) return this.failure(normalized.code, normalized.message, normalized.details);
    const requestHash = sha256AiSessionJson({
      generation: normalized.generation,
      baseRevision: normalized.baseRevision,
      action: normalized.action,
      decisionSummary: normalized.decisionSummary,
      requestedCommentLocale: normalized.requestedCommentLocale,
    });
    const previous = this.requestLedger.get(normalized.requestId);
    if (previous) {
      if (previous.requestHash !== requestHash) {
        return this.failure('request_id_conflict', `requestId ${normalized.requestId} was already used for different content`, {
          requestId: normalized.requestId,
          originalRequestHash: previous.requestHash,
          suppliedRequestHash: requestHash,
        });
      }
      // A retry returns the exact original public result, even after revision,
      // pause, or end has changed since the original Decision.
      return this.successAt(previous.result.record.revision, cloneJson(previous.result));
    }
    const revisionFailure = this.requireCurrentRevision(normalized.generation, normalized.baseRevision, true);
    if (revisionFailure) return revisionFailure;
    if (this.lifecycle === 'ended' || this.game.isGameOver()) return this.failure('session_ended', 'session no longer accepts actions');
    if (this.lifecycle === 'paused') return this.failure('paused', 'session action acceptance is paused');
    if (this.acting) return this.failure('busy', 'another action is being processed');

    const before = this.game.getObservation();
    let stepped: AgentStepResult;
    this.acting = true;
    try {
      stepped = this.game.step(normalized.action);
    } finally {
      this.acting = false;
    }
    this.revision += 1;
    const after = cloneJson(stepped.observation);
    const accepted = stepped.error === null;
    const withoutHash = {
      decision: this.decisions.length + 1,
      generation: this.generation,
      baseRevision: normalized.baseRevision,
      revision: this.revision,
      requestId: normalized.requestId,
      requestHash,
      inputAction: cloneAction(normalized.action),
      decisionSummary: normalized.decisionSummary,
      requestedCommentLocale: normalized.requestedCommentLocale,
      accepted,
      requestStatus: accepted ? 'completed' as const : 'rejected' as const,
      reasonCode: stepped.error?.code ?? null,
      error: stepped.error ? cloneJson(stepped.error) : null,
      events: cloneJson(stepped.events),
      stateDelta: cloneStepDelta(stepped, before),
      importantChanges: accepted ? deriveImportantChanges(before, after, stepped.events) : [],
      gameOver: stepped.gameOver,
      result: cloneJson(stepped.result),
      previousDecisionHash: this.decisions.at(-1)?.decisionHash ?? ZERO_HASH,
    };
    const record: AiSessionDecisionRecord = { ...withoutHash, decisionHash: sha256AiSessionJson(withoutHash) };
    this.decisions.push(cloneJson(record));
    const handoff = this.handoff();
    if (handoff.contextCheckpoint.decision === this.revision) this.automaticContextCheckpoint = handoff;
    if (stepped.gameOver) this.lifecycle = 'ended';
    const result: AiSessionActResult = {
      // Do not vary this DTO on retry: equal request payloads must yield an
      // equal public result. Consumers can query the ledger if they need it.
      replayed: false,
      before: cloneJson(before),
      after,
      record: cloneJson(record),
    };
    this.requestLedger.set(normalized.requestId, { requestHash, result: cloneJson(result) });
    return this.success(result);
  }

  public getRequestResult(requestId: string): AiSessionResponse<AiSessionRequestResult> {
    if (!isSafeId(requestId)) return this.failure('invalid_request', 'requestId must use 1-128 safe ASCII characters');
    const entry = this.requestLedger.get(requestId);
    if (!entry) return this.failure('request_not_found', `requestId ${requestId} is not known to this session`);
    return this.successAt(entry.result.record.revision, {
      requestId,
      status: entry.result.record.requestStatus,
      result: cloneJson(entry.result),
    });
  }

  public getResult(): AiSessionResponse<AiSessionGameResult> {
    const result = this.game.getResult();
    return this.success({ status: result ? 'finished' : 'not_finished', result: cloneJson(result) });
  }

  public buildPublicArtifact(): AiSessionResponse<{ artifact: AiSessionPublicArtifact }> {
    const artifact: AiSessionPublicArtifact = {
      artifactType: 'ai-session-public-artifact',
      contractVersion: AI_SESSION_CONTRACT_VERSION,
      context: {
        sessionId: this.sessionId,
        generation: this.generation,
        revision: this.revision,
        preferredCommentLocale: this.preferredCommentLocale,
      },
      agentArtifact: cloneJson(this.game.getRunArtifact()),
      decisions: cloneJson(this.decisions),
      finalObservation: this.game.getObservation(),
      result: cloneJson(this.game.getResult()),
    };
    return this.success({ artifact });
  }

  public setPaused(paused: boolean): AiSessionResponse<{ lifecycle: AiSessionLifecycle }> {
    if (typeof paused !== 'boolean') return this.failure('invalid_request', 'paused must be boolean');
    if (this.lifecycle === 'ended' || this.game.isGameOver()) return this.failure('session_ended', 'ended sessions cannot change action acceptance');
    this.lifecycle = paused ? 'paused' : 'active';
    return this.success({ lifecycle: this.lifecycle });
  }

  public end(): AiSessionResponse<AiSessionEndResult> {
    this.lifecycle = 'ended';
    return this.success({ ended: true, result: cloneJson(this.game.getResult()) });
  }

  public query(input: AiSessionQueryInput): AiSessionResponse<AiSessionQueryResult> {
    if (!isPlainObject(input) || !hasOnlyKeys(input, ['target'], ['generation', 'baseRevision', 'cursor', 'pageSize', 'filters'])) {
      return this.failure('invalid_request', 'query input is malformed');
    }
    if (typeof input.target !== 'string' || !QUERY_TARGETS.includes(input.target as PublicQueryTarget)) {
      return this.failure('invalid_query', `query target must be one of ${QUERY_TARGETS.join(', ')}`);
    }
    const target = input.target as PublicQueryTarget;
    const revisionFailure = this.requireCurrentRevision(input.generation, input.baseRevision, false);
    if (revisionFailure) return revisionFailure;
    const filters = input.filters === undefined ? {} : input.filters;
    if (!isPlainObject(filters) || !isBoundedJson(filters)) return this.failure('invalid_query', 'query filters must be bounded JSON object');
    const filterErrors = validateQuerySchema(filters, QUERY_FILTER_SCHEMAS[target]);
    if (filterErrors.length) return this.failure('invalid_query', filterErrors.join('; '));
    const filtersHash = sha256AiSessionJson(filters);
    const observation = this.game.getObservation();
    const legalActions = this.game.getLegalActions();
    let value: JsonValue | undefined;
    let items: JsonValue[] = [];
    if (target === 'history') {
      const from = typeof filters.fromDecision === 'number' && Number.isSafeInteger(filters.fromDecision) ? Math.max(1, filters.fromDecision) : 1;
      const to = Math.min(this.decisions.length, typeof filters.toDecision === 'number' && Number.isSafeInteger(filters.toDecision) ? filters.toDecision : this.decisions.length);
      items = cloneJson(this.decisions.slice(Math.max(0, from - 1), to)) as unknown as JsonValue[];
    } else {
      try {
        switch (target) {
          case 'context-handoff': value = handoffJson(this.handoff()); break;
          case 'api':
            value = cloneJson({ ...this.game.getApiInfo(), queryContract: publicQueryContract() }) as unknown as JsonValue;
            break;
          case 'map': {
            const { tiles, ...map } = observation.map;
            value = cloneJson({ ...map, visibleTileCount: tiles.filter((tile) => tile.visibleToPlayer).length }) as unknown as JsonValue;
            items = cloneJson(tiles) as unknown as JsonValue[];
            break;
          }
          case 'strategic-map': {
            const graph = deriveStrategicMap(observation);
            const collection = filters.collection === 'edges' ? 'edges' : 'nodes';
            value = cloneJson({ mapId: graph.mapId, collection, nodeCount: graph.nodes.length, edgeCount: graph.edges.length, unconnectedFacilityCount: graph.unconnectedFacilityIds.length }) as unknown as JsonValue;
            items = cloneJson(strategicMapItems(graph, collection)) as unknown as JsonValue[];
            break;
          }
          case 'route':
            value = cloneJson(queryRoute(observation, filters as unknown as RouteQueryInput)) as unknown as JsonValue;
            break;
          case 'units': items = cloneJson(observation.units) as unknown as JsonValue[]; break;
          case 'facilities': items = cloneJson(observation.facilities) as unknown as JsonValue[]; break;
          case 'checkpoints':
            items = cloneJson(observation.checkpoints.map((checkpoint) => ({ ...checkpoint, supplyExplanation: checkpointSupplyExplanation(observation, checkpoint.branchId, this.revision) }))) as unknown as JsonValue[];
            break;
          case 'branches': items = cloneJson(observation.roadBranches) as unknown as JsonValue[]; break;
          case 'worker-assignments': items = cloneJson(observation.workerAssignmentCandidates.map((item) => ({ ...item, revision: this.revision }))) as unknown as JsonValue[]; break;
          case 'population-transfers': items = cloneJson(observation.populationTransferCandidates.map((item) => ({ ...item, revision: this.revision }))) as unknown as JsonValue[]; break;
          case 'construction': {
            const supplied = new Set(observation.supply.suppliedTileKeys);
            items = cloneJson([
              ...observation.checkpointPositionCandidates.map(c => ({ ...c, facilityType: 'checkpoint' as const })),
              ...observation.constructibleFacilityPositionCandidates.map(c => ({ ...c, actionType: 'BuildConstructibleFacility' as const })),
              ...observation.barbedWireCandidates.map((candidate) => ({ ...candidate, actionType: 'BuildBarbedWire', facilityType: 'barbedWire', reasonCode: candidate.reason })),
            ].map((item) => ({ ...item, inSupply: supplied.has(`${item.position.q},${item.position.r}`), revision: this.revision }))) as unknown as JsonValue[];
            break;
          }
          case 'legal-actions': items = cloneJson(legalActions) as unknown as JsonValue[]; break;
          case 'forecast': value = cloneJson({ endTurnForecast: observation.endTurnForecast, strategicForecast: observation.strategicForecast }) as unknown as JsonValue; break;
          case 'full-snapshot': value = cloneJson({ observation, legalActions }) as unknown as JsonValue; break;
        }
      } catch (error) {
        if (error instanceof RouteQueryInputError) return this.failure('invalid_query', `${error.code}: ${error.message}`);
        return this.failure('invalid_query', 'public query could not be projected');
      }
    }
    const filtered = target === 'strategic-map' ? items : items.filter((item) => matchesFilters(item, filters));
    const paginated = target === 'map' || target === 'strategic-map' || value === undefined;
    return this.paginate(input.cursor, input.pageSize, target, filtersHash, filtered, (page, count, total, hasMore, nextCursor) => ({
      target,
      count: paginated ? count : 1,
      total: paginated ? total : 1,
      hasMore: paginated && hasMore,
      nextCursor: paginated ? nextCursor : null,
      ...(page.length > 0 ? { items: cloneJson(page) } : {}),
      ...(value === undefined ? {} : { value: cloneJson(value) }),
    }));
  }

  private normalizeActInput(raw: unknown): NormalizedActInput | AiSessionError {
    if (!isPlainObject(raw) || !hasOnlyKeys(raw, ['generation', 'baseRevision', 'requestId', 'action'], ['decisionSummary', 'requestedCommentLocale'])) {
      return { code: 'invalid_request', message: 'act input requires generation, baseRevision, requestId, and action' };
    }
    const { generation, baseRevision, requestId } = raw;
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) return { code: 'invalid_request', message: 'generation must be a positive safe integer' };
    if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 0) return { code: 'invalid_request', message: 'baseRevision must be a non-negative safe integer' };
    if (!isSafeId(requestId)) return { code: 'invalid_request', message: 'requestId must use 1-128 safe ASCII characters' };
    const action = isGameActionInput(raw.action) ? cloneAction(raw.action) : null;
    if (!action) return { code: 'invalid_action_input', message: 'action must be one bounded, JSON-compatible GameAction' };
    const decisionSummary = normalizeComment(raw.decisionSummary);
    if (isError(decisionSummary)) return decisionSummary;
    const requestedCommentLocale = normalizeLocale(raw.requestedCommentLocale, this.preferredCommentLocale);
    if (isError(requestedCommentLocale)) return requestedCommentLocale;
    return {
      generation,
      baseRevision,
      requestId,
      action,
      decisionSummary,
      requestedCommentLocale,
    };
  }

  private requireCurrentRevision(generation: unknown, baseRevision: unknown, required: boolean): AiSessionFailure | null {
    if (generation !== undefined) {
      if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) return this.failure('invalid_request', 'generation must be a positive safe integer');
      if (generation !== this.generation) return this.failure('stale_generation', `expected generation ${generation}, current generation is ${this.generation}`);
    }
    if (baseRevision === undefined) return required ? this.failure('invalid_request', 'baseRevision is required') : null;
    if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 0) return this.failure('invalid_request', 'baseRevision must be a non-negative safe integer');
    if (baseRevision !== this.revision) return this.failure('stale_revision', `expected revision ${baseRevision}, current revision is ${this.revision}`);
    return null;
  }

  private paginate<T extends JsonValue, U extends object>(
    rawCursor: unknown,
    rawPageSize: unknown,
    target: PublicQueryTarget,
    filtersHash: string,
    items: readonly T[],
    build: (page: T[], count: number, total: number, hasMore: boolean, nextCursor: string | null) => U,
  ): AiSessionResponse<U> {
    const size = pageSize(rawPageSize);
    if (isError(size)) return this.failure(size.code, size.message);
    const parsed = rawCursor === undefined ? null : decodeCursor(rawCursor);
    if (isError(parsed)) return this.failure(parsed.code, parsed.message);
    if (parsed && (parsed.sessionId !== this.sessionId || parsed.generation !== this.generation || parsed.revision !== this.revision || parsed.target !== target || parsed.filtersHash !== filtersHash)) {
      return this.failure('stale_revision', 'query cursor does not belong to the current session revision and filter');
    }
    const offset = parsed?.offset ?? 0;
    if (offset > items.length) return this.failure('invalid_cursor', 'query cursor offset exceeds result size');
    const page = items.slice(offset, offset + size).map((item) => cloneJson(item));
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < items.length;
    const nextCursor = hasMore ? encodeCursor({ sessionId: this.sessionId, generation: this.generation, revision: this.revision, target, offset: nextOffset, filtersHash }) : null;
    return this.success(build(page, page.length, items.length, hasMore, nextCursor));
  }

  private success<T extends object>(value: T): AiSessionSuccess<T> {
    return this.successAt(this.revision, value);
  }

  private successAt<T extends object>(revision: number, value: T): AiSessionSuccess<T> {
    return cloneJson({ ok: true, generation: this.generation, revision, ...value }) as AiSessionSuccess<T>;
  }

  private failure(code: AiSessionError['code'], message: string, details?: JsonValue): AiSessionFailure {
    return cloneJson({ ok: false, generation: this.generation, revision: this.revision, error: { code, message, ...(details === undefined ? {} : { details }) } });
  }
}

type AiSessionSuccess<T extends object> = { ok: true; generation: number; revision: number } & T;
