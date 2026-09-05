import { createHash, randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { GameAction, GameConfig, JsonValue } from '../core/types';
import { cloneAction, cloneJson } from '../agent/action';
import { createGameMetricsAccumulator } from '../agent/metrics-stream';
import { ObservationHistory, lazyArray } from '../agent/history';
import { compactArtifactObservation, restoreArtifactObservation } from '../agent/observation';
import type { AgentMapObservation, AgentObservation, AgentPublicEvent } from '../agent/types';
import { HIDDEN_NOISE_METRIC_KEYS, HIDDEN_REJECTED_REFUGEE_METRIC_KEYS } from '../agent/types';
import { applyLosslessJsonDiff, createLosslessJsonDiff } from './public-diff';
import { assertSafeInputFile, assertSafeOutputPath, createSafePathRoot, ensureSafeOutputDirectory, type SafePathRoot } from './safe-path';
import { assertSafeIdentifier, canonicalJson, decisionHash, hashesEqual, integrityHash, normalizeDecisionSummary, sha256Bytes, sha256Json } from './hash';
import { SessionStore, type LoadedSession } from './store';
import {
  CHECKPOINT_SCHEMA_VERSION,
  DEFAULT_CHECKPOINT_INTERVAL,
  DEFAULT_QUERY_PAGE_SIZE,
  MAX_QUERY_PAGE_SIZE,
  PUBLIC_SNAPSHOT_INTERVAL,
  SESSION_ARTIFACT_PACKAGE_VERSION,
  SESSION_SCHEMA_VERSION,
  SessionError,
  ZERO_HASH,
  type ActiveCommit,
  type NewSessionOptions,
  type PublicDecisionRecord,
  type SessionArtifact,
  type SessionArtifactManifest,
  type SessionBranchBase,
  type SessionCheckpointKind,
  type SessionCheckpointMetadata,
  type SessionCompactSnapshot,
  type SessionDescriptor,
  type SessionDiagnosticEventKind,
  type SessionGameFactory,
  type SessionGameRuntime,
  type SessionLineage,
  type SessionMetrics,
  type SessionPayloadReference,
  type SessionPublicDiffPayload,
  type SessionPublicDocument,
  type SessionPublicSnapshotPayload,
  type SessionPublicState,
  type SessionQueryInput,
  type SessionQueryResult,
  type SessionQueryTarget,
  type SessionRunBase,
  type SessionStateDelta,
  type SessionStatusResult,
  type SessionStepInput,
  type SessionStepResult,
  type SessionVersionIdentity,
} from './types';

const QUERY_TARGETS: SessionQueryTarget[] = ['api', 'map', 'units', 'facilities', 'checkpoints', 'branches', 'construction', 'legal-actions', 'forecast', 'history', 'full-snapshot'];
const ARTIFACT_CHUNK_BYTES = 1024 * 1024;
const MAX_ARTIFACT_PAYLOAD_BYTES = 256 * 1024 * 1024;

function clone<T>(value: T): T { return cloneJson(value as never) as T; }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requireSafeInteger(value: unknown, name: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new SessionError('invalid_session_option', `${name} must be a safe integer >= ${minimum}`);
  return value;
}
function newSessionId(): string { return `session-${randomUUID()}`; }

function descriptorWithHash(identity: SessionVersionIdentity, storeId: string, input: { sessionId: string; seed: number; agentId: string; checkpointInterval: number; publicConfig: JsonValue; lineage: SessionLineage; branchBase: SessionBranchBase | null }): SessionDescriptor {
  const withoutHash = { sessionSchemaVersion: SESSION_SCHEMA_VERSION, checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION, ...identity, ...input.lineage, sessionId: input.sessionId, storeId, branchBase: input.branchBase, seed: input.seed, agentId: input.agentId, checkpointInterval: input.checkpointInterval, publicConfig: clone(input.publicConfig), createdAt: new Date().toISOString() } satisfies Omit<SessionDescriptor, 'descriptorIntegrityHash'>;
  return { ...withoutHash, descriptorIntegrityHash: sha256Json(withoutHash) };
}

function runBaseWithHash(value: Omit<SessionRunBase, 'runBaseIntegrityHash'>): SessionRunBase { return { ...value, runBaseIntegrityHash: sha256Json(value) }; }

function traceObservation(observation: AgentObservation): SessionPublicDocument['observation'] {
  return compactArtifactObservation(observation) as SessionPublicDocument['observation'];
}
function publicDocument(runtime: SessionGameRuntime): SessionPublicDocument {
  return { observation: traceObservation(clone(runtime.getObservation())), legalActions: runtime.getLegalActions().map(cloneAction), gameOver: runtime.isGameOver(), result: clone(runtime.getResult()) };
}
function publicState(runtime: SessionGameRuntime, decision: number, traceHeadHash: string): SessionPublicState {
  const document = publicDocument(runtime);
  return { ...document, decision, traceHeadHash, documentHash: sha256Json(document) };
}

function actionTargetIds(action: GameAction): string[] {
  const record = action as unknown as Record<string, unknown>;
  return ['unitId', 'targetUnitId', 'facilityId', 'checkpointId', 'branchId', 'sourceFacilityId', 'destinationFacilityId'].flatMap((key) => typeof record[key] === 'string' ? [record[key] as string] : []);
}

function forecastSummary(observation: SessionPublicDocument['observation']): Record<string, JsonValue> {
  const summarize = (value: unknown): JsonValue => {
    if (Array.isArray(value)) return { count: value.length };
    if (!isObject(value)) return (value ?? null) as JsonValue;
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'number' || typeof child === 'boolean' || typeof child === 'string' || child === null) result[key] = child;
      else if (isObject(child) || Array.isArray(child)) {
        const nested = summarize(child);
        if (isObject(nested) && Object.keys(nested).length > 0) result[key] = nested;
      }
    }
    return result;
  };
  return { endTurn: summarize(observation.endTurnForecast), strategic: summarize(observation.strategicForecast) };
}

function compactSnapshot(loaded: LoadedSession): SessionCompactSnapshot {
  const observation = loaded.publicState.observation;
  const actionGroups = new Map<string, { count: number; ids: Set<string>; modes: Set<string> }>();
  for (const action of loaded.publicState.legalActions) {
    const group = actionGroups.get(action.type) ?? { count: 0, ids: new Set<string>(), modes: new Set<string>() };
    group.count += 1;
    actionTargetIds(action).forEach((id) => group.ids.add(id));
    const mode = (action as unknown as Record<string, unknown>).movementMode;
    if (typeof mode === 'string') group.modes.add(mode);
    actionGroups.set(action.type, group);
  }
  return {
    apiVersion: observation.apiVersion,
    gameRulesVersion: observation.gameRulesVersion,
    turn: observation.turn,
    phase: observation.phase,
    resources: clone(observation.resources),
    population: clone(observation.population),
    facilities: observation.facilities.map(({ id, type, position, status, owner, healthyPopulation, infectedPopulation, inSupply }) => ({ id, type, position, status, owner, healthyPopulation, infectedPopulation, inSupply })),
    units: observation.units.map(({ id, type, unitType, position, hp, maxHp, proficiency, attackChargesRemaining, maxAttackCharges, canMove, canAttack, inSupply, currentFuel, maxFuel, currentMilitaryGoods, maxMilitaryGoods, fixedMilitaryGoodsUpkeepPerTurn, attack, baseRecruitAttack, effectiveAttack, movement, effectiveMovementCostAtPosition, baseRange, effectiveRange, rangeModifierReason, emergencyMovementPoints, emergencyMovementAvailable }) => ({ id, type, unitType, position, hp, maxHp, proficiency, attackChargesRemaining, maxAttackCharges, canMove, canAttack, inSupply, currentFuel, maxFuel, currentMilitaryGoods, maxMilitaryGoods, fixedMilitaryGoodsUpkeepPerTurn, attack, baseRecruitAttack, effectiveAttack, movement, effectiveMovementCostAtPosition, baseRange, effectiveRange, rangeModifierReason, emergencyMovementPoints, emergencyMovementAvailable })),
    visibleEnemies: clone(observation.zombies),
    checkpoints: observation.checkpoints.map(({ id, branchId, position, status, role, waiting, screening, approved, infected, currentPolicy, providesSupply }) => ({ id, branchId, position, status, role, waiting, screening, approved, infected, currentPolicy, providesSupply })),
    horde: clone(observation.horde),
    victory: clone(observation.victory),
    crisisSummary: clone(observation.crisisSummary),
    endTurnRisk: clone(observation.endTurnRisk),
    forecastSummary: forecastSummary(observation),
    gameOver: observation.gameOver,
    result: clone(observation.result),
    availableActionTypes: [...actionGroups].sort(([a], [b]) => a.localeCompare(b)).map(([type, value]) => ({ type, count: value.count, targetIds: [...value.ids].sort(), modes: [...value.modes].sort() })),
    query: { command: 'query', revision: loaded.active.revision, defaultPageSize: DEFAULT_QUERY_PAGE_SIZE, maxPageSize: MAX_QUERY_PAGE_SIZE, targets: QUERY_TARGETS },
  };
}

function metricsMetadata(descriptor: SessionDescriptor) {
  return {
    agent: { id: descriptor.agentId, version: 'external' },
    config: clone(descriptor.publicConfig) as unknown as GameConfig,
    buildId: descriptor.buildId,
    seed: descriptor.seed,
    appVersion: descriptor.appVersion,
    gameRulesVersion: descriptor.gameRulesVersion,
    agentApiVersion: descriptor.agentApiVersion,
    observationApiVersion: descriptor.observationApiVersion,
    bridgeApiVersion: descriptor.bridgeApiVersion,
  };
}

function publicMetrics<T extends Record<string, unknown>>(metrics: T): T {
  for (const key of HIDDEN_NOISE_METRIC_KEYS) delete metrics[key];
  for (const key of HIDDEN_REJECTED_REFUGEE_METRIC_KEYS) delete metrics[key];
  return metrics;
}

export interface SessionServiceOptions {
  /** Test/validation override; production keeps the Schema 4 interval of 50. */
  publicSnapshotInterval?: number;
}

function statusResult(loaded: LoadedSession, sessionMetrics: SessionMetrics): SessionStatusResult {
  return { session: clone(loaded.descriptor), active: clone(loaded.active), revision: loaded.active.revision, observation: compactSnapshot(loaded), gameOver: loaded.publicState.gameOver, result: clone(loaded.publicState.result), sessionMetrics: clone(sessionMetrics) };
}

function sortedUnique(values: Iterable<string>): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function siteRecords(observation: AgentObservation): Array<{ id: string; infected: number; status: string }> {
  return [...observation.facilities.map((facility) => ({ id: facility.id, infected: facility.infectedPopulation, status: facility.status })), ...observation.checkpoints.map((checkpoint) => ({ id: checkpoint.id, infected: checkpoint.infected, status: checkpoint.status }))];
}

export function deriveSessionStateDelta(before: AgentObservation, after: AgentObservation, events: readonly AgentPublicEvent[] = []): SessionStateDelta {
  const beforeSites = new Map(siteRecords(before).map((site) => [site.id, site] as const));
  const afterSites = new Map(siteRecords(after).map((site) => [site.id, site] as const));
  const beforeEnemyIds = new Set(before.zombies.map((unit) => unit.id));
  const afterEnemyIds = new Set(after.zombies.map((unit) => unit.id));
  const publicLostEnemyIds = events.filter((event) => event.type === 'enemy_lost' || event.type === 'unit_destroyed').flatMap((event) => {
    const payload = event.payload as Record<string, unknown>;
    const candidate = [payload.zombieId, payload.unitId, payload.id].find((value): value is string => typeof value === 'string');
    return candidate ? [candidate] : [];
  });
  const beforeUnits = new Map(before.units.map((unit) => [unit.id, unit] as const));
  const afterUnits = new Map(after.units.map((unit) => [unit.id, unit] as const));
  const beforeCheckpoints = new Map(before.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint] as const));
  return {
    newlyInfectedSites: sortedUnique([...afterSites.values()].filter((site) => site.infected > 0 && (beforeSites.get(site.id)?.infected ?? 0) <= 0).map((site) => site.id)),
    newlyRuinedSites: sortedUnique([...afterSites.values()].filter((site) => ['ruined', 'abandoned'].includes(site.status) && !['ruined', 'abandoned'].includes(beforeSites.get(site.id)?.status ?? '')).map((site) => site.id)),
    newlySpottedEnemies: sortedUnique([...afterEnemyIds].filter((id) => !beforeEnemyIds.has(id))),
    lostEnemies: sortedUnique(publicLostEnemyIds.filter((id) => beforeEnemyIds.has(id) && !afterEnemyIds.has(id))),
    unitHpChanges: [...afterUnits.values()].filter((unit) => beforeUnits.get(unit.id)?.hp !== undefined && beforeUnits.get(unit.id)!.hp !== unit.hp).map((unit) => ({ unitId: unit.id, before: beforeUnits.get(unit.id)!.hp, after: unit.hp })).sort((a, b) => a.unitId.localeCompare(b.unitId)),
    unitSupplyChanges: [...afterUnits.values()].filter((unit) => { const previous = beforeUnits.get(unit.id); return previous && (previous.currentFuel !== unit.currentFuel || previous.currentMilitaryGoods !== unit.currentMilitaryGoods); }).map((unit) => { const previous = beforeUnits.get(unit.id)!; return { unitId: unit.id, beforeFuel: previous.currentFuel, afterFuel: unit.currentFuel, beforeMilitaryGoods: previous.currentMilitaryGoods, afterMilitaryGoods: unit.currentMilitaryGoods }; }).sort((a, b) => a.unitId.localeCompare(b.unitId)),
    checkpointRoleChanges: after.checkpoints.filter((checkpoint) => beforeCheckpoints.get(checkpoint.id)?.role !== checkpoint.role).map((checkpoint) => ({ checkpointId: checkpoint.id, before: beforeCheckpoints.get(checkpoint.id)?.role ?? 'unknown', after: checkpoint.role })).sort((a, b) => a.checkpointId.localeCompare(b.checkpointId)),
  };
}

function pageSize(value: unknown): number {
  const size = value ?? DEFAULT_QUERY_PAGE_SIZE;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > MAX_QUERY_PAGE_SIZE) throw new SessionError('invalid_page_size', `pageSize must be an integer from 1 to ${MAX_QUERY_PAGE_SIZE}`);
  return size;
}

interface CursorValue { sessionId: string; revision: number; target: SessionQueryTarget; offset: number; filtersHash: string }
function encodeCursor(value: CursorValue): string { return Buffer.from(canonicalJson(value), 'utf8').toString('base64url'); }
function decodeCursor(value: string): CursorValue {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorValue;
    if (!isObject(decoded) || typeof decoded.sessionId !== 'string' || typeof decoded.revision !== 'number' || !QUERY_TARGETS.includes(decoded.target) || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0 || typeof decoded.filtersHash !== 'string') throw new Error('shape');
    return decoded;
  } catch { throw new SessionError('invalid_cursor', 'query cursor is malformed'); }
}

function *readLines(root: SafePathRoot, path: string): Generator<string> {
  const fd = openSync(assertSafeInputFile(root, path), 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const decoder = new StringDecoder('utf8');
  let pending = '';
  try {
    while (true) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      pending += decoder.write(buffer.subarray(0, count));
      if (Buffer.byteLength(pending, 'utf8') > 8 * 1024 * 1024 && !pending.includes('\n')) throw new SessionError('artifact_corrupt', 'Artifact contains an oversized stream record');
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, '');
        pending = pending.slice(newline + 1);
        if (line) yield line;
      }
    }
    pending += decoder.end();
    if (pending.replace(/\r$/u, '')) yield pending.replace(/\r$/u, '');
  } finally { closeSync(fd); }
}

function safeOutputRoot(targetPath: string): SafePathRoot {
  let parent = dirname(resolve(targetPath));
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) throw new SessionError('unsafe_path', `No existing safe parent for Artifact output ${targetPath}`);
    parent = next;
  }
  return createSafePathRoot(parent);
}

function lazyIterableArray<T>(length: number, source: () => Iterable<T>): T[] {
  let iterator: Iterator<T> | null = null;
  let cursor = -1;
  let current: T | undefined;
  return lazyArray(length, (index) => {
    if (index < 0 || index >= length) throw new SessionError('artifact_index_invalid', 'Artifact history index is out of range');
    if (!iterator || index < cursor) { iterator = source()[Symbol.iterator](); cursor = -1; current = undefined; }
    while (cursor < index) {
      const next = iterator.next();
      if (next.done) throw new SessionError('artifact_corrupt', 'Artifact history ended before its declared length');
      cursor += 1;
      current = next.value;
    }
    return clone(current as T);
  });
}

function matchesFilters(item: JsonValue, filters: Record<string, JsonValue>): boolean {
  if (!isObject(item)) return Object.keys(filters).length === 0;
  return Object.entries(filters).every(([key, expected]) => {
    if (key === 'fromDecision' || key === 'toDecision') return true;
    if (key === 'qMin' || key === 'qMax' || key === 'rMin' || key === 'rMax') {
      const position = isObject(item.position) ? item.position : item;
      const axis = key[0]!.toLowerCase();
      const actual = position[axis];
      return typeof actual === 'number' && typeof expected === 'number' && (key.endsWith('Min') ? actual >= expected : actual <= expected);
    }
    if (key === 'actionType') return item.type === expected;
    return item[key] === expected;
  });
}

export class SessionService {
  private readonly continuations = new Map<string, LoadedSession>();
  private readonly publicSnapshotInterval: number;
  public constructor(public readonly store: SessionStore, private readonly gameFactory: SessionGameFactory, private readonly identity: SessionVersionIdentity, options: SessionServiceOptions = {}) {
    const interval = options.publicSnapshotInterval ?? PUBLIC_SNAPSHOT_INTERVAL;
    if (!Number.isSafeInteger(interval) || interval < 1 || interval > PUBLIC_SNAPSHOT_INTERVAL) throw new SessionError('invalid_session_option', `publicSnapshotInterval must be an integer from 1 to ${PUBLIC_SNAPSHOT_INTERVAL}`);
    this.publicSnapshotInterval = interval;
  }

  public newSession(options: NewSessionOptions = {}): SessionStatusResult {
    if (!isObject(options)) throw new SessionError('invalid_session_option', 'new options must be a JSON object');
    const sessionId = options.sessionId ?? newSessionId();
    const seed = requireSafeInteger(options.seed ?? 1, 'seed', Number.MIN_SAFE_INTEGER);
    const checkpointInterval = requireSafeInteger(options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL, 'checkpointInterval', 1);
    const agentId = options.agentId ?? 'external-agent';
    assertSafeIdentifier(sessionId, 'sessionId'); assertSafeIdentifier(agentId, 'agentId');
    const lock = this.store.acquireLock(sessionId);
    try {
      const runtime = this.gameFactory.createNew({ seed, agentId });
      const observation = clone(runtime.getObservation());
      if (observation.map.id !== this.identity.mapId) throw new SessionError('session_version_mismatch', `Runtime map ${observation.map.id} does not match ${this.identity.mapId}`);
      const publicConfig = clone(runtime.getRunArtifact().config) as unknown as JsonValue;
      const lineage = { parentSessionId: null, parentCheckpointId: null } satisfies SessionLineage;
      const descriptor = descriptorWithHash(this.identity, this.store.manifest.storeId, { sessionId, seed, agentId, checkpointInterval, publicConfig, lineage, branchBase: null });
      const initialState = publicState(runtime, 0, ZERO_HASH);
      const initialSnapshot = this.store.writePayload('public', { kind: 'snapshot', document: { observation: initialState.observation, legalActions: initialState.legalActions, gameOver: initialState.gameOver, result: initialState.result }, documentHash: initialState.documentHash } satisfies SessionPublicSnapshotPayload);
      const runBase = runBaseWithHash({ sessionSchemaVersion: SESSION_SCHEMA_VERSION, artifactSchemaVersion: this.identity.artifactSchemaVersion, sessionId, seed, agentId, buildId: this.identity.buildId, publicConfig, fixedMap: this.store.writePayload('public', observation.map), initialPublicState: initialSnapshot, initialPublicHash: initialState.documentHash, ...lineage });
      const active = this.store.create(descriptor, runBase, clone(runtime.exportPrivateState()), initialState);
      return statusResult(this.loadCompatible(active.sessionId), this.store.readSessionMetrics(sessionId));
    } finally { lock.release(); }
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
      } finally { lock.release(); }
    } catch (error) { return this.rejectWithDiagnostics(sessionId, 'status', error); }
  }

  public step(sessionId: string, rawInput: unknown): SessionStepResult {
    try {
      let input: SessionStepInput;
      try { input = this.validateStepInput(rawInput); }
      catch (error) { this.store.recordDiagnostic(sessionId, 'inputFormatRejected', 'step'); throw this.withMetricsDetails(sessionId, error); }
      const lock = this.store.acquireExistingLock(sessionId);
      try {
        const loaded = this.loadCompatible(sessionId, true);
        if (input.expectedRevision !== undefined && input.expectedRevision !== loaded.active.revision) {
          this.store.recordDiagnostic(sessionId, 'staleRevisionRejected', 'step');
          throw new SessionError('stale_revision', `Expected revision ${input.expectedRevision}, current revision is ${loaded.active.revision}`);
        }
        if (loaded.publicState.gameOver) throw new SessionError('game_over', 'The Session is already over');
        const runtime = this.restoreAndVerify(loaded);
        this.ensureAutomaticCheckpoint(loaded);
        const beforeObservation = clone(runtime.getObservation());
        const beforePrivate = clone(runtime.exportPrivateState());
        const beforeDocument: SessionPublicDocument = { observation: loaded.publicState.observation, legalActions: loaded.publicState.legalActions, gameOver: loaded.publicState.gameOver, result: loaded.publicState.result };
        const result = runtime.step(input);
        const accepted = result.error === null;
        const afterPrivate = clone(runtime.exportPrivateState());
        if (!accepted && canonicalJson(beforePrivate) !== canonicalJson(afterPrivate)) throw new SessionError('rejected_action_mutated_state', 'Rejected Action changed Private State or RNG');
        const afterObservation = clone(result.observation);
        const afterDocument = publicDocument(runtime);
        if (canonicalJson(afterDocument.observation) !== canonicalJson(traceObservation(afterObservation))) throw new SessionError('runtime_inconsistent', 'Runtime Step observation differs from current Observation');
        const beforeHash = loaded.publicState.documentHash;
        const afterHash = sha256Json(afterDocument);
        const nextDecision = loaded.active.decision + 1;
        const snapshot = nextDecision % this.publicSnapshotInterval === 0;
        const operations = createLosslessJsonDiff(beforeDocument as unknown as JsonValue, afterDocument as unknown as JsonValue);
        if (sha256Json(applyLosslessJsonDiff(beforeDocument as unknown as JsonValue, operations)) !== afterHash) throw new SessionError('public_diff_invalid', 'Generated public diff is not lossless');
        const payloadKind = snapshot ? 'snapshot' : operations.length === 0 ? 'unchanged' : 'diff';
        const payload = snapshot
          ? this.store.writePayload('public', { kind: 'snapshot', document: afterDocument, documentHash: afterHash } satisfies SessionPublicSnapshotPayload)
          : this.store.writePayload('public', { kind: 'diff', beforeDocumentHash: beforeHash, afterDocumentHash: afterHash, operations } satisfies SessionPublicDiffPayload);
        const stateDelta = deriveSessionStateDelta(beforeObservation, afterObservation, result.events);
        const withoutHash = { decision: nextDecision, turn: beforeObservation.turn, phase: beforeObservation.phase, inputAction: cloneAction(input.action), decisionSummary: input.decisionSummary, accepted, error: clone(result.error), events: clone(result.events), stateDelta, beforePublicHash: beforeHash, afterPublicHash: afterHash, publicPayload: payload, publicPayloadKind: payloadKind, previousDecisionHash: loaded.active.traceHeadHash } satisfies Omit<PublicDecisionRecord, 'decisionHash'>;
        const record: PublicDecisionRecord = { ...withoutHash, decisionHash: decisionHash(withoutHash) };
        const nextPublic: SessionPublicState = { ...afterDocument, decision: nextDecision, traceHeadHash: record.decisionHash, documentHash: afterHash };
        const nextActive = this.store.commit({ descriptor: loaded.descriptor, previous: loaded.active, privateState: afterPrivate, publicState: nextPublic, decisionRecord: record, acceptedActionCount: loaded.active.acceptedActionCount + (accepted ? 1 : 0), invalidActionCount: loaded.active.invalidActionCount + (accepted ? 0 : 1) });
        if (!accepted) this.store.recordDiagnostic(sessionId, 'invalidDecision', 'step');
        const committed: LoadedSession = { directory: loaded.directory, descriptor: loaded.descriptor, runBase: loaded.runBase, active: nextActive, privateState: afterPrivate, publicState: nextPublic, lastDecision: record };
        this.continuations.set(sessionId, committed);
        const checkpointsCreated = this.ensureAutomaticCheckpoint(committed);
        return { ...statusResult(committed, this.store.readSessionMetrics(sessionId)), active: clone(nextActive), accepted, error: clone(result.error), events: clone(result.events), stateDelta: clone(stateDelta), decisionRecord: clone(record), checkpointsCreated };
      } finally { lock.release(); }
    } catch (error) { return this.rejectWithDiagnostics(sessionId, 'step', error); }
  }

  public saveCheckpoint(sessionId: string): SessionCheckpointMetadata {
    try {
      const lock = this.store.acquireExistingLock(sessionId);
      try { const loaded = this.loadCompatible(sessionId); this.restoreAndVerify(loaded); this.ensureAutomaticCheckpoint(loaded); return this.createCheckpoint(loaded, 'manual'); }
      finally { lock.release(); }
    } catch (error) { return this.rejectWithDiagnostics(sessionId, 'save-checkpoint', error); }
  }
  public listCheckpoints(sessionId: string): SessionCheckpointMetadata[] { try { return this.store.listCheckpoints(sessionId).map(clone); } catch (error) { return this.rejectWithDiagnostics(sessionId, 'list-checkpoints', error); } }

  public loadCheckpoint(sourceSessionId: string, checkpointId: string, newSessionId: string): SessionStatusResult {
    try {
      assertSafeIdentifier(newSessionId, 'newSessionId');
      const checkpoint = this.store.loadCheckpoint(sourceSessionId, checkpointId);
      this.assertDescriptorCompatible(checkpoint.source.descriptor);
      const ancestor = this.store.createAncestorManifestDetails(sourceSessionId, checkpoint.metadata.decision, checkpoint.metadata.publicDocumentHash);
      const branchBase: SessionBranchBase = { rootSessionId: checkpoint.source.descriptor.branchBase?.rootSessionId ?? sourceSessionId, parentSessionId: sourceSessionId, parentCheckpointId: checkpointId, baseDecision: checkpoint.metadata.decision, baseTraceHeadHash: checkpoint.metadata.publicTraceHeadHash, basePublicSnapshotHash: checkpoint.metadata.publicDocumentHash, ancestorManifestHash: ancestor.reference.contentHash };
      const lock = this.store.acquireLock(newSessionId);
      try {
        const lineage = { parentSessionId: sourceSessionId, parentCheckpointId: checkpointId } satisfies SessionLineage;
        const descriptor = descriptorWithHash(this.identity, this.store.manifest.storeId, { sessionId: newSessionId, seed: checkpoint.source.descriptor.seed, agentId: checkpoint.source.descriptor.agentId, checkpointInterval: checkpoint.source.descriptor.checkpointInterval, publicConfig: checkpoint.source.descriptor.publicConfig, lineage, branchBase });
        const runBase = runBaseWithHash({ sessionSchemaVersion: SESSION_SCHEMA_VERSION, artifactSchemaVersion: checkpoint.source.runBase.artifactSchemaVersion, sessionId: newSessionId, seed: checkpoint.source.runBase.seed, agentId: checkpoint.source.runBase.agentId, buildId: checkpoint.source.runBase.buildId, publicConfig: checkpoint.source.runBase.publicConfig, fixedMap: checkpoint.source.runBase.fixedMap, initialPublicState: checkpoint.source.runBase.initialPublicState, initialPublicHash: checkpoint.source.runBase.initialPublicHash, ...lineage });
        const active = this.store.create(descriptor, runBase, checkpoint.privateState, checkpoint.publicState, ancestor);
        const loaded = this.loadCompatible(active.sessionId);
        this.restoreAndVerify(loaded);
        this.store.recordDiagnostic(sourceSessionId, 'branchedSessionCreated', 'load-checkpoint');
        return statusResult(loaded, this.store.readSessionMetrics(newSessionId));
      } finally { lock.release(); }
    } catch (error) { return this.rejectWithDiagnostics(sourceSessionId, 'load-checkpoint', error); }
  }

  public query(sessionId: string, rawInput: SessionQueryInput): SessionQueryResult {
    try {
      if (!isObject(rawInput) || !QUERY_TARGETS.includes(rawInput.target)) throw new SessionError('invalid_query', `query target must be one of ${QUERY_TARGETS.join(', ')}`);
      const lock = this.store.acquireExistingLock(sessionId);
      try {
        const loaded = this.loadCompatible(sessionId);
        const revision = loaded.active.revision;
        if (rawInput.expectedRevision !== undefined && rawInput.expectedRevision !== revision) throw new SessionError('stale_revision', `Expected revision ${rawInput.expectedRevision}, current revision is ${revision}`);
        const filters = isObject(rawInput.filters) ? rawInput.filters as Record<string, JsonValue> : {};
        const filtersHash = sha256Json(filters);
        const cursor = rawInput.cursor ? decodeCursor(rawInput.cursor) : null;
        if (cursor && (cursor.sessionId !== sessionId || cursor.revision !== revision || cursor.target !== rawInput.target || cursor.filtersHash !== filtersHash)) throw new SessionError('stale_revision', 'query cursor does not belong to the current Session revision and filter');
        const offset = cursor?.offset ?? 0;
        const size = pageSize(rawInput.pageSize);
        if (rawInput.target === 'history') {
          const history = this.historyPage(loaded, filters, offset, size);
          const nextOffset = offset + history.items.length;
          const hasMore = nextOffset < history.total;
          return { sessionId, revision, target: rawInput.target, count: history.items.length, total: history.total, hasMore, nextCursor: hasMore ? encodeCursor({ sessionId, revision, target: rawInput.target, offset: nextOffset, filtersHash }) : null, items: history.items as unknown as JsonValue[] };
        }
        const runtime = rawInput.target === 'api' ? this.restoreAndVerify(loaded) : null;
        let value: JsonValue | undefined;
        let items: JsonValue[] = [];
        const observation = restoreArtifactObservation(loaded.publicState.observation, this.store.readPayload<AgentMapObservation>(loaded.runBase.fixedMap, 'Fixed Map'));
        switch (rawInput.target) {
          case 'api': value = clone(runtime?.getApiInfo?.() ?? { unavailable: true }) as unknown as JsonValue; break;
          case 'map': {
            const { tiles, ...mapInfo } = observation.map;
            value = { ...mapInfo, visibleTileKeys: loaded.publicState.observation.visibleTileKeys } as unknown as JsonValue;
            items = tiles as unknown as JsonValue[];
            break;
          }
          case 'units': items = observation.units as unknown as JsonValue[]; break;
          case 'facilities': items = observation.facilities as unknown as JsonValue[]; break;
          case 'checkpoints': items = observation.checkpoints as unknown as JsonValue[]; break;
          case 'branches': items = observation.roadBranches as unknown as JsonValue[]; break;
          case 'construction': items = [...observation.checkpointPositionCandidates, ...observation.constructibleFacilityPositionCandidates] as unknown as JsonValue[]; break;
          case 'legal-actions': items = loaded.publicState.legalActions as unknown as JsonValue[]; break;
          case 'forecast': value = { endTurnForecast: observation.endTurnForecast, strategicForecast: observation.strategicForecast } as unknown as JsonValue; break;
          case 'full-snapshot': value = { observation, legalActions: loaded.publicState.legalActions } as unknown as JsonValue; break;
        }
        const filtered = items.filter((item) => matchesFilters(item, filters));
        if (offset > filtered.length) throw new SessionError('invalid_cursor', 'query cursor offset exceeds result size');
        const page = filtered.slice(offset, offset + size);
        const nextOffset = offset + page.length;
        const hasMore = nextOffset < filtered.length;
        const paginated = rawInput.target === 'map' || value === undefined;
        return { sessionId, revision, target: rawInput.target, count: paginated ? page.length : 1, total: paginated ? filtered.length : 1, hasMore, nextCursor: hasMore ? encodeCursor({ sessionId, revision, target: rawInput.target, offset: nextOffset, filtersHash }) : null, ...(page.length > 0 ? { items: clone(page) } : {}), ...(value !== undefined ? { value: clone(value) } : {}) };
      } finally { lock.release(); }
    } catch (error) {
      if (error instanceof SessionError && error.code === 'stale_revision') this.store.recordDiagnostic(sessionId, 'staleRevisionRejected', 'query');
      return this.rejectWithDiagnostics(sessionId, 'query', error);
    }
  }

  private historyPage(loaded: LoadedSession, filters: Record<string, JsonValue>, offset: number, size: number): { items: Array<Record<string, unknown>>; total: number } {
    const from = typeof filters.fromDecision === 'number' && Number.isSafeInteger(filters.fromDecision) ? Math.max(1, filters.fromDecision) : 1;
    const to = Math.min(loaded.active.decision, typeof filters.toDecision === 'number' && Number.isSafeInteger(filters.toDecision) ? filters.toDecision : loaded.active.decision);
    const total = Math.max(0, to - from + 1);
    if (offset > total) throw new SessionError('invalid_cursor', 'query cursor offset exceeds history result size');
    if (offset === total) return { items: [], total };
    const firstDecision = from + offset;
    const lastDecision = Math.min(to, firstDecision + size - 1);
    let baseSnapshot: PublicDecisionRecord | null = null;
    for (const record of this.store.iterateAllDecisionRecords(loaded.descriptor.sessionId, firstDecision - 1)) {
      if (record.publicPayloadKind === 'snapshot') baseSnapshot = record;
    }
    let document = baseSnapshot ? this.snapshotDocument(baseSnapshot) : this.initialDocument(loaded.runBase);
    const baseDecision = baseSnapshot?.decision ?? 0;
    const compressedItems: Buffer[] = [];
    for (const record of this.store.iterateAllDecisionRecords(loaded.descriptor.sessionId, lastDecision)) {
      if (record.decision <= baseDecision) continue;
      const before = document;
      document = this.applyDecisionPayload(document, record);
      if (record.decision >= firstDecision) compressedItems.push(gzipSync(Buffer.from(canonicalJson({ ...record, observationBefore: before.observation, legalActionsBefore: before.legalActions, observationAfter: document.observation, legalActionsAfter: document.legalActions }), 'utf8'), { level: 9 }));
    }
    const map = this.store.readPayload<AgentMapObservation>(loaded.runBase.fixedMap, 'Fixed Map');
    const items = lazyArray(compressedItems.length, (index) => {
      const item = JSON.parse(gunzipSync(compressedItems[index]!).toString('utf8')) as Record<string, unknown> & { observationBefore: SessionPublicDocument['observation']; observationAfter: SessionPublicDocument['observation'] };
      return { ...item, observationBefore: restoreArtifactObservation(item.observationBefore, map), observationAfter: restoreArtifactObservation(item.observationAfter, map) };
    });
    return { items, total };
  }

  private snapshotDocument(record: PublicDecisionRecord): SessionPublicDocument {
    const snapshot = this.store.readPayload<SessionPublicSnapshotPayload>(record.publicPayload, `Decision ${record.decision} Snapshot`);
    if (snapshot.kind !== 'snapshot' || snapshot.documentHash !== record.afterPublicHash || sha256Json(snapshot.document) !== snapshot.documentHash) throw new SessionError('public_snapshot_invalid', `Decision ${record.decision} Snapshot hash mismatch`);
    return clone(snapshot.document);
  }

  public exportArtifact(sessionId: string, outputPath?: string): SessionArtifactManifest {
    try {
      const loaded = this.loadCompatible(sessionId);
      this.restoreAndVerify(loaded);
      const packagePath = resolve(outputPath ?? join(loaded.directory, 'artifacts', `${sessionId}-d${String(loaded.active.decision).padStart(12, '0')}.nlth-artifact`));
      if (existsSync(packagePath)) throw new SessionError('artifact_exists', `Refusing to overwrite Artifact package ${packagePath}`);
      const outputRoot = safeOutputRoot(packagePath);
      ensureSafeOutputDirectory(outputRoot, packagePath);
      const packageRoot = createSafePathRoot(packagePath);
      ensureSafeOutputDirectory(packageRoot, join(packagePath, 'payloads'));
      const streamPath = join(packagePath, 'artifact.ndjson');
      const streamFd = openSync(assertSafeOutputPath(packageRoot, streamPath), 'wx');
      const streamHash = createHash('sha256');
      const writeLine = (value: unknown): void => { const bytes = Buffer.from(`${canonicalJson(value)}\n`, 'utf8'); writeSync(streamFd, bytes); streamHash.update(bytes); };
      let decisionCount = 0;
      let acceptedActionCount = 0;
      let invalidActionCount = 0;
      let payloadCount = 0;
      const fixedMap = this.store.readPayload<AgentMapObservation>(loaded.runBase.fixedMap, 'Fixed Map');
      let metricDocument = this.initialDocument(loaded.runBase);
      const initialMetricObservation = restoreArtifactObservation(metricDocument.observation, fixedMap);
      const metrics = createGameMetricsAccumulator(metricsMetadata(loaded.descriptor), initialMetricObservation);
      try {
        writeLine({ kind: 'header', descriptor: loaded.descriptor, runBase: loaded.runBase, finalPublicHash: loaded.publicState.documentHash });
        for (const record of this.store.iterateAllDecisionRecords(sessionId)) {
          writeLine({ kind: 'decision', record });
          decisionCount += 1;
          if (record.accepted) acceptedActionCount += 1; else invalidActionCount += 1;
          if (this.copyPayloadToPackage(record.publicPayload, packageRoot)) payloadCount += 1;
          metricDocument = this.applyDecisionPayload(metricDocument, record);
          metrics.pushDecision({ record, ...(record.accepted ? { observationAfter: restoreArtifactObservation(metricDocument.observation, fixedMap) } : {}) });
        }
        const gameMetrics = publicMetrics(metrics.finish(restoreArtifactObservation(metricDocument.observation, fixedMap), loaded.publicState.result) as unknown as Record<string, unknown>);
        writeLine({ kind: 'footer', result: loaded.publicState.result, gameMetrics, sessionMetrics: this.store.readSessionMetrics(sessionId) });
      } finally { closeSync(streamFd); }
      if (this.copyPayloadToPackage(loaded.runBase.fixedMap, packageRoot)) payloadCount += 1;
      if (this.copyPayloadToPackage(loaded.runBase.initialPublicState, packageRoot)) payloadCount += 1;
      const withoutHash = { ...this.identity, packageVersion: SESSION_ARTIFACT_PACKAGE_VERSION, sessionSchemaVersion: SESSION_SCHEMA_VERSION, sessionId, lineage: { parentSessionId: loaded.descriptor.parentSessionId, parentCheckpointId: loaded.descriptor.parentCheckpointId }, branchBase: loaded.descriptor.branchBase, decisionCount, acceptedActionCount, invalidActionCount, payloadCount, artifactPath: packagePath, streamHash: streamHash.digest('hex') } satisfies Omit<SessionArtifactManifest, 'manifestHash'>;
      const manifest: SessionArtifactManifest = { ...withoutHash, manifestHash: sha256Json(withoutHash) };
      writeFileSync(assertSafeOutputPath(packageRoot, join(packagePath, 'manifest.json')), `${canonicalJson(manifest)}\n`, { encoding: 'utf8', flag: 'wx' });
      return manifest;
    } catch (error) { return this.rejectWithDiagnostics(sessionId, 'artifact', error); }
  }

  public readArtifact(packagePath: string): SessionArtifactManifest {
    const root = resolve(packagePath);
    const safeRoot = createSafePathRoot(root);
    const manifest = JSON.parse(readFileSync(assertSafeInputFile(safeRoot, join(root, 'manifest.json')), 'utf8')) as SessionArtifactManifest;
    const expected = integrityHash(manifest as unknown as Record<string, unknown>, 'manifestHash');
    if (expected !== manifest.manifestHash || manifest.packageVersion !== SESSION_ARTIFACT_PACKAGE_VERSION || manifest.sessionSchemaVersion !== SESSION_SCHEMA_VERSION) throw new SessionError('artifact_corrupt', 'Artifact manifest is unsupported or corrupt');
    for (const field of ['appVersion', 'gameRulesVersion', 'saveFormatVersion', 'artifactSchemaVersion', 'agentApiVersion', 'observationApiVersion', 'bridgeApiVersion', 'buildId', 'gitCommit', 'mapId'] as const) {
      if (manifest[field] !== this.identity[field]) throw new SessionError('artifact_version_mismatch', `Artifact ${field} ${String(manifest[field])} does not match ${String(this.identity[field])}`);
    }
    const hash = createHash('sha256');
    const streamPath = assertSafeInputFile(safeRoot, join(root, 'artifact.ndjson'));
    const fd = openSync(streamPath, 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try { while (true) { const count = readSync(fd, buffer, 0, buffer.length, null); if (count === 0) break; hash.update(buffer.subarray(0, count)); } } finally { closeSync(fd); }
    if (hash.digest('hex') !== manifest.streamHash) throw new SessionError('artifact_corrupt', 'Artifact stream hash mismatch');
    const lines = readLines(safeRoot, streamPath);
    const first = lines.next();
    if (first.done) throw new SessionError('artifact_corrupt', 'Artifact stream is empty');
    const header = JSON.parse(first.value) as { kind: string; descriptor: SessionDescriptor; runBase: SessionRunBase; finalPublicHash: string };
    if (header.kind !== 'header' || header.descriptor.sessionId !== manifest.sessionId || header.runBase.sessionId !== manifest.sessionId) throw new SessionError('artifact_corrupt', 'Artifact header does not match its manifest');
    if (integrityHash(header.descriptor as unknown as Record<string, unknown>, 'descriptorIntegrityHash') !== header.descriptor.descriptorIntegrityHash || integrityHash(header.runBase as unknown as Record<string, unknown>, 'runBaseIntegrityHash') !== header.runBase.runBaseIntegrityHash) throw new SessionError('artifact_corrupt', 'Artifact header integrity hash mismatch');
    this.assertDescriptorCompatible(header.descriptor);
    if (canonicalJson(header.descriptor.branchBase) !== canonicalJson(manifest.branchBase) || header.descriptor.parentSessionId !== manifest.lineage.parentSessionId || header.descriptor.parentCheckpointId !== manifest.lineage.parentCheckpointId || header.runBase.parentSessionId !== manifest.lineage.parentSessionId || header.runBase.parentCheckpointId !== manifest.lineage.parentCheckpointId || header.runBase.seed !== header.descriptor.seed || header.runBase.agentId !== header.descriptor.agentId || header.runBase.buildId !== header.descriptor.buildId || canonicalJson(header.runBase.publicConfig) !== canonicalJson(header.descriptor.publicConfig)) throw new SessionError('artifact_corrupt', 'Artifact header lineage or Run Base differs from its manifest and descriptor');
    const map = this.readPackagePayload<AgentMapObservation>(safeRoot, header.runBase.fixedMap);
    if (map.id !== manifest.mapId) throw new SessionError('artifact_corrupt', 'Artifact fixed Map does not match manifest');
    const initial = this.readPackagePayload<SessionPublicSnapshotPayload>(safeRoot, header.runBase.initialPublicState);
    if (initial.kind !== 'snapshot' || initial.documentHash !== header.runBase.initialPublicHash || sha256Json(initial.document) !== initial.documentHash) throw new SessionError('artifact_corrupt', 'Artifact initial public Snapshot is corrupt');
    let document = initial.document;
    const metricAccumulator = createGameMetricsAccumulator(metricsMetadata(header.descriptor), restoreArtifactObservation(initial.document.observation, map));
    let previousHash = ZERO_HASH;
    let decisionCount = 0;
    let acceptedActionCount = 0;
    let invalidActionCount = 0;
    let footerSeen = false;
    let footerResult: unknown;
    let footerMetrics: unknown;
    let branchBaseSeen = header.descriptor.branchBase === null;
    if (header.descriptor.branchBase?.baseDecision === 0) {
      if (header.descriptor.branchBase.baseTraceHeadHash !== ZERO_HASH || initial.documentHash !== header.descriptor.branchBase.basePublicSnapshotHash) throw new SessionError('artifact_corrupt', 'Artifact zero-decision branch base is invalid');
      branchBaseSeen = true;
    }
    for (let next = lines.next(); !next.done; next = lines.next()) {
      const entry = JSON.parse(next.value) as { kind: string; record?: PublicDecisionRecord; result?: unknown; gameMetrics?: unknown };
      if (entry.kind === 'footer') {
        footerSeen = true;
        footerResult = entry.result;
        footerMetrics = entry.gameMetrics;
        const trailing = lines.next();
        if (!trailing.done) throw new SessionError('artifact_corrupt', 'Artifact stream contains data after its footer');
        break;
      }
      const record = entry.record;
      if (entry.kind !== 'decision' || !record) throw new SessionError('artifact_corrupt', 'Artifact stream contains an unknown record');
      const { decisionHash: _hash, ...withoutHash } = record;
      if (record.decision !== decisionCount + 1 || record.previousDecisionHash !== previousHash || !hashesEqual(decisionHash(withoutHash), record.decisionHash)) throw new SessionError('artifact_corrupt', 'Artifact Decision chain is invalid');
      document = this.applyPackageDecisionPayload(safeRoot, document, record);
      metricAccumulator.pushDecision({ record, ...(record.accepted ? { observationAfter: restoreArtifactObservation(document.observation, map) } : {}) });
      if (header.descriptor.branchBase && record.decision === header.descriptor.branchBase.baseDecision) {
        if (record.decisionHash !== header.descriptor.branchBase.baseTraceHeadHash || sha256Json(document) !== header.descriptor.branchBase.basePublicSnapshotHash) throw new SessionError('artifact_corrupt', 'Artifact branch base hashes do not match its flattened history');
        branchBaseSeen = true;
      }
      previousHash = record.decisionHash;
      decisionCount += 1;
      if (record.accepted) acceptedActionCount += 1; else invalidActionCount += 1;
    }
    const computedMetrics = publicMetrics(metricAccumulator.finish(restoreArtifactObservation(document.observation, map), document.result) as unknown as Record<string, unknown>);
    if (!footerSeen || !branchBaseSeen || decisionCount !== manifest.decisionCount || acceptedActionCount !== manifest.acceptedActionCount || invalidActionCount !== manifest.invalidActionCount || sha256Json(document) !== header.finalPublicHash || canonicalJson(document.result) !== canonicalJson(footerResult) || canonicalJson(computedMetrics) !== canonicalJson(footerMetrics)) throw new SessionError('artifact_corrupt', 'Artifact stream is incomplete or its final state differs');
    return manifest;
  }

  public replayArtifact(packagePath: string): { matched: true; decisionCount: number; result: unknown } {
    const manifest = this.readArtifact(packagePath);
    const root = resolve(packagePath);
    const safeRoot = createSafePathRoot(root);
    const lines = readLines(safeRoot, join(root, 'artifact.ndjson'));
    const first = lines.next();
    if (first.done) throw new SessionError('artifact_corrupt', 'Artifact stream is empty');
    const header = JSON.parse(first.value) as { descriptor: SessionDescriptor; finalPublicHash: string };
    this.assertDescriptorCompatible(header.descriptor);
    const runtime = this.gameFactory.createNew({ seed: header.descriptor.seed, agentId: header.descriptor.agentId });
    let decisionCount = 0;
    for (let next = lines.next(); !next.done; next = lines.next()) {
      const entry = JSON.parse(next.value) as { kind: string; record?: PublicDecisionRecord };
      if (entry.kind === 'footer') break;
      if (!entry.record) throw new SessionError('artifact_corrupt', 'Artifact Decision record is missing');
      const result = runtime.step({ action: entry.record.inputAction, decisionSummary: entry.record.decisionSummary });
      if ((result.error === null) !== entry.record.accepted) throw new SessionError('artifact_replay_mismatch', `Decision ${entry.record.decision} acceptance differs during Replay`);
      const replayDocument = publicDocument(runtime);
      if (sha256Json(replayDocument) !== entry.record.afterPublicHash) throw new SessionError('artifact_replay_mismatch', `Decision ${entry.record.decision} public state differs during Replay`);
      decisionCount += 1;
    }
    if (decisionCount !== manifest.decisionCount) throw new SessionError('artifact_replay_mismatch', 'Artifact Replay did not consume every Decision');
    return { matched: true, decisionCount, result: clone(runtime.getResult()) };
  }

  /** Explicit compatibility view backed by compressed observations and lazy record arrays. */
  public artifact(sessionId: string): SessionArtifact {
    const loaded = this.loadCompatible(sessionId);
    const map = this.store.readPayload<AgentMapObservation>(loaded.runBase.fixedMap, 'Fixed Map');
    let document = this.initialDocument(loaded.runBase);
    const initialObservation = restoreArtifactObservation(document.observation, map);
    const observations = new ObservationHistory();
    observations.push(initialObservation);
    const metricAccumulator = createGameMetricsAccumulator(metricsMetadata(loaded.descriptor), initialObservation);
    let acceptedCount = 0;
    let invalidCount = 0;
    let eventCount = 0;
    let decisionCount = 0;
    for (const record of this.store.iterateAllDecisionRecords(sessionId)) {
      document = this.applyDecisionPayload(document, record);
      const observationAfter = record.accepted ? restoreArtifactObservation(document.observation, map) : undefined;
      metricAccumulator.pushDecision({ record, ...(observationAfter ? { observationAfter } : {}) });
      if (observationAfter) { observations.push(observationAfter); acceptedCount += 1; }
      else if (record.error) invalidCount += 1;
      eventCount += record.events.length;
      decisionCount += 1;
    }
    if (decisionCount !== loaded.active.decision) throw new SessionError('trace_chain_invalid', 'Artifact history count differs from Active decision');
    const finalObservation = restoreArtifactObservation(document.observation, map);
    const metrics = publicMetrics(metricAccumulator.finish(finalObservation, loaded.publicState.result) as unknown as Record<string, unknown>);
    metrics.config = clone(loaded.descriptor.publicConfig);
    const recordSource = (): Iterable<PublicDecisionRecord> => this.store.iterateAllDecisionRecords(sessionId);
    const acceptedSource = function *(): Generator<GameAction> { for (const record of recordSource()) if (record.accepted) yield record.inputAction; };
    const invalidSource = function *(): Generator<{ decision: number; action: GameAction; error: NonNullable<PublicDecisionRecord['error']> }> { for (const record of recordSource()) if (!record.accepted && record.error) yield { decision: record.decision, action: record.inputAction, error: record.error }; };
    const eventSource = function *(): Generator<AgentPublicEvent> { for (const record of recordSource()) yield *record.events; };
    return {
      artifactSchemaVersion: loaded.descriptor.artifactSchemaVersion, appVersion: loaded.descriptor.appVersion, gameRulesVersion: loaded.descriptor.gameRulesVersion,
      agentApiVersion: loaded.descriptor.agentApiVersion, observationApiVersion: loaded.descriptor.observationApiVersion, bridgeApiVersion: loaded.descriptor.bridgeApiVersion,
      buildId: loaded.descriptor.buildId, mapId: loaded.descriptor.mapId, seed: loaded.descriptor.seed, config: clone(loaded.descriptor.publicConfig), agent: { id: loaded.descriptor.agentId },
      sessionId, lineage: { parentSessionId: loaded.descriptor.parentSessionId, parentCheckpointId: loaded.descriptor.parentCheckpointId },
      acceptedActions: lazyIterableArray(acceptedCount, acceptedSource), invalidAttempts: lazyIterableArray(invalidCount, invalidSource),
      decisionTrace: lazyIterableArray(decisionCount, recordSource), fixedMap: clone(map), observationTrace: observations.compactView(),
      events: lazyIterableArray(eventCount, eventSource), result: clone(loaded.publicState.result), metrics, sessionMetrics: this.store.readSessionMetrics(sessionId),
    } as SessionArtifact;
  }

  private initialDocument(runBase: SessionRunBase): SessionPublicDocument {
    const snapshot = this.store.readPayload<SessionPublicSnapshotPayload>(runBase.initialPublicState, 'Initial Public Snapshot');
    if (snapshot.kind !== 'snapshot' || sha256Json(snapshot.document) !== snapshot.documentHash || snapshot.documentHash !== runBase.initialPublicHash) throw new SessionError('public_snapshot_invalid', 'Initial Public Snapshot is corrupt');
    return clone(snapshot.document);
  }

  private applyDecisionPayload(before: SessionPublicDocument, record: PublicDecisionRecord): SessionPublicDocument {
    if (sha256Json(before) !== record.beforePublicHash) throw new SessionError('public_diff_invalid', `Decision ${record.decision} has the wrong public base`);
    if (record.publicPayloadKind === 'snapshot') {
      const snapshot = this.store.readPayload<SessionPublicSnapshotPayload>(record.publicPayload, `Decision ${record.decision} Snapshot`);
      if (snapshot.kind !== 'snapshot' || snapshot.documentHash !== record.afterPublicHash || sha256Json(snapshot.document) !== snapshot.documentHash) throw new SessionError('public_snapshot_invalid', `Decision ${record.decision} Snapshot hash mismatch`);
      return clone(snapshot.document);
    }
    const diff = this.store.readPayload<SessionPublicDiffPayload>(record.publicPayload, `Decision ${record.decision} diff`);
    if (diff.kind !== 'diff' || diff.beforeDocumentHash !== record.beforePublicHash || diff.afterDocumentHash !== record.afterPublicHash) throw new SessionError('public_diff_invalid', `Decision ${record.decision} diff metadata mismatch`);
    const after = applyLosslessJsonDiff(before as unknown as JsonValue, diff.operations) as unknown as SessionPublicDocument;
    if (sha256Json(after) !== record.afterPublicHash) throw new SessionError('public_diff_invalid', `Decision ${record.decision} diff is not lossless`);
    return after;
  }

  private copyPayloadToPackage(reference: SessionPayloadReference, packageRoot: SafePathRoot): boolean {
    const packagePath = packageRoot.lexicalPath;
    const refTarget = join(packagePath, 'payloads', reference.domain, 'refs', reference.contentHash.slice(0, 2), `${reference.contentHash}.json`);
    if (existsSync(refTarget)) {
      const existing = readFileSync(assertSafeInputFile(packageRoot, refTarget), 'utf8').trim();
      if (existing !== canonicalJson(reference)) throw new SessionError('artifact_corrupt', `Artifact payload index ${reference.contentHash} conflicts with an existing reference`);
      return false;
    }
    ensureSafeOutputDirectory(packageRoot, dirname(refTarget));
    writeFileSync(assertSafeOutputPath(packageRoot, refTarget), `${canonicalJson(reference)}\n`, { encoding: 'utf8', flag: 'wx' });
    for (const chunk of reference.chunks) {
      const source = join(this.store.sessionsRoot, 'pool', reference.domain, 'chunks', chunk.hash.slice(0, 2), `${chunk.hash}.gz`);
      const target = join(packagePath, 'payloads', reference.domain, 'chunks', chunk.hash.slice(0, 2), `${chunk.hash}.gz`);
      ensureSafeOutputDirectory(packageRoot, dirname(target));
      if (!existsSync(target)) copyFileSync(assertSafeInputFile(this.store.safeRoot, source), assertSafeOutputPath(packageRoot, target));
      else assertSafeInputFile(packageRoot, target);
    }
    return true;
  }

  private readPackagePayload<T>(packageRoot: SafePathRoot, reference: SessionPayloadReference): T {
    this.validateArtifactPayloadReference(reference);
    const packagePath = packageRoot.lexicalPath;
    const indexed = JSON.parse(readFileSync(assertSafeInputFile(packageRoot, join(packagePath, 'payloads', reference.domain, 'refs', reference.contentHash.slice(0, 2), `${reference.contentHash}.json`)), 'utf8')) as SessionPayloadReference;
    this.validateArtifactPayloadReference(indexed);
    if (canonicalJson(indexed) !== canonicalJson(reference)) throw new SessionError('artifact_corrupt', `Artifact payload index ${reference.contentHash} differs from its reference`);
    const logicalHash = createHash('sha256');
    const rawChunks: Buffer[] = [];
    let logicalBytes = 0;
    let compressedBytes = 0;
    for (const chunk of reference.chunks) {
      const compressed = readFileSync(assertSafeInputFile(packageRoot, join(packagePath, 'payloads', reference.domain, 'chunks', chunk.hash.slice(0, 2), `${chunk.hash}.gz`)));
      if (compressed.length !== chunk.compressedBytes || !hashesEqual(sha256Bytes(compressed), chunk.hash)) throw new SessionError('artifact_corrupt', `Artifact payload chunk ${chunk.hash} is corrupt`);
      let raw: Buffer;
      try { raw = gunzipSync(compressed); } catch { throw new SessionError('artifact_corrupt', `Artifact payload chunk ${chunk.hash} is invalid gzip`); }
      if (raw.length > ARTIFACT_CHUNK_BYTES) throw new SessionError('artifact_corrupt', `Artifact payload chunk ${chunk.hash} exceeds its decompressed bound`);
      logicalHash.update(raw); rawChunks.push(raw); logicalBytes += raw.length; compressedBytes += compressed.length;
      if (logicalBytes > reference.logicalBytes) throw new SessionError('artifact_corrupt', 'Artifact payload exceeds its declared size');
    }
    if (logicalBytes !== reference.logicalBytes || compressedBytes !== reference.compressedBytes || !hashesEqual(logicalHash.digest('hex'), reference.contentHash)) throw new SessionError('artifact_corrupt', `Artifact payload ${reference.contentHash} logical hash mismatch`);
    return JSON.parse(Buffer.concat(rawChunks, logicalBytes).toString('utf8')) as T;
  }

  private validateArtifactPayloadReference(reference: SessionPayloadReference): void {
    if (!isObject(reference) || !['public', 'private'].includes(reference.domain) || reference.encoding !== 'canonical-json+gzip-chunks' || !/^[0-9a-f]{64}$/u.test(reference.contentHash) || !Number.isSafeInteger(reference.logicalBytes) || reference.logicalBytes < 0 || reference.logicalBytes > MAX_ARTIFACT_PAYLOAD_BYTES || !Number.isSafeInteger(reference.compressedBytes) || reference.compressedBytes < 0 || !Array.isArray(reference.chunks) || reference.chunks.length < 1 || reference.chunks.length > Math.ceil(MAX_ARTIFACT_PAYLOAD_BYTES / ARTIFACT_CHUNK_BYTES) + 1) throw new SessionError('artifact_corrupt', 'Artifact payload reference is invalid or oversized');
    for (const chunk of reference.chunks) if (!isObject(chunk) || !/^[0-9a-f]{64}$/u.test(chunk.hash) || !Number.isSafeInteger(chunk.compressedBytes) || chunk.compressedBytes < 1 || chunk.compressedBytes > ARTIFACT_CHUNK_BYTES * 2) throw new SessionError('artifact_corrupt', 'Artifact payload chunk reference is invalid');
  }

  private applyPackageDecisionPayload(root: SafePathRoot, before: SessionPublicDocument, record: PublicDecisionRecord): SessionPublicDocument {
    if (sha256Json(before) !== record.beforePublicHash) throw new SessionError('artifact_corrupt', `Artifact Decision ${record.decision} has the wrong public base`);
    if (record.publicPayloadKind === 'snapshot') {
      const snapshot = this.readPackagePayload<SessionPublicSnapshotPayload>(root, record.publicPayload);
      if (snapshot.kind !== 'snapshot' || snapshot.documentHash !== record.afterPublicHash || sha256Json(snapshot.document) !== snapshot.documentHash) throw new SessionError('artifact_corrupt', `Artifact Decision ${record.decision} Snapshot is corrupt`);
      return snapshot.document;
    }
    const diff = this.readPackagePayload<SessionPublicDiffPayload>(root, record.publicPayload);
    if (diff.kind !== 'diff' || diff.beforeDocumentHash !== record.beforePublicHash || diff.afterDocumentHash !== record.afterPublicHash) throw new SessionError('artifact_corrupt', `Artifact Decision ${record.decision} diff metadata mismatch`);
    const after = applyLosslessJsonDiff(before as unknown as JsonValue, diff.operations) as unknown as SessionPublicDocument;
    if (sha256Json(after) !== record.afterPublicHash) throw new SessionError('artifact_corrupt', `Artifact Decision ${record.decision} diff is not lossless`);
    return after;
  }

  private validateStepInput(raw: unknown): SessionStepInput {
    if (!isObject(raw) || Object.keys(raw).some((key) => !['action', 'decisionSummary', 'expectedRevision'].includes(key))) throw new SessionError('invalid_step_input', 'step input may contain only action, decisionSummary, and expectedRevision');
    if (!Object.prototype.hasOwnProperty.call(raw, 'action') || !Object.prototype.hasOwnProperty.call(raw, 'decisionSummary') || !isObject(raw.action)) throw new SessionError('invalid_step_input', 'step input requires an action object and decisionSummary');
    const expectedRevision = raw.expectedRevision === undefined ? undefined : requireSafeInteger(raw.expectedRevision, 'expectedRevision', 0);
    return { action: JSON.parse(canonicalJson(raw.action)) as GameAction, decisionSummary: normalizeDecisionSummary(raw.decisionSummary), ...(expectedRevision === undefined ? {} : { expectedRevision }) };
  }

  private loadCompatible(sessionId: string, continuation = false): LoadedSession {
    if (continuation) {
      const cached = this.continuations.get(sessionId);
      if (cached) {
        const current = this.store.readCurrentHead(sessionId);
        this.assertDescriptorCompatible(current.descriptor);
        if (current.descriptor.descriptorIntegrityHash === cached.descriptor.descriptorIntegrityHash && current.active.commitIntegrityHash === cached.active.commitIntegrityHash) return cached;
      }
    }
    const loaded = this.store.load(sessionId);
    this.assertDescriptorCompatible(loaded.descriptor);
    this.continuations.set(sessionId, loaded);
    return loaded;
  }
  private assertDescriptorCompatible(descriptor: SessionDescriptor): void {
    for (const field of ['appVersion', 'gameRulesVersion', 'saveFormatVersion', 'artifactSchemaVersion', 'agentApiVersion', 'observationApiVersion', 'bridgeApiVersion', 'buildId', 'gitCommit', 'mapId'] as const) if (descriptor[field] !== this.identity[field]) throw new SessionError('session_version_mismatch', `Session ${field} ${String(descriptor[field])} does not match ${String(this.identity[field])}`);
  }

  private restoreAndVerify(loaded: LoadedSession): SessionGameRuntime {
    const runtime = this.gameFactory.restore({ privateState: clone(loaded.privateState), seed: loaded.descriptor.seed, agentId: loaded.descriptor.agentId, sessionId: loaded.descriptor.sessionId, decision: loaded.active.decision, traceHeadHash: loaded.active.traceHeadHash });
    const observation = runtime.getObservation();
    const stored = restoreArtifactObservation(loaded.publicState.observation, this.store.readPayload<AgentMapObservation>(loaded.runBase.fixedMap, 'Fixed Map'));
    if (canonicalJson(observation) !== canonicalJson(stored)) throw new SessionError('checkpoint_reconstruction_mismatch', 'Restored Observation differs from committed Public State');
    if (canonicalJson(runtime.getLegalActions()) !== canonicalJson(loaded.publicState.legalActions)) throw new SessionError('checkpoint_reconstruction_mismatch', 'Restored Legal Actions differ from committed Public State');
    return runtime;
  }

  private ensureAutomaticCheckpoint(loaded: LoadedSession): SessionCheckpointMetadata[] {
    const existing = new Set(this.store.listCheckpoints(loaded.descriptor.sessionId).map((checkpoint) => checkpoint.checkpointId));
    let kind: SessionCheckpointKind | null = null;
    if (loaded.active.gameOver) kind = 'final';
    else {
      const last = loaded.lastDecision;
      if (last?.accepted && last.inputAction.type === 'EndTurn' && loaded.active.phase === 'player' && loaded.active.currentTurn === last.turn + 1 && loaded.active.completedTurn > 0 && loaded.active.completedTurn % loaded.descriptor.checkpointInterval === 0) kind = 'periodic';
    }
    if (!kind) return [];
    const checkpointId = this.checkpointId(loaded, kind);
    return existing.has(checkpointId) ? [] : [this.createCheckpoint(loaded, kind)];
  }

  private createCheckpoint(loaded: LoadedSession, kind: SessionCheckpointKind): SessionCheckpointMetadata {
    const descriptor = loaded.descriptor;
    const checkpoint = this.store.writeCheckpoint(loaded, { checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION, sessionSchemaVersion: SESSION_SCHEMA_VERSION, appVersion: descriptor.appVersion, gameRulesVersion: descriptor.gameRulesVersion, saveFormatVersion: descriptor.saveFormatVersion, artifactSchemaVersion: descriptor.artifactSchemaVersion, agentApiVersion: descriptor.agentApiVersion, observationApiVersion: descriptor.observationApiVersion, bridgeApiVersion: descriptor.bridgeApiVersion, buildId: descriptor.buildId, gitCommit: descriptor.gitCommit, mapId: descriptor.mapId, seed: descriptor.seed, sessionId: descriptor.sessionId, checkpointId: this.checkpointId(loaded, kind), kind, parentSessionId: descriptor.parentSessionId, parentCheckpointId: descriptor.parentCheckpointId, publicConfigHash: sha256Json(descriptor.publicConfig), completedTurn: loaded.active.completedTurn, currentTurn: loaded.active.currentTurn, phase: loaded.active.phase, decision: loaded.active.decision, publicTraceHeadHash: loaded.active.traceHeadHash, createdAt: new Date().toISOString() });
    const metricKind: Record<SessionCheckpointKind, SessionDiagnosticEventKind> = { manual: 'manualCheckpointCreated', periodic: 'periodicCheckpointCreated', final: 'finalCheckpointCreated' };
    this.store.recordDiagnostic(descriptor.sessionId, metricKind[kind], `${kind}-checkpoint`);
    return checkpoint;
  }

  public recordInputFormatRejection(sessionId: string, operation = 'step'): SessionMetrics { this.store.recordDiagnostic(sessionId, 'inputFormatRejected', operation); return this.store.readSessionMetrics(sessionId); }
  private rejectWithDiagnostics<T>(sessionId: string, operation: string, error: unknown): T {
    if (!(error instanceof SessionError)) throw error;
    const message = error.message.toLowerCase();
    let kind: SessionDiagnosticEventKind | null = null;
    if (message.includes('buildid') || message.includes('build id')) kind = 'buildRejected';
    else if (error.code.includes('version_mismatch') || error.code.includes('version_unsupported')) kind = 'versionRejected';
    else if (message.includes('sha-256') || message.includes('hash') || error.code.includes('trace_chain') || error.code.includes('payload_hash')) kind = 'hashRejected';
    else if (error.code.includes('corrupt') || error.code.includes('reconstruction_mismatch') || error.code.includes('invalid')) kind = 'corruptionRejected';
    if (kind) this.store.recordDiagnostic(sessionId, kind, operation);
    throw this.withMetricsDetails(sessionId, error);
  }
  private withMetricsDetails(sessionId: string, error: unknown): SessionError {
    const source = error instanceof SessionError ? error : new SessionError('session_operation_failed', error instanceof Error ? error.message : String(error));
    const existing = source.details && typeof source.details === 'object' && !Array.isArray(source.details) ? source.details as Record<string, JsonValue> : {};
    return new SessionError(source.code, source.message, { ...existing, sessionMetrics: this.store.readSessionMetrics(sessionId) as unknown as JsonValue });
  }
  private checkpointId(loaded: LoadedSession, kind: SessionCheckpointKind): string {
    const turn = String(loaded.active.completedTurn).padStart(3, '0');
    if (kind === 'periodic') return `after-turn-${turn}`;
    const decision = String(loaded.active.decision).padStart(6, '0');
    if (kind === 'final') return `final-turn-${turn}-d${decision}`;
    const prefix = `manual-turn-${turn}-d${decision}-`;
    const next = this.store.listCheckpoints(loaded.descriptor.sessionId).filter((checkpoint) => checkpoint.checkpointId.startsWith(prefix)).length + 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }
}
