import type { GameAction, JsonValue } from '../core/types';
import type {
  AgentApiInfo,
  AgentGameResult,
  AgentMapObservation,
  AgentObservation,
  AgentPublicEvent,
  AgentPublicRunArtifact,
  AgentStepResult,
} from '../agent/types';

/** v1.5.1 deliberately rejects Session/Checkpoint v3 instead of migrating it. */
export const CHECKPOINT_SCHEMA_VERSION = '4.0.0' as const;
export const SESSION_SCHEMA_VERSION = '4.0.0' as const;
export const SESSION_STORE_SCHEMA_VERSION = '1.0.0' as const;
export const SESSION_ARTIFACT_PACKAGE_VERSION = '1.0.0' as const;
export const DEFAULT_CHECKPOINT_INTERVAL = 5;
export const PUBLIC_SNAPSHOT_INTERVAL = 50;
export const DEFAULT_QUERY_PAGE_SIZE = 100;
export const MAX_QUERY_PAGE_SIZE = 500;
export const MAX_DECISION_SUMMARY_CODE_POINTS = 500;
export const ZERO_HASH = '0'.repeat(64);

export type SessionCommand = 'new' | 'status' | 'step' | 'save-checkpoint' | 'list-checkpoints' | 'load-checkpoint' | 'query' | 'artifact';

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

export interface SessionLineage { parentSessionId: string | null; parentCheckpointId: string | null }

export interface SessionBranchBase {
  rootSessionId: string;
  parentSessionId: string;
  parentCheckpointId: string;
  baseDecision: number;
  baseTraceHeadHash: string;
  basePublicSnapshotHash: string;
  ancestorManifestHash: string;
}

export interface SessionDescriptor extends SessionVersionIdentity, SessionLineage {
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  checkpointSchemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  sessionId: string;
  storeId: string;
  branchBase: SessionBranchBase | null;
  seed: number;
  agentId: string;
  checkpointInterval: number;
  publicConfig: JsonValue;
  createdAt: string;
  descriptorIntegrityHash: string;
}

export interface SessionStoreManifest {
  storeSchemaVersion: typeof SESSION_STORE_SCHEMA_VERSION;
  storeId: string;
  publicPoolPath: 'pool/public';
  privatePoolPath: 'pool/private';
  chunkBytes: number;
  createdAt: string;
  manifestIntegrityHash: string;
}

export interface SessionPayloadChunk { hash: string; compressedBytes: number }
export interface SessionPayloadReference {
  domain: 'public' | 'private';
  contentHash: string;
  logicalBytes: number;
  compressedBytes: number;
  encoding: 'canonical-json+gzip-chunks' | 'utf8+gzip-chunks';
  chunks: SessionPayloadChunk[];
}

export type SessionTraceObservation = Omit<AgentObservation, 'map'> & { mapId: string; visibleTileKeys: string[] };
export interface SessionPublicDocument {
  observation: SessionTraceObservation;
  legalActions: GameAction[];
  gameOver: boolean;
  result: AgentGameResult | null;
}

export type JsonPatchOperation =
  | { op: 'set'; path: Array<string | number>; value: JsonValue }
  | { op: 'delete'; path: Array<string | number> }
  | { op: 'splice'; path: Array<string | number>; index: number; deleteCount: number; values: JsonValue[] };
export interface SessionPublicSnapshotPayload { kind: 'snapshot'; document: SessionPublicDocument; documentHash: string }
export interface SessionPublicDiffPayload { kind: 'diff'; beforeDocumentHash: string; afterDocumentHash: string; operations: JsonPatchOperation[] }
export interface SessionPublicHead {
  kind: 'head';
  decision: number;
  traceHeadHash: string;
  documentHash: string;
  snapshot: SessionPayloadReference;
  diffs: SessionPayloadReference[];
}
export interface SessionPrivateEnvelope { body: JsonValue; map: SessionPayloadReference | null; events: SessionPayloadReference[] }

export interface SessionStepInput { action: GameAction; decisionSummary: string; expectedRevision?: number }

export interface SessionStateDelta {
  newlyInfectedSites: string[];
  newlyRuinedSites: string[];
  newlySpottedEnemies: string[];
  lostEnemies: string[];
  unitHpChanges: Array<{ unitId: string; before: number; after: number }>;
  unitSupplyChanges: Array<{ unitId: string; beforeFuel: number; afterFuel: number; beforeMilitaryGoods: number; afterMilitaryGoods: number }>;
  checkpointRoleChanges: Array<{ checkpointId: string; before: string; after: string }>;
}

/** Small hash-chained record. Observation/legal-action bodies live in the payload pool. */
export interface PublicDecisionRecord {
  decision: number;
  turn: number;
  phase: AgentObservation['phase'];
  inputAction: GameAction;
  decisionSummary: string;
  accepted: boolean;
  error: AgentStepResult['error'];
  events: AgentPublicEvent[];
  stateDelta: SessionStateDelta;
  beforePublicHash: string;
  afterPublicHash: string;
  publicPayload: SessionPayloadReference;
  publicPayloadKind: 'snapshot' | 'diff' | 'unchanged';
  previousDecisionHash: string;
  decisionHash: string;
}

export interface SessionAncestorEntry {
  sessionId: string;
  decision: number;
  decisionHash: string;
  previousDecisionHash: string;
  record: SessionPayloadReference;
}
export interface SessionAncestorManifest {
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  rootSessionId: string;
  baseDecision: number;
  baseTraceHeadHash: string;
  basePublicSnapshotHash: string;
  decisionCount: number;
  decisionEntries: SessionPayloadReference;
  ancestorManifestHash: string;
}

export interface SessionRunBase extends SessionLineage {
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  artifactSchemaVersion: string;
  sessionId: string;
  seed: number;
  agentId: string;
  buildId: string;
  publicConfig: JsonValue;
  fixedMap: SessionPayloadReference;
  initialPublicState: SessionPayloadReference;
  initialPublicHash: string;
  runBaseIntegrityHash: string;
}

export type SessionFileReference = SessionPayloadReference;

export interface ActiveCommit {
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  generation: number;
  revision: number;
  decision: number;
  localDecisionCount: number;
  completedTurn: number;
  currentTurn: number;
  phase: AgentObservation['phase'];
  traceHeadHash: string;
  publicDocumentHash: string;
  privateState: SessionPayloadReference;
  publicState: SessionPayloadReference;
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
  privateState: SessionPayloadReference;
  publicState: SessionPayloadReference;
  publicDocumentHash: string;
  publicTraceHeadHash: string;
  createdAt: string;
  metadataIntegrityHash: string;
}

export interface SessionPublicState extends SessionPublicDocument { decision: number; traceHeadHash: string; documentHash: string }

export interface SessionCompactSnapshot {
  apiVersion: string;
  gameRulesVersion: string;
  turn: number;
  phase: AgentObservation['phase'];
  resources: AgentObservation['resources'];
  population: AgentObservation['population'];
  facilities: Array<Pick<AgentObservation['facilities'][number], 'id' | 'type' | 'position' | 'status' | 'owner' | 'healthyPopulation' | 'infectedPopulation' | 'inSupply'>>;
  units: Array<Pick<AgentObservation['units'][number], 'id' | 'type' | 'unitType' | 'position' | 'hp' | 'maxHp' | 'proficiency' | 'attackChargesRemaining' | 'maxAttackCharges' | 'canMove' | 'canAttack' | 'inSupply' | 'currentFuel' | 'maxFuel' | 'currentMilitaryGoods' | 'maxMilitaryGoods' | 'fixedMilitaryGoodsUpkeepPerTurn' | 'attack' | 'baseRecruitAttack' | 'effectiveAttack' | 'movement' | 'effectiveMovementCostAtPosition' | 'baseRange' | 'effectiveRange' | 'rangeModifierReason' | 'emergencyMovementPoints' | 'emergencyMovementAvailable'>>;
  visibleEnemies: AgentObservation['zombies'];
  checkpoints: Array<Pick<AgentObservation['checkpoints'][number], 'id' | 'branchId' | 'position' | 'status' | 'role' | 'waiting' | 'screening' | 'approved' | 'infected' | 'currentPolicy' | 'providesSupply'>>;
  horde: AgentObservation['horde'];
  victory: AgentObservation['victory'];
  crisisSummary: AgentObservation['crisisSummary'];
  endTurnRisk: AgentObservation['endTurnRisk'];
  forecastSummary: Record<string, JsonValue>;
  gameOver: boolean;
  result: AgentGameResult | null;
  availableActionTypes: Array<{ type: string; count: number; targetIds: string[]; modes: string[] }>;
  query: { command: 'query'; revision: number; defaultPageSize: number; maxPageSize: number; targets: SessionQueryTarget[] };
}

export interface SessionStatusResult {
  session: SessionDescriptor;
  active: ActiveCommit;
  revision: number;
  observation: SessionCompactSnapshot;
  gameOver: boolean;
  result: AgentGameResult | null;
  sessionMetrics: SessionMetrics;
}
export interface SessionStepResult extends SessionStatusResult {
  accepted: boolean;
  error: AgentStepResult['error'];
  events: AgentPublicEvent[];
  stateDelta: SessionStateDelta;
  decisionRecord: PublicDecisionRecord;
  checkpointsCreated: SessionCheckpointMetadata[];
}

export interface NewSessionOptions { sessionId?: string; seed?: number; agentId?: string; checkpointInterval?: number }
export interface SessionGameRuntime {
  getApiInfo?(): AgentApiInfo;
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
  restore(options: { privateState: JsonValue; seed: number; agentId: string; sessionId: string; decision: number; traceHeadHash: string }): SessionGameRuntime;
}

export type SessionQueryTarget = 'api' | 'map' | 'units' | 'facilities' | 'checkpoints' | 'branches' | 'construction' | 'legal-actions' | 'forecast' | 'history' | 'full-snapshot';
export interface SessionQueryInput { target: SessionQueryTarget; expectedRevision?: number; cursor?: string; pageSize?: number; filters?: Record<string, JsonValue> }
export interface SessionQueryResult {
  sessionId: string;
  revision: number;
  target: SessionQueryTarget;
  count: number;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  items?: JsonValue[];
  value?: JsonValue;
}

export interface SessionArtifactManifest extends SessionVersionIdentity {
  packageVersion: typeof SESSION_ARTIFACT_PACKAGE_VERSION;
  sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  lineage: SessionLineage;
  branchBase: SessionBranchBase | null;
  decisionCount: number;
  acceptedActionCount: number;
  invalidActionCount: number;
  payloadCount: number;
  artifactPath: string;
  streamHash: string;
  manifestHash: string;
}
/** Explicit compatibility read only; CLI never serializes this whole value. */
export interface SessionArtifact extends Record<string, unknown> { sessionId: string; lineage: SessionLineage; decisionTrace: PublicDecisionRecord[] }

export type SessionDiagnosticEventKind = 'activeSessionResumed' | 'manualCheckpointCreated' | 'periodicCheckpointCreated' | 'finalCheckpointCreated' | 'branchedSessionCreated' | 'hashRejected' | 'versionRejected' | 'buildRejected' | 'corruptionRejected' | 'invalidDecision' | 'inputFormatRejected' | 'staleRevisionRejected';
export interface SessionDiagnosticEvent { sessionSchemaVersion: typeof SESSION_SCHEMA_VERSION; sessionId: string; eventId: string; kind: SessionDiagnosticEventKind; operation: string; recordedAt: string; integrityHash: string }
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
  staleRevisionRejections: number;
  diagnosticIntegrityErrors: number;
}

export type SessionFaultStage = 'after-private-state-write' | 'after-public-state-write' | 'after-decision-write' | 'after-trace-append' | 'before-active-commit' | 'after-checkpoint-private-write' | 'after-checkpoint-public-write' | 'before-checkpoint-metadata';
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
