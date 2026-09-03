import { randomUUID } from 'node:crypto';
import type { GameAction, GameConfig, JsonValue } from '../core/types';
import { cloneAction, cloneJson } from '../agent/action';
import { compactArtifactObservation, restoreArtifactObservation } from '../agent/observation';
import { collectGameMetrics } from '../agent/metrics';
import { HIDDEN_NOISE_METRIC_KEYS, HIDDEN_REJECTED_REFUGEE_METRIC_KEYS } from '../agent/types';
import {
  assertSafeIdentifier,
  canonicalJson,
  decisionHash,
  integrityHash,
  normalizeDecisionSummary,
  sha256Json,
} from './hash';
import { SessionStore, type LoadedSession } from './store';
import {
  CHECKPOINT_SCHEMA_VERSION,
  DEFAULT_CHECKPOINT_INTERVAL,
  SESSION_SCHEMA_VERSION,
  SessionError,
  ZERO_HASH,
  type ActiveCommit,
  type NewSessionOptions,
  type PublicDecisionRecord,
  type SessionArtifact,
  type SessionCheckpointKind,
  type SessionCheckpointMetadata,
  type SessionDescriptor,
  type SessionGameFactory,
  type SessionGameRuntime,
  type SessionLineage,
  type SessionDiagnosticEventKind,
  type SessionMetrics,
  type SessionPublicState,
  type SessionRunBase,
  type SessionStatusResult,
  type SessionStepInput,
  type SessionStepResult,
  type SessionVersionIdentity,
} from './types';

function clone<T>(value: T): T {
  return cloneJson(value as never) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireSafeInteger(value: unknown, name: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new SessionError('invalid_session_option', `${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function newSessionId(): string {
  return `session-${randomUUID()}`;
}

function descriptorWithHash(
  identity: SessionVersionIdentity,
  input: {
    sessionId: string;
    seed: number;
    agentId: string;
    checkpointInterval: number;
    publicConfig: JsonValue;
    lineage: SessionLineage;
  },
): SessionDescriptor {
  const withoutHash = {
    sessionSchemaVersion: SESSION_SCHEMA_VERSION,
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
    ...identity,
    ...input.lineage,
    sessionId: input.sessionId,
    seed: input.seed,
    agentId: input.agentId,
    checkpointInterval: input.checkpointInterval,
    publicConfig: clone(input.publicConfig),
    createdAt: new Date().toISOString(),
  } satisfies Omit<SessionDescriptor, 'descriptorIntegrityHash'>;
  return { ...withoutHash, descriptorIntegrityHash: sha256Json(withoutHash) };
}

function runBaseWithHash(value: Omit<SessionRunBase, 'runBaseIntegrityHash'>): SessionRunBase {
  return { ...value, runBaseIntegrityHash: sha256Json(value) };
}

function publicState(runtime: SessionGameRuntime, decision: number, traceHeadHash: string): SessionPublicState {
  const observation = clone(runtime.getObservation());
  return {
    observation,
    legalActions: runtime.getLegalActions().map(cloneAction),
    gameOver: runtime.isGameOver(),
    result: clone(runtime.getResult()),
    decision,
    traceHeadHash,
  };
}

function statusResult(loaded: LoadedSession, sessionMetrics: SessionMetrics): SessionStatusResult {
  return {
    session: clone(loaded.descriptor),
    active: clone(loaded.active),
    observation: clone(loaded.publicState.observation),
    legalActions: loaded.publicState.legalActions.map(cloneAction),
    gameOver: loaded.publicState.gameOver,
    result: clone(loaded.publicState.result),
    sessionMetrics: clone(sessionMetrics),
  };
}

export class SessionService {
  public constructor(
    public readonly store: SessionStore,
    private readonly gameFactory: SessionGameFactory,
    private readonly identity: SessionVersionIdentity,
  ) {}

  public newSession(options: NewSessionOptions = {}): SessionStatusResult {
    if (!isObject(options)) throw new SessionError('invalid_session_option', 'new options must be a JSON object');
    const sessionId = options.sessionId ?? newSessionId();
    const seed = requireSafeInteger(options.seed ?? 1, 'seed', Number.MIN_SAFE_INTEGER);
    const checkpointInterval = requireSafeInteger(options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL, 'checkpointInterval', 1);
    const agentId = options.agentId ?? 'external-agent';
    assertSafeIdentifier(sessionId, 'sessionId');
    assertSafeIdentifier(agentId, 'agentId');
    const lock = this.store.acquireLock(sessionId);
    try {
      const runtime = this.gameFactory.createNew({ seed, agentId });
      const observation = clone(runtime.getObservation());
      if (observation.map.id !== this.identity.mapId) {
        throw new SessionError('session_version_mismatch', `Runtime map ${observation.map.id} does not match ${this.identity.mapId}`);
      }
      const artifact = runtime.getRunArtifact();
      const publicConfig = clone(artifact.config) as unknown as JsonValue;
      const lineage = { parentSessionId: null, parentCheckpointId: null } satisfies SessionLineage;
      const descriptor = descriptorWithHash(this.identity, {
        sessionId,
        seed,
        agentId,
        checkpointInterval,
        publicConfig,
        lineage,
      });
      const runBase = runBaseWithHash({
        sessionSchemaVersion: SESSION_SCHEMA_VERSION,
        artifactSchemaVersion: this.identity.artifactSchemaVersion,
        sessionId,
        seed,
        agentId,
        buildId: this.identity.buildId,
        publicConfig,
        fixedMap: clone(observation.map),
        initialObservation: compactArtifactObservation(observation),
        ...lineage,
      });
      const active = this.store.create(
        descriptor,
        runBase,
        clone(runtime.exportPrivateState()),
        publicState(runtime, 0, ZERO_HASH),
      );
      const loaded = this.store.load(active.sessionId);
      return statusResult(loaded, this.store.readSessionMetrics(sessionId));
    } finally {
      lock.release();
    }
  }

  public status(sessionId: string): SessionStatusResult {
    try {
      const lock = this.store.acquireExistingLock(sessionId);
      try {
        const loaded = this.loadCompatible(sessionId);
        this.restoreAndVerify(loaded);
        this.ensureAutomaticCheckpoint(loaded);
        this.store.recordDiagnostic(sessionId, 'activeSessionResumed', 'status');
        return statusResult(loaded, this.store.readSessionMetrics(sessionId));
      } finally {
        lock.release();
      }
    } catch (error) {
      return this.rejectWithDiagnostics(sessionId, 'status', error);
    }
  }

  public step(sessionId: string, rawInput: unknown): SessionStepResult {
    try {
      let input: SessionStepInput;
      try {
        input = this.validateStepInput(rawInput);
      } catch (error) {
        this.store.recordDiagnostic(sessionId, 'inputFormatRejected', 'step');
        throw this.withMetricsDetails(sessionId, error);
      }
      const lock = this.store.acquireExistingLock(sessionId);
      try {
        const loaded = this.loadCompatible(sessionId);
        if (loaded.publicState.gameOver) throw new SessionError('game_over', 'The Session is already over');
        const runtime = this.restoreAndVerify(loaded);
        this.ensureAutomaticCheckpoint(loaded);
        const beforeObservation = clone(runtime.getObservation());
        const beforeLegal = runtime.getLegalActions().map(cloneAction);
        const beforePrivate = clone(runtime.exportPrivateState());
        const result = runtime.step(input);
        const accepted = result.error === null;
        const afterPrivate = clone(runtime.exportPrivateState());
        if (!accepted && canonicalJson(beforePrivate) !== canonicalJson(afterPrivate)) {
          throw new SessionError('rejected_action_mutated_state', 'Rejected Action changed Private State or RNG');
        }
        const afterObservation = clone(result.observation);
        const decisionWithoutHash = {
          decision: loaded.active.decision + 1,
          turn: beforeObservation.turn,
          phase: beforeObservation.phase,
          observationBefore: compactArtifactObservation(beforeObservation),
          legalActionsBefore: beforeLegal,
          inputAction: cloneAction(input.action),
          decisionSummary: input.decisionSummary,
          accepted,
          error: clone(result.error),
          events: clone(result.events),
          observationAfter: compactArtifactObservation(afterObservation),
          previousDecisionHash: loaded.active.traceHeadHash,
        } satisfies Omit<PublicDecisionRecord, 'decisionHash'>;
        const record: PublicDecisionRecord = {
          ...decisionWithoutHash,
          decisionHash: decisionHash(decisionWithoutHash),
        };
        const nextPublic = publicState(runtime, record.decision, record.decisionHash);
        if (canonicalJson(nextPublic.observation) !== canonicalJson(afterObservation)) {
          throw new SessionError('runtime_inconsistent', 'Runtime Step observation differs from current Observation');
        }
        const nextActive = this.store.commit({
          descriptor: loaded.descriptor,
          previous: loaded.active,
          privateState: afterPrivate,
          publicState: nextPublic,
          decisionRecord: record,
          acceptedActionCount: loaded.active.acceptedActionCount + (accepted ? 1 : 0),
          invalidActionCount: loaded.active.invalidActionCount + (accepted ? 0 : 1),
        });
        if (!accepted) this.store.recordDiagnostic(sessionId, 'invalidDecision', 'step');
        const committed = this.store.load(sessionId);
        const checkpointsCreated = this.ensureAutomaticCheckpoint(committed);
        return {
          ...statusResult(committed, this.store.readSessionMetrics(sessionId)),
          active: clone(nextActive),
          accepted,
          error: clone(result.error),
          events: clone(result.events),
          decisionRecord: clone(record),
          checkpointsCreated,
        };
      } finally {
        lock.release();
      }
    } catch (error) {
      if (error instanceof SessionError && error.code === 'invalid_step_input' && error.details) throw error;
      return this.rejectWithDiagnostics(sessionId, 'step', error);
    }
  }

  public saveCheckpoint(sessionId: string): SessionCheckpointMetadata {
    try {
      const lock = this.store.acquireExistingLock(sessionId);
      try {
        const loaded = this.loadCompatible(sessionId);
        this.restoreAndVerify(loaded);
        this.ensureAutomaticCheckpoint(loaded);
        return this.createCheckpoint(loaded, 'manual');
      } finally {
        lock.release();
      }
    } catch (error) {
      return this.rejectWithDiagnostics(sessionId, 'save-checkpoint', error);
    }
  }

  public listCheckpoints(sessionId: string): SessionCheckpointMetadata[] {
    try {
      return this.store.listCheckpoints(sessionId).map(clone);
    } catch (error) {
      return this.rejectWithDiagnostics(sessionId, 'list-checkpoints', error);
    }
  }

  public loadCheckpoint(sourceSessionId: string, checkpointId: string, newSessionId: string): SessionStatusResult {
    try {
      assertSafeIdentifier(newSessionId, 'newSessionId');
      const checkpoint = this.store.loadCheckpoint(sourceSessionId, checkpointId);
      this.assertDescriptorCompatible(checkpoint.source.descriptor);
      const lock = this.store.acquireLock(newSessionId);
      try {
        const lineage = {
          parentSessionId: sourceSessionId,
          parentCheckpointId: checkpointId,
        } satisfies SessionLineage;
        const descriptor = descriptorWithHash(this.identity, {
          sessionId: newSessionId,
          seed: checkpoint.source.descriptor.seed,
          agentId: checkpoint.source.descriptor.agentId,
          checkpointInterval: checkpoint.source.descriptor.checkpointInterval,
          publicConfig: checkpoint.source.descriptor.publicConfig,
          lineage,
        });
        const { runBaseIntegrityHash: _parentRunBaseHash, ...parentRunBase } = clone(checkpoint.source.runBase);
        const runBase = runBaseWithHash({
          ...parentRunBase,
          sessionId: newSessionId,
          ...lineage,
        });
        const active = this.store.create(
          descriptor,
          runBase,
          checkpoint.privateState,
          checkpoint.publicState,
          checkpoint.decisions,
        );
        const loaded = this.store.load(active.sessionId);
        this.restoreAndVerify(loaded);
        this.store.recordDiagnostic(sourceSessionId, 'branchedSessionCreated', 'load-checkpoint');
        return statusResult(loaded, this.store.readSessionMetrics(newSessionId));
      } finally {
        lock.release();
      }
    } catch (error) {
      return this.rejectWithDiagnostics(sourceSessionId, 'load-checkpoint', error);
    }
  }

  public artifact(sessionId: string): SessionArtifact {
    try {
      const loaded = this.loadCompatible(sessionId);
      const runtime = this.restoreAndVerify(loaded);
    const live = clone(runtime.getRunArtifact()) as unknown as Record<string, unknown>;
    const accepted = loaded.decisions.filter((record) => record.accepted);
    const rejected = loaded.decisions.filter((record) => !record.accepted);
    const observationTrace = [
      loaded.runBase.initialObservation,
      ...accepted.map((record) => record.observationAfter),
    ];
    const observations = observationTrace.map((observation) => restoreArtifactObservation(observation, loaded.runBase.fixedMap));
    const invalidAttempts = rejected.map((record) => ({
      decision: record.decision,
      action: record.inputAction,
      error: record.error!,
    }));
    const metrics = collectGameMetrics({
      initialObservation: observations[0]!,
      finalObservation: observations.at(-1)!,
      observations,
      actions: accepted.map((record) => record.inputAction),
      events: loaded.decisions.flatMap((record) => record.events),
      result: loaded.publicState.result,
      invalidAttemptCount: rejected.length,
      invalidAttempts,
      totalAgentDecisions: loaded.decisions.length,
      agent: { id: loaded.descriptor.agentId, version: 'external' },
      config: loaded.descriptor.publicConfig as unknown as GameConfig,
      buildId: loaded.descriptor.buildId,
      seed: loaded.descriptor.seed,
      appVersion: loaded.descriptor.appVersion,
      gameRulesVersion: loaded.descriptor.gameRulesVersion,
      agentApiVersion: loaded.descriptor.agentApiVersion,
      observationApiVersion: loaded.descriptor.observationApiVersion,
      bridgeApiVersion: loaded.descriptor.bridgeApiVersion,
    }) as unknown as Record<string, unknown>;
    metrics.config = clone(loaded.descriptor.publicConfig);
    for (const key of HIDDEN_NOISE_METRIC_KEYS) delete metrics[key];
    for (const key of HIDDEN_REJECTED_REFUGEE_METRIC_KEYS) delete metrics[key];
      const sessionMetrics = this.store.readSessionMetrics(sessionId);
      return clone({
      ...live,
      artifactSchemaVersion: loaded.descriptor.artifactSchemaVersion,
      appVersion: loaded.descriptor.appVersion,
      gameRulesVersion: loaded.descriptor.gameRulesVersion,
      agentApiVersion: loaded.descriptor.agentApiVersion,
      observationApiVersion: loaded.descriptor.observationApiVersion,
      bridgeApiVersion: loaded.descriptor.bridgeApiVersion,
      buildId: loaded.descriptor.buildId,
      mapId: loaded.descriptor.mapId,
      seed: loaded.descriptor.seed,
      config: loaded.descriptor.publicConfig,
      agent: { id: loaded.descriptor.agentId },
      sessionId: loaded.descriptor.sessionId,
      lineage: {
        parentSessionId: loaded.descriptor.parentSessionId,
        parentCheckpointId: loaded.descriptor.parentCheckpointId,
      },
      acceptedActions: accepted.map((record) => record.inputAction),
      invalidAttempts,
      decisionTrace: loaded.decisions,
      fixedMap: loaded.runBase.fixedMap,
      observationTrace,
      events: loaded.decisions.flatMap((record) => record.events),
      result: loaded.publicState.result,
      metrics,
        sessionMetrics,
      }) as SessionArtifact;
    } catch (error) {
      return this.rejectWithDiagnostics(sessionId, 'artifact', error);
    }
  }

  private validateStepInput(raw: unknown): SessionStepInput {
    if (!isObject(raw) || Object.keys(raw).some((key) => key !== 'action' && key !== 'decisionSummary')) {
      throw new SessionError('invalid_step_input', 'step input must be an object containing only action and decisionSummary');
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'action') || !Object.prototype.hasOwnProperty.call(raw, 'decisionSummary')) {
      throw new SessionError('invalid_step_input', 'step input requires action and decisionSummary');
    }
    if (!isObject(raw.action)) throw new SessionError('invalid_step_input', 'action must be a JSON object');
    const summary = normalizeDecisionSummary(raw.decisionSummary);
    // Force a detached JSON-compatible value before assigning a Decision number.
    const action = JSON.parse(canonicalJson(raw.action)) as GameAction;
    return { action, decisionSummary: summary };
  }

  private loadCompatible(sessionId: string): LoadedSession {
    const loaded = this.store.load(sessionId);
    this.assertDescriptorCompatible(loaded.descriptor);
    return loaded;
  }

  private assertDescriptorCompatible(descriptor: SessionDescriptor): void {
    for (const field of [
      'gameRulesVersion', 'saveFormatVersion', 'artifactSchemaVersion', 'agentApiVersion',
      'observationApiVersion', 'bridgeApiVersion', 'buildId', 'gitCommit', 'mapId',
    ] as const) {
      if (descriptor[field] !== this.identity[field]) {
        throw new SessionError('session_version_mismatch', `Session ${field} ${String(descriptor[field])} does not match ${String(this.identity[field])}`);
      }
    }
  }

  private restoreAndVerify(loaded: LoadedSession): SessionGameRuntime {
    const runtime = this.gameFactory.restore({
      privateState: clone(loaded.privateState),
      seed: loaded.descriptor.seed,
      agentId: loaded.descriptor.agentId,
      sessionId: loaded.descriptor.sessionId,
      decision: loaded.active.decision,
      traceHeadHash: loaded.active.traceHeadHash,
    });
    const observation = runtime.getObservation();
    const legal = runtime.getLegalActions();
    if (canonicalJson(observation) !== canonicalJson(loaded.publicState.observation)) {
      throw new SessionError('checkpoint_reconstruction_mismatch', 'Restored Observation differs from the committed Public State');
    }
    if (canonicalJson(legal) !== canonicalJson(loaded.publicState.legalActions)) {
      throw new SessionError('checkpoint_reconstruction_mismatch', 'Restored Legal Actions differ from the committed Public State');
    }
    return runtime;
  }

  private ensureAutomaticCheckpoint(loaded: LoadedSession): SessionCheckpointMetadata[] {
    const existing = new Set(this.store.listCheckpoints(loaded.descriptor.sessionId).map((checkpoint) => checkpoint.checkpointId));
    let kind: SessionCheckpointKind | null = null;
    if (loaded.active.gameOver) {
      kind = 'final';
    } else {
      const last = loaded.decisions.at(-1);
      if (
        last?.accepted &&
        last.inputAction.type === 'EndTurn' &&
        loaded.active.phase === 'player' &&
        loaded.active.currentTurn === last.turn + 1 &&
        loaded.active.completedTurn > 0 &&
        loaded.active.completedTurn % loaded.descriptor.checkpointInterval === 0
      ) kind = 'periodic';
    }
    if (!kind) return [];
    const checkpointId = this.checkpointId(loaded, kind);
    return existing.has(checkpointId) ? [] : [this.createCheckpoint(loaded, kind)];
  }

  private createCheckpoint(loaded: LoadedSession, kind: SessionCheckpointKind): SessionCheckpointMetadata {
    const checkpointId = this.checkpointId(loaded, kind);
    const descriptor = loaded.descriptor;
    const checkpoint = this.store.writeCheckpoint(loaded, {
      checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
      sessionSchemaVersion: SESSION_SCHEMA_VERSION,
      appVersion: descriptor.appVersion,
      gameRulesVersion: descriptor.gameRulesVersion,
      saveFormatVersion: descriptor.saveFormatVersion,
      artifactSchemaVersion: descriptor.artifactSchemaVersion,
      agentApiVersion: descriptor.agentApiVersion,
      observationApiVersion: descriptor.observationApiVersion,
      bridgeApiVersion: descriptor.bridgeApiVersion,
      buildId: descriptor.buildId,
      gitCommit: descriptor.gitCommit,
      mapId: descriptor.mapId,
      seed: descriptor.seed,
      sessionId: descriptor.sessionId,
      checkpointId,
      kind,
      parentSessionId: descriptor.parentSessionId,
      parentCheckpointId: descriptor.parentCheckpointId,
      publicConfigHash: sha256Json(descriptor.publicConfig),
      completedTurn: loaded.active.completedTurn,
      currentTurn: loaded.active.currentTurn,
      phase: loaded.active.phase,
      decision: loaded.active.decision,
      publicTraceHeadHash: loaded.active.traceHeadHash,
      createdAt: new Date().toISOString(),
    });
    const metricKind: Record<SessionCheckpointKind, SessionDiagnosticEventKind> = {
      manual: 'manualCheckpointCreated',
      periodic: 'periodicCheckpointCreated',
      final: 'finalCheckpointCreated',
    };
    this.store.recordDiagnostic(loaded.descriptor.sessionId, metricKind[kind], `${kind}-checkpoint`);
    return checkpoint;
  }

  public recordInputFormatRejection(sessionId: string, operation = 'step'): SessionMetrics {
    this.store.recordDiagnostic(sessionId, 'inputFormatRejected', operation);
    return this.store.readSessionMetrics(sessionId);
  }

  private rejectWithDiagnostics<T>(sessionId: string, operation: string, error: unknown): T {
    if (!(error instanceof SessionError)) throw error;
    const message = error.message.toLowerCase();
    let kind: SessionDiagnosticEventKind | null = null;
    if (message.includes('buildid') || message.includes('build id')) kind = 'buildRejected';
    else if (error.code.includes('version_mismatch') || error.code.includes('version_unsupported')) kind = 'versionRejected';
    else if (message.includes('sha-256') || message.includes('hash') || error.code === 'trace_chain_invalid') kind = 'hashRejected';
    else if (error.code.includes('corrupt') || error.code.includes('reconstruction_mismatch')) kind = 'corruptionRejected';
    if (kind) this.store.recordDiagnostic(sessionId, kind, operation);
    throw this.withMetricsDetails(sessionId, error);
  }

  private withMetricsDetails(sessionId: string, error: unknown): SessionError {
    const source = error instanceof SessionError
      ? error
      : new SessionError('session_operation_failed', error instanceof Error ? error.message : String(error));
    const existing = source.details && typeof source.details === 'object' && !Array.isArray(source.details)
      ? source.details as Record<string, JsonValue>
      : {};
    return new SessionError(source.code, source.message, {
      ...existing,
      sessionMetrics: this.store.readSessionMetrics(sessionId) as unknown as JsonValue,
    });
  }

  private checkpointId(loaded: LoadedSession, kind: SessionCheckpointKind): string {
    const turn = String(loaded.active.completedTurn).padStart(3, '0');
    if (kind === 'periodic') return `after-turn-${turn}`;
    const decision = String(loaded.active.decision).padStart(6, '0');
    if (kind === 'final') return `final-turn-${turn}-d${decision}`;
    const prefix = `manual-turn-${turn}-d${decision}-`;
    const next = this.store.listCheckpoints(loaded.descriptor.sessionId)
      .filter((checkpoint) => checkpoint.checkpointId.startsWith(prefix))
      .length + 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }
}
