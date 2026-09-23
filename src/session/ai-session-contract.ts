import type { PublicQueryTarget } from '../agent/query-contract';
import type {
  AgentActionError,
  AgentApiInfo,
  AgentGameResult,
  AgentObservation,
  AgentPublicEvent,
  AgentPublicRunArtifact,
  AgentResetOptions,
  AgentStepResult,
} from '../agent/types';
import type { GameAction, JsonValue } from '../core/types';

/**
 * Transport-neutral public contract for one AI-controlled game.
 *
 * This module deliberately imports only public Agent/Core types.  It does
 * not name a browser, a protocol, an SDK, or a storage implementation.
 */
export const AI_SESSION_CONTRACT_VERSION = '1.2.0' as const;
export const AI_SESSION_DEFAULT_QUERY_PAGE_SIZE = 100;
export const AI_SESSION_MAX_QUERY_PAGE_SIZE = 500;
export const AI_SESSION_MAX_COMMENT_CODE_POINTS = 500;
export const AI_SESSION_MAX_REQUEST_ID_CODE_POINTS = 128;

export type AiSessionCommentLocale = 'ja' | 'en';
export type AiSessionLifecycle = 'active' | 'paused' | 'ended';
export type AiSessionRequestStatus = 'accepted' | 'completed' | 'rejected' | 'timed_out';

/** Machine-readable public reasons.  Agent/Core reason codes remain intact. */
export type AiSessionReasonCode =
  | 'stale_generation'
  | 'stale_revision'
  | 'busy'
  | 'paused'
  | 'session_ended'
  | 'request_id_conflict'
  | 'request_not_found'
  | 'invalid_request'
  | 'invalid_action_input'
  | 'invalid_query'
  | 'invalid_page_size'
  | 'invalid_cursor'
  | 'action_not_legal'
  | 'economy_preview_unavailable'
  | 'unsupported';

export interface AiSessionError {
  code: AiSessionReasonCode | string;
  message: string;
  details?: JsonValue;
}

export interface AiSessionFailure {
  ok: false;
  generation: number;
  revision: number;
  error: AiSessionError;
}

export interface AiSessionSuccess {
  ok: true;
  generation: number;
  revision: number;
}

export type AiSessionResponse<T extends object> = (AiSessionSuccess & T) | AiSessionFailure;

/** A factory input, not a reset endpoint.  A session is immutable in identity after creation. */
export interface AiSessionCreateOptions {
  /** Public AgentGame initialization. No save/session restoration is accepted here. */
  initial?: AgentResetOptions;
  /** Used by portable transports; an act call may explicitly override it. */
  preferredCommentLocale?: AiSessionCommentLocale;
  /** Opaque public routing label. It is never included in decision hashes. */
  sessionId?: string;
  buildId?: string;
  bridgeApiVersion?: string;
  /**
   * Optional pure Core projection hook. It receives only public values and
   * must not mutate them. The base implementation exposes legal-action
   * preview until the fuller economy projection is supplied by Core.
   */
  previewProjector?: AiSessionPreviewProjector;
}

export interface AiSessionContext {
  contextHandoff: import('./context-handoff').ContextHandoff;
  contractVersion: typeof AI_SESSION_CONTRACT_VERSION;
  sessionId: string;
  generation: number;
  revision: number;
  lifecycle: AiSessionLifecycle;
  actionReasonCode: 'paused' | 'session_ended' | null;
  preferredCommentLocale: AiSessionCommentLocale;
  api: AgentApiInfo;
  capabilities: {
    observe: true;
    boundedQuery: true;
    legalActions: true;
    previewAction: true;
    act: true;
    requestResult: true;
    gameResult: true;
    publicArtifact: true;
    maximumQueryPageSize: typeof AI_SESSION_MAX_QUERY_PAGE_SIZE;
    commentCodePointRange: { min: 1; max: typeof AI_SESSION_MAX_COMMENT_CODE_POINTS };
    preview: {
      legalActionCheck: true;
      economyProjection: 'core_projector_optional';
    };
  };
}

/** Bounded top-level view; larger collections are returned through query pages. */
export interface AiSessionObservationSummary {
  turn: number;
  phase: AgentObservation['phase'];
  gameOver: boolean;
  map: {
    id: string;
    width: number;
    height: number;
    visibleTileCount: number;
  };
  resources: AgentObservation['resources'];
  population: AgentObservation['population'];
  horde: AgentObservation['horde'];
  result: AgentGameResult | null;
}

export interface AiSessionObserveResult {
  observation: AiSessionObservationSummary;
  availableQueryTargets: PublicQueryTarget[];
}

export interface AiSessionRevisionInput {
  generation?: number;
  baseRevision?: number;
}

export interface AiSessionLegalActionsInput extends AiSessionRevisionInput {
  actionKind?: GameAction['type'];
  cursor?: string;
  pageSize?: number;
}

export interface AiSessionLegalActionsResult {
  actions: GameAction[];
  count: number;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AiSessionQueryInput extends AiSessionRevisionInput {
  target: PublicQueryTarget;
  cursor?: string;
  pageSize?: number;
  filters?: Record<string, JsonValue>;
}

export interface AiSessionQueryResult {
  target: PublicQueryTarget;
  count: number;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  items?: JsonValue[];
  value?: JsonValue;
}

export interface AiSessionPreviewInput extends AiSessionRevisionInput {
  /** Required for preview so a caller cannot accidentally apply a stale forecast. */
  baseRevision: number;
  action: GameAction;
}
export interface AiSessionBatchPreviewInput extends AiSessionRevisionInput { baseRevision: number; actions: GameAction[] }
export interface AiSessionBatchPreviewResult { baseRevision: number; independent: true; results: AiSessionPreviewResult[] }

export interface AiSessionPreviewProjectorInput {
  generation: number;
  baseRevision: number;
  action: GameAction;
  observation: AgentObservation;
  legalActions: GameAction[];
}

export type AiSessionPreviewProjector = (input: AiSessionPreviewProjectorInput) => JsonValue;

export interface AiSessionPreviewResult {
  action: GameAction;
  legal: boolean;
  reasonCode: string | null;
  /**
   * Current AgentGame can authoritatively provide legal-action matching. A
   * v1.6 Core economics projector can replace this value through the factory
   * hook without changing any transport DTO.
   */
  projection: {
    kind: 'core_projection' | 'legal_action_check_only';
    reasonCode: 'economy_preview_unavailable' | null;
    value: JsonValue | null;
  };
}

export interface AiSessionActInput extends AiSessionRevisionInput {
  generation: number;
  baseRevision: number;
  requestId: string;
  action: GameAction;
  /** Omitted, null, or empty string means no comment. Non-empty text is raw. */
  decisionSummary?: string | null;
  /** Defaults to the immutable preferred locale selected at creation. */
  requestedCommentLocale?: AiSessionCommentLocale;
}

export interface AiSessionStateDelta {
  facilityChanges: NonNullable<AgentStepResult['facilityChanges']> | null;
  branchFlowChanges: NonNullable<AgentStepResult['branchFlowChanges']> | null;
  eventCount: number;
  beforeTurn: number;
  afterTurn: number;
}

/** Canonical per-session decision metadata; it intentionally contains no transport metadata. */
export interface AiSessionDecisionRecord {
  decision: number;
  generation: number;
  baseRevision: number;
  revision: number;
  requestId: string;
  requestHash: string;
  inputAction: GameAction;
  decisionSummary: string | null;
  requestedCommentLocale: AiSessionCommentLocale;
  accepted: boolean;
  requestStatus: Extract<AiSessionRequestStatus, 'completed' | 'rejected'>;
  reasonCode: string | null;
  error: AgentActionError | null;
  events: AgentPublicEvent[];
  stateDelta: AiSessionStateDelta;
  importantChanges?: import('../agent/decision-summary').ImportantChange[];
  gameOver: boolean;
  result: AgentGameResult | null;
  previousDecisionHash: string;
  decisionHash: string;
}

export interface AiSessionActResult {
  replayed: boolean;
  before: AgentObservation;
  after: AgentObservation;
  record: AiSessionDecisionRecord;
}

export interface AiSessionRequestResult {
  requestId: string;
  status: AiSessionRequestStatus;
  result: AiSessionActResult;
}

export interface AiSessionGameResult {
  status: 'not_finished' | 'finished';
  result: AgentGameResult | null;
}

/**
 * Public in-memory artifact DTO. Byte/package construction and delivery are
 * intentionally separate adapters so this port never names a local path.
 */
export interface AiSessionPublicArtifact {
  artifactType: 'ai-session-public-artifact';
  contractVersion: typeof AI_SESSION_CONTRACT_VERSION;
  context: Pick<AiSessionContext, 'sessionId' | 'generation' | 'revision' | 'preferredCommentLocale'>;
  agentArtifact: AgentPublicRunArtifact;
  decisions: AiSessionDecisionRecord[];
  finalObservation: AgentObservation;
  result: AgentGameResult | null;
}

export interface AiSessionEndResult {
  ended: true;
  result: AgentGameResult | null;
}

export interface AiSessionPort {
  getContext(): AiSessionContext;
  observe(): AiSessionResponse<AiSessionObserveResult>;
  query(input: AiSessionQueryInput): AiSessionResponse<AiSessionQueryResult>;
  getLegalActions(input: AiSessionLegalActionsInput): AiSessionResponse<AiSessionLegalActionsResult>;
  previewAction(input: AiSessionPreviewInput): AiSessionResponse<AiSessionPreviewResult>;
  previewActions(input: AiSessionBatchPreviewInput): AiSessionResponse<AiSessionBatchPreviewResult>;
  act(input: AiSessionActInput): AiSessionResponse<AiSessionActResult>;
  getRequestResult(requestId: string): AiSessionResponse<AiSessionRequestResult>;
  getResult(): AiSessionResponse<AiSessionGameResult>;
  buildPublicArtifact(): AiSessionResponse<{ artifact: AiSessionPublicArtifact }>;
  setPaused(paused: boolean): AiSessionResponse<{ lifecycle: AiSessionLifecycle }>;
  end(): AiSessionResponse<AiSessionEndResult>;
}
