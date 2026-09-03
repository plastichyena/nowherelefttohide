import type { GameAction, JsonValue } from '../core/types';
import type {
  AgentGameResult,
  AgentMapObservation,
  AgentObservation,
  AgentPublicEvent,
  AgentPublicRunArtifact,
  AgentStepResult,
} from '../agent/types';

/** Session/Checkpoint v2 deliberately rejects all v1.4.3 portable data. */
export const CHECKPOINT_SCHEMA_VERSION = '2.0.0' as const;
export const SESSION_SCHEMA_VERSION = '2.0.0' as const;
export const DEFAULT_CHECKPOINT_INTERVAL = 5;
export const MAX_DECISION_SUMMARY_CODE_POINTS = 500;
export const ZERO_HASH = '0'.repeat(64);

export type SessionCommand =
  | 'new'
  | 'status'
  | 'step'
  | 'save-checkpoint'
  | 'list-checkpoints'
  | 'load-checkpoint'
  | 'artifact';

export interface SessionVersionIdentity {
  appVersion: string;
  gameRulesVersion: string;
  saveFormatVersion: number | string;
  artifactSchemaVersion: string;
  agentApiVersion: string;
  observationApiVersion: string;
  bridgeApiVersion: string;
  buildId: string;
  gitCommit: string;
  mapId: string;
}

export interface SessionLineage {
  parentSessionId: string | null;
  parentCheckpointId: string | null;
}

export interface SessionDescriptor extends SessionVersionIdentity, SessionLineage {
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  checkpointSchemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  sessionId: string;
  seed: number;
  agentId: string;
  checkpointInterval: number;
  publicConfig: JsonValue;
  createdAt: string;
  descriptorIntegrityHash: string;
}

/** The fixed topology is stored once and Decision observations reference it. */
export type SessionTraceObservation = Omit<AgentObservation, 'map'> & {
  mapId: string;
  visibleTileKeys: string[];
};

export interface SessionStepInput {
  action: GameAction;
  decisionSummary: string;
}

export interface PublicDecisionRecord {
  decision: number;
  turn: number;
  phase: AgentObservation['phase'];
  observationBefore: SessionTraceObservation;
  legalActionsBefore: GameAction[];
  inputAction: GameAction;
  decisionSummary: string;
  accepted: boolean;
  error: AgentStepResult['error'];
  events: AgentPublicEvent[];
  observationAfter: SessionTraceObservation;
  previousDecisionHash: string;
  decisionHash: string;
}

export interface SessionRunBase extends SessionLineage {
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  artifactSchemaVersion: string;
  sessionId: string;
  seed: number;
  agentId: string;
  buildId: string;
  publicConfig: JsonValue;
  fixedMap: AgentMapObservation;
  initialObservation: SessionTraceObservation;
  runBaseIntegrityHash: string;
}

export interface SessionFileReference {
  relativePath: string;
  sha256: string;
}

export interface ActiveCommit {
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  generation: number;
  decision: number;
  completedTurn: number;
  currentTurn: number;
  phase: AgentObservation['phase'];
  traceHeadHash: string;
  privateState: SessionFileReference;
  publicState: SessionFileReference;
  gameOver: boolean;
  result: AgentGameResult | null;
  acceptedActionCount: number;
  invalidActionCount: number;
  committedAt: string;
  commitIntegrityHash: string;
}

export type SessionCheckpointKind = 'periodic' | 'manual' | 'final';

export interface SessionCheckpointMetadata extends SessionVersionIdentity, SessionLineage {
  checkpointSchemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  checkpointId: string;
  kind: SessionCheckpointKind;
  seed: number;
  publicConfigHash: string;
  completedTurn: number;
  currentTurn: number;
  phase: AgentObservation['phase'];
  decision: number;
  privateState: SessionFileReference;
  publicState: SessionFileReference;
  publicTraceHeadHash: string;
  createdAt: string;
  metadataIntegrityHash: string;
}

export interface SessionPublicState {
  observation: AgentObservation;
  legalActions: GameAction[];
  gameOver: boolean;
  result: AgentGameResult | null;
  decision: number;
  traceHeadHash: string;
}

export interface SessionStatusResult {
  session: SessionDescriptor;
  active: ActiveCommit;
  observation: AgentObservation;
  legalActions: GameAction[];
  gameOver: boolean;
  result: AgentGameResult | null;
  sessionMetrics: SessionMetrics;
}

export interface SessionStepResult extends SessionStatusResult {
  accepted: boolean;
  error: AgentStepResult['error'];
  events: AgentPublicEvent[];
  decisionRecord: PublicDecisionRecord;
  checkpointsCreated: SessionCheckpointMetadata[];
}

export interface NewSessionOptions {
  sessionId?: string;
  seed?: number;
  agentId?: string;
  checkpointInterval?: number;
}

export interface SessionGameRuntime {
  getObservation(): AgentObservation;
  getLegalActions(): GameAction[];
  step(input: SessionStepInput): AgentStepResult;
  isGameOver(): boolean;
  getResult(): AgentGameResult | null;
  getRunArtifact(): AgentPublicRunArtifact;
  exportPrivateState(): JsonValue;
}

export interface SessionGameFactory {
  createNew(options: { seed: number; agentId: string }): SessionGameRuntime;
  restore(options: {
    privateState: JsonValue;
    seed: number;
    agentId: string;
    sessionId: string;
    decision: number;
    traceHeadHash: string;
  }): SessionGameRuntime;
}

export interface SessionArtifact extends Record<string, unknown> {
  sessionId: string;
  lineage: SessionLineage;
  decisionTrace: PublicDecisionRecord[];
}

export type SessionDiagnosticEventKind =
  | 'activeSessionResumed'
  | 'manualCheckpointCreated'
  | 'periodicCheckpointCreated'
  | 'finalCheckpointCreated'
  | 'branchedSessionCreated'
  | 'hashRejected'
  | 'versionRejected'
  | 'buildRejected'
  | 'corruptionRejected'
  | 'invalidDecision'
  | 'inputFormatRejected';

export interface SessionDiagnosticEvent {
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  eventId: string;
  kind: SessionDiagnosticEventKind;
  operation: string;
  recordedAt: string;
  integrityHash: string;
}

/** Operational diagnostics are deliberately separate from game-score Metrics. */
export interface SessionMetrics {
  activeSessionResumes: number;
  manualCheckpointsCreated: number;
  periodicCheckpointsCreated: number;
  finalCheckpointsCreated: number;
  branchedSessionsCreated: number;
  hashRejections: number;
  versionRejections: number;
  buildRejections: number;
  corruptionRejections: number;
  invalidDecisions: number;
  inputFormatRejections: number;
  diagnosticIntegrityErrors: number;
}

export type SessionFaultStage =
  | 'after-private-state-write'
  | 'after-public-state-write'
  | 'after-decision-write'
  | 'after-trace-append'
  | 'before-active-commit'
  | 'after-checkpoint-private-write'
  | 'after-checkpoint-public-write'
  | 'before-checkpoint-metadata';

export type SessionFaultInjector = (stage: SessionFaultStage) => void;

export class SessionError extends Error {
  public readonly code: string;
  public readonly details?: JsonValue;

  public constructor(code: string, message: string, details?: JsonValue) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.details = details;
  }
}
