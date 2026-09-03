import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../core/types';
import {
  asJsonValue,
  assertSafeIdentifier,
  canonicalJson,
  decisionHash,
  hashesEqual,
  integrityHash,
  sha256Json,
  sha256Text,
} from './hash';
import {
  CHECKPOINT_SCHEMA_VERSION,
  SESSION_SCHEMA_VERSION,
  SessionError,
  ZERO_HASH,
  type ActiveCommit,
  type PublicDecisionRecord,
  type SessionCheckpointMetadata,
  type SessionDescriptor,
  type SessionDiagnosticEvent,
  type SessionDiagnosticEventKind,
  type SessionFaultInjector,
  type SessionFileReference,
  type SessionPublicState,
  type SessionRunBase,
  type SessionMetrics,
} from './types';

const COMMIT_FILE_PATTERN = /^g(\d{12})-d(\d{12})-[A-Za-z0-9-]+\.json$/u;
const DECISION_FILE_PATTERN = /^d(\d{12})-([0-9a-f]{64})\.json$/u;
const CHECKPOINT_META_SUFFIX = '.meta.json';

interface LockOwner {
  pid: number;
  host: string;
  token: string;
  acquiredAt: string;
}

export interface LoadedSession {
  directory: string;
  descriptor: SessionDescriptor;
  runBase: SessionRunBase;
  active: ActiveCommit;
  privateState: JsonValue;
  publicState: SessionPublicState;
  decisions: PublicDecisionRecord[];
}

export interface CommitInput {
  descriptor: SessionDescriptor;
  previous: ActiveCommit | null;
  privateState: JsonValue;
  publicState: SessionPublicState;
  decisionRecord?: PublicDecisionRecord;
  acceptedActionCount: number;
  invalidActionCount: number;
  baselineDecision?: number;
  baselineTraceHeadHash?: string;
}

function parseJson<T>(text: string, subject: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new SessionError('session_corrupt', `${subject} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureObject(value: unknown, subject: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionError('session_corrupt', `${subject} must be a JSON object`);
  }
}

function completedTurn(publicState: SessionPublicState): number {
  if (publicState.observation.phase === 'player') return Math.max(0, publicState.observation.turn - 1);
  if (publicState.observation.phase === 'gameOver') return Math.max(0, publicState.observation.turn);
  return Math.max(0, publicState.observation.turn - 1);
}

export class SessionLock {
  private released = false;

  public constructor(
    private readonly lockDirectory: string,
    private readonly archiveDirectory: string,
    private readonly owner: LockOwner,
  ) {}

  public release(): void {
    if (this.released) return;
    const ownerPath = join(this.lockDirectory, 'owner.json');
    const current = parseJson<LockOwner>(readFileSync(ownerPath, 'utf8'), 'session lock owner');
    if (current.token !== this.owner.token) throw new SessionError('lock_owner_changed', 'Session lock ownership changed unexpectedly');
    mkdirSync(this.archiveDirectory, { recursive: true });
    const destination = join(this.archiveDirectory, `released-${Date.now()}-${this.owner.token}`);
    renameSync(this.lockDirectory, destination);
    this.released = true;
  }
}

export class SessionStore {
  public readonly sessionsRoot: string;

  public constructor(
    sessionsRoot: string,
    private readonly faultInjector?: SessionFaultInjector,
  ) {
    this.sessionsRoot = resolve(sessionsRoot);
    mkdirSync(this.sessionsRoot, { recursive: true });
  }

  public sessionDirectory(sessionId: string): string {
    assertSafeIdentifier(sessionId, 'sessionId');
    return join(this.sessionsRoot, sessionId);
  }

  public acquireLock(sessionId: string): SessionLock {
    const directory = this.sessionDirectory(sessionId);
    mkdirSync(directory, { recursive: true });
    const lockDirectory = join(directory, '.active-lock');
    const archiveDirectory = join(directory, '.lock-history');
    const owner: LockOwner = {
      pid: process.pid,
      host: hostname(),
      token: randomUUID(),
      acquiredAt: new Date().toISOString(),
    };
    try {
      mkdirSync(lockDirectory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      const ownerPath = join(lockDirectory, 'owner.json');
      let existing: LockOwner;
      try {
        existing = parseJson<LockOwner>(readFileSync(ownerPath, 'utf8'), 'session lock owner');
      } catch {
        throw new SessionError('session_locked', `Session ${sessionId} has an unreadable lock; it cannot be recovered safely`);
      }
      if (!this.lockOwnerIsDefinitelyDead(existing)) {
        throw new SessionError('session_locked', `Session ${sessionId} is already being updated`, asJsonValue(existing));
      }
      mkdirSync(archiveDirectory, { recursive: true });
      renameSync(lockDirectory, join(archiveDirectory, `stale-${Date.now()}-${existing.token}`));
      try {
        mkdirSync(lockDirectory);
      } catch {
        throw new SessionError('session_locked', `Session ${sessionId} was locked during stale-lock recovery`);
      }
    }
    writeFileSync(join(lockDirectory, 'owner.json'), `${canonicalJson(owner)}\n`, { encoding: 'utf8', flag: 'wx' });
    return new SessionLock(lockDirectory, archiveDirectory, owner);
  }

  public acquireExistingLock(sessionId: string): SessionLock {
    const directory = this.sessionDirectory(sessionId);
    if (!existsSync(join(directory, 'session.json'))) {
      throw new SessionError('session_not_found', `No Session exists at ${directory}`);
    }
    return this.acquireLock(sessionId);
  }

  private lockOwnerIsDefinitelyDead(owner: LockOwner): boolean {
    if (!owner || owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string') return false;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }

  public create(
    descriptor: SessionDescriptor,
    runBase: SessionRunBase,
    privateState: JsonValue,
    publicState: SessionPublicState,
    history: readonly PublicDecisionRecord[] = [],
  ): ActiveCommit {
    const directory = this.sessionDirectory(descriptor.sessionId);
    if (existsSync(join(directory, 'session.json')) || (existsSync(directory) && readdirSync(directory).some((entry) => entry !== '.active-lock'))) {
      throw new SessionError('session_exists', `Refusing to overwrite non-empty Session ${descriptor.sessionId}`);
    }
    mkdirSync(directory, { recursive: true });
    for (const child of ['commits', 'pending', 'private/states', 'public/states', 'public/decisions', 'checkpoints', 'diagnostics']) {
      mkdirSync(join(directory, child), { recursive: true });
    }
    this.writeUniqueJson(join(directory, 'session.json'), descriptor);
    this.writeUniqueJson(join(directory, 'run.partial.json'), runBase);
    writeFileSync(join(directory, 'trace.ndjson'), '', { encoding: 'utf8', flag: 'wx' });
    this.seedDecisionHistory(directory, history);
    const baselineDecision = history.at(-1)?.decision ?? 0;
    const baselineTraceHeadHash = history.at(-1)?.decisionHash ?? ZERO_HASH;
    if (publicState.decision !== baselineDecision || publicState.traceHeadHash !== baselineTraceHeadHash) {
      throw new SessionError('trace_chain_invalid', 'Initial Public State does not match supplied Decision history');
    }
    return this.commit({
      descriptor,
      previous: null,
      privateState,
      publicState,
      acceptedActionCount: history.filter((record) => record.accepted).length,
      invalidActionCount: history.filter((record) => !record.accepted).length,
      baselineDecision,
      baselineTraceHeadHash,
    });
  }

  public load(sessionId: string): LoadedSession {
    const directory = this.sessionDirectory(sessionId);
    const descriptor = this.readDescriptor(directory);
    const runBase = parseJson<SessionRunBase>(readFileSync(join(directory, 'run.partial.json'), 'utf8'), 'run.partial.json');
    ensureObject(runBase, 'run.partial.json');
    if (runBase.sessionId !== descriptor.sessionId || runBase.buildId !== descriptor.buildId) {
      throw new SessionError('session_corrupt', 'run.partial.json does not match session.json');
    }
    const runBaseHash = integrityHash(runBase as unknown as Record<string, unknown>, 'runBaseIntegrityHash');
    if (!hashesEqual(runBaseHash, runBase.runBaseIntegrityHash)) {
      throw new SessionError('session_corrupt', 'run.partial.json integrity hash mismatch');
    }
    const active = this.readLatestCommit(directory, descriptor);
    const privateText = this.readReferencedFile(directory, active.privateState, 'Private State');
    const publicText = this.readReferencedFile(directory, active.publicState, 'Public State');
    const privateState = parseJson<JsonValue>(privateText, 'Private State');
    const publicState = parseJson<SessionPublicState>(publicText, 'Public State');
    this.validatePublicState(publicState, active);
    const decisions = this.readCommittedDecisions(directory, active);
    this.validateTraceMirror(directory, decisions);
    return { directory, descriptor, runBase, active, privateState, publicState, decisions };
  }

  public commit(input: CommitInput): ActiveCommit {
    const directory = this.sessionDirectory(input.descriptor.sessionId);
    const generation = (input.previous?.generation ?? -1) + 1;
    const decision = input.decisionRecord?.decision ?? input.previous?.decision ?? input.baselineDecision ?? 0;
    const traceHeadHash = input.decisionRecord?.decisionHash ?? input.previous?.traceHeadHash ?? input.baselineTraceHeadHash ?? ZERO_HASH;
    if (input.decisionRecord) {
      if (input.decisionRecord.previousDecisionHash !== (input.previous?.traceHeadHash ?? ZERO_HASH)) {
        throw new SessionError('trace_chain_invalid', 'Decision previous hash does not match the Active trace head');
      }
      const expected = decisionHash(({ ...input.decisionRecord, decisionHash: undefined }) as never);
      if (!hashesEqual(expected, input.decisionRecord.decisionHash)) {
        throw new SessionError('trace_chain_invalid', 'Decision hash is invalid');
      }
    }

    const privateText = `${canonicalJson(input.privateState)}\n`;
    const privateReference = this.writeGenerationPayload(
      directory,
      `private/states/g${this.pad(generation)}-${randomUUID()}.state.nlth`,
      privateText,
    );
    this.faultInjector?.('after-private-state-write');
    const publicText = `${canonicalJson(input.publicState)}\n`;
    const publicReference = this.writeGenerationPayload(
      directory,
      `public/states/g${this.pad(generation)}-${randomUUID()}.public.json`,
      publicText,
    );
    this.faultInjector?.('after-public-state-write');

    if (input.decisionRecord) {
      const decisionPath = join(
        directory,
        'public/decisions',
        `d${this.pad(input.decisionRecord.decision)}-${input.decisionRecord.decisionHash}.json`,
      );
      const decisionText = `${canonicalJson(input.decisionRecord)}\n`;
      if (existsSync(decisionPath)) {
        if (readFileSync(decisionPath, 'utf8') !== decisionText) {
          throw new SessionError('trace_chain_invalid', 'Existing orphan Decision payload differs from the retry');
        }
      } else {
        this.writeUniqueText(decisionPath, decisionText);
      }
      this.faultInjector?.('after-decision-write');
      const traceLine = `${canonicalJson(input.decisionRecord)}\n`;
      const traceFd = openSync(join(directory, 'trace.ndjson'), 'a');
      try {
        appendFileSync(traceFd, traceLine, 'utf8');
        fsyncSync(traceFd);
      } finally {
        closeSync(traceFd);
      }
      this.faultInjector?.('after-trace-append');
    }

    const commitWithoutHash = {
      sessionSchemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: input.descriptor.sessionId,
      generation,
      decision,
      completedTurn: completedTurn(input.publicState),
      currentTurn: input.publicState.observation.turn,
      phase: input.publicState.observation.phase,
      traceHeadHash,
      privateState: privateReference,
      publicState: publicReference,
      gameOver: input.publicState.gameOver,
      result: clone(input.publicState.result),
      acceptedActionCount: input.acceptedActionCount,
      invalidActionCount: input.invalidActionCount,
      committedAt: new Date().toISOString(),
    } satisfies Omit<ActiveCommit, 'commitIntegrityHash'>;
    const commit: ActiveCommit = {
      ...commitWithoutHash,
      commitIntegrityHash: sha256Json(commitWithoutHash),
    };
    this.faultInjector?.('before-active-commit');
    const commitName = `g${this.pad(generation)}-d${this.pad(decision)}-${randomUUID()}.json`;
    this.writeUniqueJson(join(directory, 'commits', commitName), commit);
    return clone(commit);
  }

  public writeCheckpoint(
    loaded: LoadedSession,
    metadataWithoutHashes: Omit<SessionCheckpointMetadata, 'privateState' | 'publicState' | 'metadataIntegrityHash'>,
  ): SessionCheckpointMetadata {
    assertSafeIdentifier(metadataWithoutHashes.checkpointId, 'checkpointId');
    const base = join(loaded.directory, 'checkpoints', metadataWithoutHashes.checkpointId);
    const metadataPath = `${base}${CHECKPOINT_META_SUFFIX}`;
    if (existsSync(metadataPath)) throw new SessionError('checkpoint_exists', `Checkpoint ${metadataWithoutHashes.checkpointId} already exists`);
    const privateText = this.readReferencedFile(loaded.directory, loaded.active.privateState, 'Active Private State');
    const privateReference = this.writeGenerationPayload(
      loaded.directory,
      `checkpoints/${metadataWithoutHashes.checkpointId}-${randomUUID()}.state.nlth`,
      privateText,
    );
    this.faultInjector?.('after-checkpoint-private-write');
    const publicText = this.readReferencedFile(loaded.directory, loaded.active.publicState, 'Active Public State');
    const publicReference = this.writeGenerationPayload(
      loaded.directory,
      `checkpoints/${metadataWithoutHashes.checkpointId}-${randomUUID()}.public.json`,
      publicText,
    );
    this.faultInjector?.('after-checkpoint-public-write');
    const withoutIntegrity = {
      ...metadataWithoutHashes,
      privateState: privateReference,
      publicState: publicReference,
    } satisfies Omit<SessionCheckpointMetadata, 'metadataIntegrityHash'>;
    const metadata: SessionCheckpointMetadata = {
      ...withoutIntegrity,
      metadataIntegrityHash: sha256Json(withoutIntegrity),
    };
    this.faultInjector?.('before-checkpoint-metadata');
    this.writeUniqueJson(metadataPath, metadata);
    return clone(metadata);
  }

  public listCheckpoints(sessionId: string): SessionCheckpointMetadata[] {
    const directory = this.sessionDirectory(sessionId);
    const descriptor = this.readDescriptor(directory);
    const checkpointDirectory = join(directory, 'checkpoints');
    return readdirSync(checkpointDirectory)
      .filter((name) => name.endsWith(CHECKPOINT_META_SUFFIX))
      .map((name) => this.readCheckpointMetadata(directory, descriptor, join(checkpointDirectory, name)))
      .sort((left, right) => left.decision - right.decision || left.checkpointId.localeCompare(right.checkpointId));
  }

  public loadCheckpoint(sessionId: string, checkpointId: string): {
    source: LoadedSession;
    metadata: SessionCheckpointMetadata;
    privateState: JsonValue;
    publicState: SessionPublicState;
    decisions: PublicDecisionRecord[];
  } {
    assertSafeIdentifier(checkpointId, 'checkpointId');
    const directory = this.sessionDirectory(sessionId);
    const descriptor = this.readDescriptor(directory);
    const runBase = parseJson<SessionRunBase>(readFileSync(join(directory, 'run.partial.json'), 'utf8'), 'run.partial.json');
    const metadata = this.readCheckpointMetadata(
      directory,
      descriptor,
      join(directory, 'checkpoints', `${checkpointId}${CHECKPOINT_META_SUFFIX}`),
    );
    const privateState = parseJson<JsonValue>(
      this.readReferencedFile(directory, metadata.privateState, 'Checkpoint Private State'),
      'Checkpoint Private State',
    );
    const publicState = parseJson<SessionPublicState>(
      this.readReferencedFile(directory, metadata.publicState, 'Checkpoint Public State'),
      'Checkpoint Public State',
    );
    const pseudoActive = {
      decision: metadata.decision,
      traceHeadHash: metadata.publicTraceHeadHash,
    } as ActiveCommit;
    const decisions = this.readCommittedDecisions(directory, pseudoActive);
    const head = decisions.at(-1)?.decisionHash ?? ZERO_HASH;
    if (head !== metadata.publicTraceHeadHash) throw new SessionError('checkpoint_corrupt', 'Checkpoint trace head does not match its public history');
    const source = {
      directory,
      descriptor,
      runBase,
      active: pseudoActive,
      privateState,
      publicState,
      decisions,
    };
    return { source, metadata, privateState, publicState, decisions };
  }

  public seedDecisionHistory(directory: string, decisions: readonly PublicDecisionRecord[]): void {
    const tracePath = join(directory, 'trace.ndjson');
    for (const record of decisions) {
      this.writeUniqueJson(
        join(directory, 'public/decisions', `d${this.pad(record.decision)}-${record.decisionHash}.json`),
        record,
      );
      appendFileSync(tracePath, `${canonicalJson(record)}\n`, 'utf8');
    }
  }

  public recordDiagnostic(sessionId: string, kind: SessionDiagnosticEventKind, operation: string): void {
    const directory = this.sessionDirectory(sessionId);
    if (!existsSync(join(directory, 'session.json'))) return;
    const eventId = randomUUID();
    const withoutHash = {
      sessionSchemaVersion: SESSION_SCHEMA_VERSION,
      sessionId,
      eventId,
      kind,
      operation,
      recordedAt: new Date().toISOString(),
    } satisfies Omit<SessionDiagnosticEvent, 'integrityHash'>;
    const event: SessionDiagnosticEvent = { ...withoutHash, integrityHash: sha256Json(withoutHash) };
    this.writeUniqueJson(join(directory, 'diagnostics', `${eventId}.json`), event);
  }

  public readSessionMetrics(sessionId: string): SessionMetrics {
    const directory = this.sessionDirectory(sessionId);
    const metrics: SessionMetrics = {
      activeSessionResumes: 0,
      manualCheckpointsCreated: 0,
      periodicCheckpointsCreated: 0,
      finalCheckpointsCreated: 0,
      branchedSessionsCreated: 0,
      hashRejections: 0,
      versionRejections: 0,
      buildRejections: 0,
      corruptionRejections: 0,
      invalidDecisions: 0,
      inputFormatRejections: 0,
      diagnosticIntegrityErrors: 0,
    };
    const diagnosticDirectory = join(directory, 'diagnostics');
    if (!existsSync(diagnosticDirectory)) return metrics;
    const fieldByKind: Record<SessionDiagnosticEventKind, keyof SessionMetrics> = {
      activeSessionResumed: 'activeSessionResumes',
      manualCheckpointCreated: 'manualCheckpointsCreated',
      periodicCheckpointCreated: 'periodicCheckpointsCreated',
      finalCheckpointCreated: 'finalCheckpointsCreated',
      branchedSessionCreated: 'branchedSessionsCreated',
      hashRejected: 'hashRejections',
      versionRejected: 'versionRejections',
      buildRejected: 'buildRejections',
      corruptionRejected: 'corruptionRejections',
      invalidDecision: 'invalidDecisions',
      inputFormatRejected: 'inputFormatRejections',
    };
    for (const name of readdirSync(diagnosticDirectory).filter((candidate) => candidate.endsWith('.json'))) {
      try {
        const event = parseJson<SessionDiagnosticEvent>(readFileSync(join(diagnosticDirectory, name), 'utf8'), `Diagnostic ${name}`);
        ensureObject(event, `Diagnostic ${name}`);
        const expected = integrityHash(event as unknown as Record<string, unknown>, 'integrityHash');
        if (
          event.sessionSchemaVersion !== SESSION_SCHEMA_VERSION ||
          event.sessionId !== sessionId ||
          !hashesEqual(expected, event.integrityHash) ||
          !(event.kind in fieldByKind)
        ) {
          metrics.diagnosticIntegrityErrors += 1;
          continue;
        }
        const field = fieldByKind[event.kind];
        metrics[field] += 1;
      } catch {
        metrics.diagnosticIntegrityErrors += 1;
      }
    }
    return metrics;
  }

  private readDescriptor(directory: string): SessionDescriptor {
    const descriptorPath = join(directory, 'session.json');
    if (!existsSync(descriptorPath)) throw new SessionError('session_not_found', `No Session exists at ${directory}`);
    const descriptor = parseJson<SessionDescriptor>(readFileSync(descriptorPath, 'utf8'), 'session.json');
    ensureObject(descriptor, 'session.json');
    if (descriptor.sessionSchemaVersion !== SESSION_SCHEMA_VERSION || descriptor.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
      throw new SessionError('session_version_mismatch', 'Session or Checkpoint Schema Version is unsupported');
    }
    assertSafeIdentifier(descriptor.sessionId, 'sessionId');
    const expected = integrityHash(descriptor as unknown as Record<string, unknown>, 'descriptorIntegrityHash');
    if (!hashesEqual(expected, descriptor.descriptorIntegrityHash)) throw new SessionError('session_corrupt', 'session.json integrity hash mismatch');
    return descriptor;
  }

  private readLatestCommit(directory: string, descriptor: SessionDescriptor): ActiveCommit {
    const candidates = readdirSync(join(directory, 'commits'))
      .map((name) => ({ name, match: COMMIT_FILE_PATTERN.exec(name) }))
      .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
      .sort((left, right) => Number(right.match[1]) - Number(left.match[1]));
    if (candidates.length === 0) throw new SessionError('session_corrupt', 'Session has no committed Active generation');
    let latestCommit: ActiveCommit | null = null;
    for (const [index, candidate] of candidates.entries()) {
      const commit = parseJson<ActiveCommit>(readFileSync(join(directory, 'commits', candidate.name), 'utf8'), 'Active commit');
      ensureObject(commit, 'Active commit');
      if (
        commit.sessionId !== descriptor.sessionId ||
        commit.sessionSchemaVersion !== SESSION_SCHEMA_VERSION ||
        commit.generation !== Number(candidate.match[1]) ||
        commit.decision !== Number(candidate.match[2])
      ) {
        throw new SessionError('session_corrupt', 'Active commit does not match Session or its file name');
      }
      const expected = integrityHash(commit as unknown as Record<string, unknown>, 'commitIntegrityHash');
      if (!hashesEqual(expected, commit.commitIntegrityHash)) throw new SessionError('session_corrupt', 'Active commit integrity hash mismatch');
      if (index === 0) latestCommit = commit;
    }
    return latestCommit!;
  }

  private readCommittedDecisions(directory: string, active: ActiveCommit): PublicDecisionRecord[] {
    if (active.decision === 0) {
      if (active.traceHeadHash !== ZERO_HASH) throw new SessionError('trace_chain_invalid', 'Empty trace must use the zero hash');
      return [];
    }
    const byHash = new Map<string, PublicDecisionRecord>();
    for (const name of readdirSync(join(directory, 'public/decisions'))) {
      const match = DECISION_FILE_PATTERN.exec(name);
      if (!match) continue;
      const record = parseJson<PublicDecisionRecord>(readFileSync(join(directory, 'public/decisions', name), 'utf8'), `Decision ${name}`);
      ensureObject(record, `Decision ${name}`);
      const expected = decisionHash(({ ...record, decisionHash: undefined }) as never);
      if (record.decisionHash !== match[2] || !hashesEqual(expected, record.decisionHash)) {
        throw new SessionError('trace_chain_invalid', `Decision ${name} hash mismatch`);
      }
      byHash.set(record.decisionHash, record);
    }
    const reversed: PublicDecisionRecord[] = [];
    let head = active.traceHeadHash;
    for (let expectedDecision = active.decision; expectedDecision >= 1; expectedDecision -= 1) {
      const record = byHash.get(head);
      if (!record || record.decision !== expectedDecision) throw new SessionError('trace_chain_invalid', `Decision chain is missing Decision ${expectedDecision}`);
      reversed.push(record);
      head = record.previousDecisionHash;
    }
    if (head !== ZERO_HASH) throw new SessionError('trace_chain_invalid', 'Decision chain does not terminate at the zero hash');
    return reversed.reverse();
  }

  private validateTraceMirror(directory: string, decisions: readonly PublicDecisionRecord[]): void {
    const path = join(directory, 'trace.ndjson');
    if (!existsSync(path)) throw new SessionError('trace_chain_invalid', 'trace.ndjson is missing');
    const lines = readFileSync(path, 'utf8').split(/\r?\n/u).filter((line) => line.length > 0);
    let searchStart = 0;
    for (const expected of decisions) {
      const canonical = canonicalJson(expected);
      const index = lines.indexOf(canonical, searchStart);
      if (index < 0) throw new SessionError('trace_chain_invalid', `trace.ndjson is missing committed Decision ${expected.decision}`);
      searchStart = index + 1;
    }
  }

  private validatePublicState(publicState: SessionPublicState, active: ActiveCommit): void {
    ensureObject(publicState, 'Public State');
    if (publicState.decision !== active.decision || publicState.traceHeadHash !== active.traceHeadHash) {
      throw new SessionError('session_corrupt', 'Public State does not match Active commit');
    }
    if (publicState.observation.turn !== active.currentTurn || publicState.observation.phase !== active.phase) {
      throw new SessionError('session_corrupt', 'Public Observation does not match Active metadata');
    }
  }

  private readCheckpointMetadata(directory: string, descriptor: SessionDescriptor, path: string): SessionCheckpointMetadata {
    if (!existsSync(path)) throw new SessionError('checkpoint_not_found', `Checkpoint metadata not found: ${path}`);
    const metadata = parseJson<SessionCheckpointMetadata>(readFileSync(path, 'utf8'), 'Checkpoint metadata');
    ensureObject(metadata, 'Checkpoint metadata');
    if (
      metadata.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION
      || metadata.sessionSchemaVersion !== SESSION_SCHEMA_VERSION
    ) {
      throw new SessionError('checkpoint_version_mismatch', 'Checkpoint or Session Schema Version is unsupported');
    }
    if (metadata.sessionId !== descriptor.sessionId) {
      throw new SessionError('checkpoint_corrupt', 'Checkpoint metadata does not match Session');
    }
    const expected = integrityHash(metadata as unknown as Record<string, unknown>, 'metadataIntegrityHash');
    if (!hashesEqual(expected, metadata.metadataIntegrityHash)) throw new SessionError('checkpoint_corrupt', 'Checkpoint metadata integrity hash mismatch');
    this.assertCheckpointIdentity(metadata, descriptor);
    this.readReferencedFile(directory, metadata.privateState, 'Checkpoint Private State');
    this.readReferencedFile(directory, metadata.publicState, 'Checkpoint Public State');
    return metadata;
  }

  private assertCheckpointIdentity(metadata: SessionCheckpointMetadata, descriptor: SessionDescriptor): void {
    for (const field of [
      'appVersion', 'gameRulesVersion', 'saveFormatVersion', 'artifactSchemaVersion', 'agentApiVersion',
      'observationApiVersion', 'bridgeApiVersion', 'buildId', 'gitCommit', 'mapId', 'seed',
    ] as const) {
      if (metadata[field] !== descriptor[field]) throw new SessionError('checkpoint_version_mismatch', `Checkpoint ${field} does not match Session`);
    }
    if (metadata.publicConfigHash !== sha256Json(descriptor.publicConfig)) {
      throw new SessionError('checkpoint_version_mismatch', 'Checkpoint Public Config does not match Session');
    }
  }

  private readReferencedFile(directory: string, reference: SessionFileReference, subject: string): string {
    ensureObject(reference, `${subject} reference`);
    const path = this.resolveRelative(directory, reference.relativePath);
    if (!existsSync(path) || !statSync(path).isFile()) throw new SessionError('session_corrupt', `${subject} payload is missing`);
    const text = readFileSync(path, 'utf8');
    if (!hashesEqual(sha256Text(text), reference.sha256)) throw new SessionError('session_corrupt', `${subject} SHA-256 mismatch`);
    return text;
  }

  private resolveRelative(directory: string, relativePath: string): string {
    if (typeof relativePath !== 'string' || isAbsolute(relativePath)) throw new SessionError('session_corrupt', 'Session file reference must be relative');
    const path = resolve(directory, relativePath);
    const rel = relative(directory, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new SessionError('session_corrupt', 'Session file reference escaped its Session directory');
    return path;
  }

  private writeGenerationPayload(directory: string, relativePath: string, text: string): SessionFileReference {
    const path = this.resolveRelative(directory, relativePath);
    this.writeUniqueText(path, text);
    return { relativePath: relativePath.replaceAll('\\', '/'), sha256: sha256Text(text) };
  }

  private writeUniqueJson(path: string, value: unknown): void {
    this.writeUniqueText(path, `${canonicalJson(value)}\n`);
  }

  private writeUniqueText(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) throw new SessionError('refusing_overwrite', `Refusing to overwrite ${path}`);
    const pendingDirectory = join(dirname(path), '.pending');
    mkdirSync(pendingDirectory, { recursive: true });
    const pending = join(pendingDirectory, `${randomUUID()}.tmp`);
    const fd = openSync(pending, 'wx');
    try {
      writeFileSync(fd, text, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(pending, path);
  }

  private pad(value: number): string {
    if (!Number.isSafeInteger(value) || value < 0 || value > 999_999_999_999) throw new SessionError('session_limit', 'Session counter is out of range');
    return String(value).padStart(12, '0');
  }
}
