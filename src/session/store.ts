import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  opendirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { JsonValue } from '../core/types';
import {
  asJsonValue,
  assertSafeIdentifier,
  canonicalJson,
  decisionHash,
  hashesEqual,
  integrityHash,
  isSha256,
  sha256Bytes,
  sha256Json,
} from './hash';
import {
  CHECKPOINT_SCHEMA_VERSION,
  PUBLIC_SNAPSHOT_INTERVAL,
  SESSION_SCHEMA_VERSION,
  SESSION_STORE_SCHEMA_VERSION,
  SessionError,
  ZERO_HASH,
  type ActiveCommit,
  type PublicDecisionRecord,
  type SessionAncestorEntry,
  type SessionAncestorManifest,
  type SessionCheckpointMetadata,
  type SessionDescriptor,
  type SessionDiagnosticEvent,
  type SessionDiagnosticEventKind,
  type SessionFaultInjector,
  type SessionMetrics,
  type SessionPayloadReference,
  type SessionPrivateEnvelope,
  type SessionPublicDiffPayload,
  type SessionPublicDocument,
  type SessionPublicHead,
  type SessionPublicSnapshotPayload,
  type SessionPublicState,
  type SessionRunBase,
  type SessionStoreManifest,
} from './types';
import { applyLosslessJsonDiff, validateLosslessJsonDiffOperations } from './public-diff';
import {
  assertSafeInputDirectory,
  assertSafeInputFile,
  assertSafeOutputPath,
  createSafePathRoot,
  ensureSafeOutputDirectory,
  type SafePathRoot,
} from './safe-path';

const COMMIT_FILE_PATTERN = /^g(\d{12})-d(\d{12})-[A-Za-z0-9-]+\.json$/u;
const DECISION_FILE_PATTERN = /^d(\d{12})-([0-9a-f]{64})\.json$/u;
const CHECKPOINT_META_SUFFIX = '.meta.json';
const STORE_MANIFEST = 'store.json';
const CHUNK_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;
const MAX_STREAM_PAYLOAD_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_TRACE_LINE_BYTES = 8 * 1024 * 1024;
const PRIVATE_EVENT_BLOCK_SIZE = 256;

interface LockOwner { pid: number; host: string; token: string; acquiredAt: string }

export interface LoadedSession {
  directory: string;
  descriptor: SessionDescriptor;
  runBase: SessionRunBase;
  active: ActiveCommit;
  privateState: JsonValue;
  publicState: SessionPublicState;
  /** Only the local tail is retained; history validation itself is streamed. */
  lastDecision: PublicDecisionRecord | null;
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
  forcePublicSnapshot?: boolean;
}

export interface SessionStoreOptions {
  /** Test-only large-fixture support; production defaults to maximum compression. */
  gzipLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

function parseJson<T>(text: string, subject: string): T {
  try { return JSON.parse(text) as T; }
  catch (error) { throw new SessionError('session_corrupt', `${subject} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function ensureObject(value: unknown, subject: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new SessionError('session_corrupt', `${subject} must be a JSON object`);
}

function documentOf(state: SessionPublicState): SessionPublicDocument {
  return { observation: state.observation, legalActions: state.legalActions, gameOver: state.gameOver, result: state.result };
}

function completedTurn(publicState: SessionPublicState): number {
  if (publicState.observation.phase === 'player') return Math.max(0, publicState.observation.turn - 1);
  if (publicState.observation.phase === 'gameOver') return Math.max(0, publicState.observation.turn);
  return Math.max(0, publicState.observation.turn - 1);
}

function ensureStoreRoot(rootPath: string): SafePathRoot {
  const target = resolve(rootPath);
  if (!existsSync(target)) {
    let parent = dirname(target);
    while (!existsSync(parent)) {
      const next = dirname(parent);
      if (next === parent) throw new SessionError('unsafe_path', `No existing safe parent for Session root ${target}`);
      parent = next;
    }
    ensureSafeOutputDirectory(createSafePathRoot(parent), target);
  }
  return createSafePathRoot(target);
}

export class SessionLock {
  private released = false;
  public constructor(private readonly safeRoot: SafePathRoot, private readonly lockDirectory: string, private readonly archiveDirectory: string, private readonly owner: LockOwner) {}
  public release(): void {
    if (this.released) return;
    const current = parseJson<LockOwner>(readFileSync(assertSafeInputFile(this.safeRoot, join(this.lockDirectory, 'owner.json')), 'utf8'), 'session lock owner');
    if (current.token !== this.owner.token) throw new SessionError('lock_owner_changed', 'Session lock ownership changed unexpectedly');
    ensureSafeOutputDirectory(this.safeRoot, this.archiveDirectory);
    const released = assertSafeOutputPath(this.safeRoot, join(this.archiveDirectory, `released-${Date.now()}-${this.owner.token}`));
    renameSync(assertSafeInputDirectory(this.safeRoot, this.lockDirectory), released);
    this.released = true;
  }
}

export class SessionStore {
  public readonly sessionsRoot: string;
  public readonly safeRoot: SafePathRoot;
  public readonly manifest: SessionStoreManifest;
  /** Content-addressed payloads written and fsync-committed by this Store instance. */
  private readonly writtenPayloads = new Map<string, SessionPayloadReference>();
  private readonly gzipLevel: NonNullable<SessionStoreOptions['gzipLevel']>;

  public constructor(sessionsRoot: string, private readonly faultInjector?: SessionFaultInjector, options: SessionStoreOptions = {}) {
    if (options.gzipLevel !== undefined && (!Number.isInteger(options.gzipLevel) || options.gzipLevel < 0 || options.gzipLevel > 9)) throw new SessionError('invalid_store_option', 'gzipLevel must be an integer from 0 to 9');
    this.gzipLevel = options.gzipLevel ?? 9;
    this.sessionsRoot = resolve(sessionsRoot);
    this.safeRoot = ensureStoreRoot(this.sessionsRoot);
    this.manifest = this.ensureStoreManifest();
  }

  public sessionDirectory(sessionId: string): string {
    assertSafeIdentifier(sessionId, 'sessionId');
    const directory = join(this.sessionsRoot, sessionId);
    return existsSync(directory) ? assertSafeInputDirectory(this.safeRoot, directory) : assertSafeOutputPath(this.safeRoot, directory);
  }

  public acquireLock(sessionId: string): SessionLock {
    const directory = this.sessionDirectory(sessionId);
    ensureSafeOutputDirectory(this.safeRoot, directory);
    const lockDirectory = join(directory, '.active-lock');
    const archiveDirectory = join(directory, '.lock-history');
    const owner: LockOwner = { pid: process.pid, host: hostname(), token: randomUUID(), acquiredAt: new Date().toISOString() };
    try { mkdirSync(assertSafeOutputPath(this.safeRoot, lockDirectory)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let existing: LockOwner;
      try { existing = parseJson<LockOwner>(readFileSync(assertSafeInputFile(this.safeRoot, join(lockDirectory, 'owner.json')), 'utf8'), 'session lock owner'); }
      catch { throw new SessionError('session_locked', `Session ${sessionId} has an unreadable lock; it cannot be recovered safely`); }
      if (!this.lockOwnerIsDefinitelyDead(existing)) throw new SessionError('session_locked', `Session ${sessionId} is already being updated`, asJsonValue(existing));
      ensureSafeOutputDirectory(this.safeRoot, archiveDirectory);
      renameSync(assertSafeInputDirectory(this.safeRoot, lockDirectory), assertSafeOutputPath(this.safeRoot, join(archiveDirectory, `stale-${Date.now()}-${existing.token}`)));
      try { mkdirSync(assertSafeOutputPath(this.safeRoot, lockDirectory)); }
      catch { throw new SessionError('session_locked', `Session ${sessionId} was locked during stale-lock recovery`); }
    }
    writeFileSync(assertSafeOutputPath(this.safeRoot, join(lockDirectory, 'owner.json')), `${canonicalJson(owner)}\n`, { encoding: 'utf8', flag: 'wx' });
    return new SessionLock(this.safeRoot, lockDirectory, archiveDirectory, owner);
  }

  public acquireExistingLock(sessionId: string): SessionLock {
    const directory = this.sessionDirectory(sessionId);
    if (!existsSync(join(directory, 'session.json'))) throw new SessionError('session_not_found', `No Session exists at ${directory}`);
    return this.acquireLock(sessionId);
  }

  private lockOwnerIsDefinitelyDead(owner: LockOwner): boolean {
    if (!owner || owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string') return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  }

  public writePayload(domain: 'public' | 'private', value: unknown): SessionPayloadReference {
    const canonical = canonicalJson(value);
    const bytes = Buffer.from(canonical, 'utf8');
    return this.writePayloadBytes(domain, bytes, 'canonical-json+gzip-chunks');
  }

  public writeNdjsonPayload(domain: 'public' | 'private', values: Iterable<unknown>): SessionPayloadReference {
    const logicalHash = createHash('sha256');
    const chunks: SessionPayloadReference['chunks'] = [];
    let pending = Buffer.alloc(0);
    let logicalBytes = 0;
    let compressedBytes = 0;
    const flush = (raw: Buffer): void => {
      const compressed = gzipSync(raw, { level: this.gzipLevel });
      const hash = sha256Bytes(compressed);
      const path = this.chunkPath(domain, hash);
      if (!existsSync(path)) this.writeUniqueBuffer(path, compressed);
      chunks.push({ hash, compressedBytes: compressed.length });
      compressedBytes += compressed.length;
    };
    for (const value of values) {
      const line = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
      logicalHash.update(line); logicalBytes += line.length;
      if (logicalBytes > MAX_STREAM_PAYLOAD_BYTES) throw new SessionError('payload_too_large', `A single Session stream payload exceeds ${MAX_STREAM_PAYLOAD_BYTES} bytes`);
      pending = Buffer.concat([pending, line]);
      while (pending.length >= CHUNK_BYTES) { flush(pending.subarray(0, CHUNK_BYTES)); pending = pending.subarray(CHUNK_BYTES); }
    }
    if (pending.length > 0 || chunks.length === 0) flush(pending);
    const contentHash = logicalHash.digest('hex');
    const cached = this.writtenPayloads.get(`${domain}:${contentHash}`);
    if (cached) return clone(cached);
    const existing = this.tryReadPayloadReference(domain, contentHash);
    if (existing) { this.validatePayload(existing); this.writtenPayloads.set(`${domain}:${contentHash}`, clone(existing)); return existing; }
    const reference: SessionPayloadReference = { domain, contentHash, logicalBytes, compressedBytes, encoding: 'utf8+gzip-chunks', chunks };
    this.writeUniqueJson(this.referencePath(domain, contentHash), reference);
    this.writtenPayloads.set(`${domain}:${contentHash}`, clone(reference));
    return reference;
  }

  private writePayloadBytes(domain: 'public' | 'private', bytes: Buffer, encoding: SessionPayloadReference['encoding']): SessionPayloadReference {
    if (bytes.length > MAX_PAYLOAD_BYTES) throw new SessionError('payload_too_large', `A single Session payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
    const contentHash = sha256Bytes(bytes);
    const cached = this.writtenPayloads.get(`${domain}:${contentHash}`);
    if (cached) return clone(cached);
    const existing = this.tryReadPayloadReference(domain, contentHash);
    if (existing) { this.validatePayload(existing); this.writtenPayloads.set(`${domain}:${contentHash}`, clone(existing)); return existing; }
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < bytes.length || (offset === 0 && bytes.length === 0); offset += CHUNK_BYTES) {
      chunks.push(Buffer.from(bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK_BYTES))));
      if (bytes.length === 0) break;
    }
    return this.writeCompressedChunks(domain, contentHash, bytes.length, chunks, encoding);
  }

  private writeCompressedChunks(domain: 'public' | 'private', contentHash: string, logicalBytes: number, rawChunks: readonly Buffer[], encoding: SessionPayloadReference['encoding']): SessionPayloadReference {
    const chunks = [] as SessionPayloadReference['chunks'];
    let compressedBytes = 0;
    for (const raw of rawChunks) {
      const compressed = gzipSync(raw, { level: this.gzipLevel });
      const hash = sha256Bytes(compressed);
      const path = this.chunkPath(domain, hash);
      if (!existsSync(path)) this.writeUniqueBuffer(path, compressed);
      else if (!hashesEqual(sha256Bytes(readFileSync(assertSafeInputFile(this.safeRoot, path))), hash)) throw new SessionError('payload_hash_mismatch', `Existing payload chunk ${hash} is corrupt`);
      chunks.push({ hash, compressedBytes: compressed.length });
      compressedBytes += compressed.length;
    }
    const reference: SessionPayloadReference = {
      domain, contentHash, logicalBytes, compressedBytes, encoding, chunks,
    };
    this.writeUniqueJson(this.referencePath(domain, contentHash), reference);
    this.writtenPayloads.set(`${domain}:${contentHash}`, clone(reference));
    return clone(reference);
  }

  public payloadReferenceByHash(domain: 'public' | 'private', contentHash: string): SessionPayloadReference {
    if (!isSha256(contentHash)) throw new SessionError('payload_reference_invalid', 'Payload content hash is invalid');
    const reference = this.tryReadPayloadReference(domain, contentHash);
    if (!reference) throw new SessionError('payload_missing', `Payload ${contentHash} is missing`);
    this.validatePayload(reference);
    return reference;
  }

  public validatePayload(reference: SessionPayloadReference): void {
    this.validateReferenceShape(reference);
    const logicalLimit = reference.encoding === 'utf8+gzip-chunks' ? MAX_STREAM_PAYLOAD_BYTES : MAX_PAYLOAD_BYTES;
    const logicalHash = createHash('sha256');
    let logicalBytes = 0;
    let compressedBytes = 0;
    for (const chunk of reference.chunks) {
      const path = this.chunkPath(reference.domain, chunk.hash);
      if (!existsSync(path) || !statSync(assertSafeInputFile(this.safeRoot, path)).isFile()) throw new SessionError('payload_missing', `Payload chunk ${chunk.hash} is missing`);
      const compressed = readFileSync(assertSafeInputFile(this.safeRoot, path));
      if (compressed.length !== chunk.compressedBytes || !hashesEqual(sha256Bytes(compressed), chunk.hash)) throw new SessionError('payload_hash_mismatch', `Payload chunk ${chunk.hash} hash mismatch`);
      let raw: Buffer;
      try { raw = gunzipSync(compressed); }
      catch { throw new SessionError('payload_corrupt', `Payload chunk ${chunk.hash} is not valid gzip`); }
      if (raw.length > CHUNK_BYTES) throw new SessionError('payload_too_large', 'Decompressed payload chunk exceeds its bound');
      logicalHash.update(raw);
      logicalBytes += raw.length;
      compressedBytes += compressed.length;
      if (logicalBytes > logicalLimit) throw new SessionError('payload_too_large', 'Payload exceeds its logical size bound');
    }
    if (logicalBytes !== reference.logicalBytes || compressedBytes !== reference.compressedBytes || !hashesEqual(logicalHash.digest('hex'), reference.contentHash)) {
      throw new SessionError('payload_hash_mismatch', `Payload ${reference.contentHash} logical hash mismatch`);
    }
  }

  public readPayload<T>(reference: SessionPayloadReference, subject = 'Session payload'): T {
    if (reference.encoding !== 'canonical-json+gzip-chunks') throw new SessionError('payload_reference_invalid', `${subject} is not a canonical JSON payload`);
    this.validatePayload(reference);
    const buffers = reference.chunks.map((chunk) => gunzipSync(readFileSync(assertSafeInputFile(this.safeRoot, this.chunkPath(reference.domain, chunk.hash)))));
    return parseJson<T>(Buffer.concat(buffers, reference.logicalBytes).toString('utf8'), subject);
  }

  public *readNdjsonPayload<T>(reference: SessionPayloadReference, subject = 'Session stream'): Generator<T> {
    if (reference.encoding !== 'utf8+gzip-chunks') throw new SessionError('payload_reference_invalid', `${subject} is not an NDJSON payload`);
    this.validateReferenceShape(reference);
    const logicalHash = createHash('sha256');
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let logicalBytes = 0;
    let compressedBytes = 0;
    for (const chunk of reference.chunks) {
      const path = this.chunkPath(reference.domain, chunk.hash);
      if (!existsSync(path)) throw new SessionError('payload_missing', `${subject} chunk ${chunk.hash} is missing`);
      const compressed = readFileSync(assertSafeInputFile(this.safeRoot, path));
      if (compressed.length !== chunk.compressedBytes || !hashesEqual(sha256Bytes(compressed), chunk.hash)) throw new SessionError('payload_hash_mismatch', `${subject} chunk ${chunk.hash} hash mismatch`);
      let raw: Buffer;
      try { raw = gunzipSync(compressed); } catch { throw new SessionError('payload_corrupt', `${subject} chunk ${chunk.hash} is invalid gzip`); }
      if (raw.length > CHUNK_BYTES) throw new SessionError('payload_too_large', `${subject} decompressed chunk exceeds its bound`);
      logicalHash.update(raw); logicalBytes += raw.length; compressedBytes += compressed.length;
      if (logicalBytes > reference.logicalBytes) throw new SessionError('payload_too_large', `${subject} exceeds its declared logical size`);
      pending += decoder.write(raw);
      if (Buffer.byteLength(pending, 'utf8') > MAX_TRACE_LINE_BYTES && !pending.includes('\n')) throw new SessionError('payload_too_large', `${subject} contains an oversized record`);
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, '');
        pending = pending.slice(newline + 1);
        if (line) yield parseJson<T>(line, subject);
      }
    }
    pending += decoder.end();
    if (pending.replace(/\r$/u, '')) yield parseJson<T>(pending.replace(/\r$/u, ''), subject);
    if (logicalBytes !== reference.logicalBytes || compressedBytes !== reference.compressedBytes || !hashesEqual(logicalHash.digest('hex'), reference.contentHash)) throw new SessionError('payload_hash_mismatch', `${subject} logical hash mismatch`);
  }

  public writePrivateState(state: JsonValue): SessionPayloadReference {
    if (state === null || typeof state !== 'object' || Array.isArray(state)) return this.writePayload('private', { body: state, map: null, events: [] } satisfies SessionPrivateEnvelope);
    const source = clone(state) as Record<string, JsonValue>;
    const mapValue = Object.prototype.hasOwnProperty.call(source, 'map') ? source.map : undefined;
    const eventValue = Array.isArray(source.events) ? source.events : [];
    delete source.map;
    delete source.events;
    const envelope: SessionPrivateEnvelope = {
      body: source as JsonValue,
      map: mapValue === undefined ? null : this.writePayload('private', mapValue),
      events: Array.from({ length: Math.ceil(eventValue.length / PRIVATE_EVENT_BLOCK_SIZE) }, (_, index) => this.writePayload('private', eventValue.slice(index * PRIVATE_EVENT_BLOCK_SIZE, (index + 1) * PRIVATE_EVENT_BLOCK_SIZE))),
    };
    return this.writePayload('private', envelope);
  }

  public readPrivateState(reference: SessionPayloadReference): JsonValue {
    const envelope = this.readPayload<SessionPrivateEnvelope>(reference, 'Private State envelope');
    ensureObject(envelope, 'Private State envelope');
    if (!Array.isArray(envelope.events) || !(envelope.map === null || (envelope.map !== undefined && typeof envelope.map === 'object' && !Array.isArray(envelope.map)))) throw new SessionError('session_corrupt', 'Private State envelope references are invalid');
    const body = clone(envelope.body);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
    const restored = body as Record<string, JsonValue>;
    if (envelope.map) restored.map = this.readPayload<JsonValue>(envelope.map, 'Private map');
    restored.events = envelope.events.flatMap((eventBlock, index) => {
      const events = this.readPayload<JsonValue[]>(eventBlock, `Private event block ${index}`);
      if (!Array.isArray(events) || events.length > PRIVATE_EVENT_BLOCK_SIZE) throw new SessionError('session_corrupt', 'Private event block is invalid');
      return events;
    });
    return restored as JsonValue;
  }

  public create(descriptor: SessionDescriptor, runBase: SessionRunBase, privateState: JsonValue, publicState: SessionPublicState, inheritedCounts: { acceptedActionCount: number; invalidActionCount: number } = { acceptedActionCount: 0, invalidActionCount: 0 }): ActiveCommit {
    const directory = this.sessionDirectory(descriptor.sessionId);
    const existingEntries = existsSync(directory) ? readdirSync(assertSafeInputDirectory(this.safeRoot, directory)).filter((entry) => entry !== '.active-lock') : [];
    if (existsSync(join(directory, 'session.json')) || existingEntries.length > 0) throw new SessionError('session_exists', `Refusing to overwrite non-empty Session ${descriptor.sessionId}`);
    ensureSafeOutputDirectory(this.safeRoot, directory);
    for (const child of ['commits', 'public/decisions', 'checkpoints', 'diagnostics']) ensureSafeOutputDirectory(this.safeRoot, join(directory, child));
    this.writeUniqueJson(join(directory, 'session.json'), descriptor);
    this.writeUniqueJson(join(directory, 'run.partial.json'), runBase);
    writeFileSync(assertSafeOutputPath(this.safeRoot, join(directory, 'trace.ndjson')), '', { encoding: 'utf8', flag: 'wx' });
    return this.commit({
      descriptor, previous: null, privateState, publicState,
      acceptedActionCount: inheritedCounts.acceptedActionCount, invalidActionCount: inheritedCounts.invalidActionCount,
      baselineDecision: descriptor.branchBase?.baseDecision ?? 0,
      baselineTraceHeadHash: descriptor.branchBase?.baseTraceHeadHash ?? ZERO_HASH,
      forcePublicSnapshot: true,
    });
  }

  public load(sessionId: string): LoadedSession {
    const directory = this.sessionDirectory(sessionId);
    const descriptor = this.readDescriptor(directory);
    this.validateBranchBase(descriptor);
    const runBase = parseJson<SessionRunBase>(readFileSync(assertSafeInputFile(this.safeRoot, join(directory, 'run.partial.json')), 'utf8'), 'run.partial.json');
    ensureObject(runBase, 'run.partial.json');
    if (runBase.sessionId !== descriptor.sessionId || runBase.buildId !== descriptor.buildId || runBase.runBaseIntegrityHash !== integrityHash(runBase as unknown as Record<string, unknown>, 'runBaseIntegrityHash')) {
      throw new SessionError('session_corrupt', 'run.partial.json does not match session.json or its integrity hash');
    }
    this.validatePayload(runBase.fixedMap);
    this.validatePayload(runBase.initialPublicState);
    const active = this.readLatestCommit(directory, descriptor);
    const privateState = this.readPrivateState(active.privateState);
    const publicState = this.readPublicState(active.publicState, active);
    let lastDecision: PublicDecisionRecord | null = null;
    for (const record of this.iterateLocalDecisionRecords(directory, descriptor, active, descriptor.branchBase?.basePublicSnapshotHash ?? runBase.initialPublicHash)) lastDecision = record;
    return { directory, descriptor, runBase, active, privateState, publicState, lastDecision };
  }

  /**
   * Reads only the immutable descriptor and newest Active commit. SessionService
   * uses this CAS identity to continue a state it already validated and wrote.
   * Any independently committed generation forces the next call through load().
   */
  public readCurrentHead(sessionId: string): { directory: string; descriptor: SessionDescriptor; active: ActiveCommit } {
    const directory = this.sessionDirectory(sessionId);
    const descriptor = this.readDescriptor(directory);
    return { directory, descriptor, active: this.readLatestCommit(directory, descriptor) };
  }

  public commit(input: CommitInput): ActiveCommit {
    const directory = this.sessionDirectory(input.descriptor.sessionId);
    const generation = (input.previous?.generation ?? -1) + 1;
    const baseDecision = input.descriptor.branchBase?.baseDecision ?? input.baselineDecision ?? 0;
    const baseHead = input.descriptor.branchBase?.baseTraceHeadHash ?? input.baselineTraceHeadHash ?? ZERO_HASH;
    const decision = input.decisionRecord?.decision ?? input.previous?.decision ?? baseDecision;
    const traceHeadHash = input.decisionRecord?.decisionHash ?? input.previous?.traceHeadHash ?? baseHead;
    const localDecisionCount = (input.previous?.localDecisionCount ?? 0) + (input.decisionRecord ? 1 : 0);
    if (input.decisionRecord) {
      const expectedPrevious = input.previous?.traceHeadHash ?? baseHead;
      if (input.decisionRecord.decision !== (input.previous?.decision ?? baseDecision) + 1 || input.decisionRecord.previousDecisionHash !== expectedPrevious) throw new SessionError('trace_chain_invalid', 'Decision does not continue the local chain');
      const { decisionHash: _decisionHash, ...withoutHash } = input.decisionRecord;
      if (!hashesEqual(decisionHash(withoutHash), input.decisionRecord.decisionHash)) throw new SessionError('trace_chain_invalid', 'Decision hash is invalid');
      this.validatePayload(input.decisionRecord.publicPayload);
    }

    const privateReference = this.writePrivateState(input.privateState);
    this.faultInjector?.('after-private-state-write');
    const publicReference = this.writePublicHead(input.publicState, input.previous?.publicState ?? null, input.decisionRecord, input.forcePublicSnapshot === true);
    this.faultInjector?.('after-public-state-write');

    if (input.decisionRecord) {
      const path = join(directory, 'public/decisions', `d${this.pad(input.decisionRecord.decision)}-${input.decisionRecord.decisionHash}.json`);
      const text = `${canonicalJson(input.decisionRecord)}\n`;
      if (existsSync(path)) {
        if (readFileSync(assertSafeInputFile(this.safeRoot, path), 'utf8') !== text) throw new SessionError('trace_chain_invalid', 'Existing orphan Decision differs from retry');
      } else this.writeUniqueText(path, text);
      this.faultInjector?.('after-decision-write');
      const tracePath = join(directory, 'trace.ndjson');
      const committedCount = input.previous?.localDecisionCount ?? 0;
      let trailingLine: string | null = null;
      let traceIndex = 0;
      for (const line of this.traceLines(tracePath)) {
        if (traceIndex === committedCount) trailingLine = line;
        else if (traceIndex > committedCount) throw new SessionError('trace_chain_invalid', 'trace.ndjson contains more than one uncommitted Decision');
        traceIndex += 1;
      }
      if (traceIndex < committedCount) throw new SessionError('trace_chain_invalid', 'trace.ndjson is shorter than the committed local chain');
      if (trailingLine !== null) {
        if (trailingLine !== text.trimEnd()) throw new SessionError('trace_chain_invalid', 'Existing trace.ndjson orphan Decision differs from retry');
      } else {
        const fd = openSync(assertSafeInputFile(this.safeRoot, tracePath), 'a');
        try { appendFileSync(fd, text, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
      }
      this.faultInjector?.('after-trace-append');
    }

    const withoutHash = {
      sessionSchemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: input.descriptor.sessionId,
      generation,
      revision: decision,
      decision,
      localDecisionCount,
      completedTurn: completedTurn(input.publicState),
      currentTurn: input.publicState.observation.turn,
      phase: input.publicState.observation.phase,
      traceHeadHash,
      publicDocumentHash: input.publicState.documentHash,
      privateState: privateReference,
      publicState: publicReference,
      gameOver: input.publicState.gameOver,
      result: clone(input.publicState.result),
      acceptedActionCount: input.acceptedActionCount,
      invalidActionCount: input.invalidActionCount,
      committedAt: new Date().toISOString(),
    } satisfies Omit<ActiveCommit, 'commitIntegrityHash'>;
    const commit: ActiveCommit = { ...withoutHash, commitIntegrityHash: sha256Json(withoutHash) };
    this.faultInjector?.('before-active-commit');
    this.writeUniqueJson(join(directory, 'commits', `g${this.pad(generation)}-d${this.pad(decision)}-${randomUUID()}.json`), commit);
    return clone(commit);
  }

  private writePublicHead(state: SessionPublicState, previousHeadReference: SessionPayloadReference | null, record: PublicDecisionRecord | undefined, forceSnapshot: boolean): SessionPayloadReference {
    let snapshot: SessionPayloadReference;
    let diffs: SessionPayloadReference[] = [];
    if (!previousHeadReference || forceSnapshot || !record || record.publicPayloadKind === 'snapshot') {
      const payload: SessionPublicSnapshotPayload = { kind: 'snapshot', document: documentOf(state), documentHash: state.documentHash };
      snapshot = this.writePayload('public', payload);
    } else {
      const previous = this.readPayload<SessionPublicHead>(previousHeadReference, 'Previous Public head');
      snapshot = previous.snapshot;
      diffs = [...previous.diffs, record.publicPayload];
      if (diffs.length >= PUBLIC_SNAPSHOT_INTERVAL) {
        const payload: SessionPublicSnapshotPayload = { kind: 'snapshot', document: documentOf(state), documentHash: state.documentHash };
        snapshot = this.writePayload('public', payload);
        diffs = [];
      }
    }
    return this.writePayload('public', { kind: 'head', decision: state.decision, traceHeadHash: state.traceHeadHash, documentHash: state.documentHash, snapshot, diffs } satisfies SessionPublicHead);
  }

  private readPublicState(reference: SessionPayloadReference, active?: ActiveCommit): SessionPublicState {
    const head = this.readPayload<SessionPublicHead>(reference, 'Public State head');
    ensureObject(head, 'Public State head');
    if (head.kind !== 'head' || !Array.isArray(head.diffs) || head.diffs.length >= PUBLIC_SNAPSHOT_INTERVAL) throw new SessionError('public_snapshot_invalid', 'Public State head is invalid');
    const snapshot = this.readPayload<SessionPublicSnapshotPayload>(head.snapshot, 'Public Snapshot');
    if (snapshot.kind !== 'snapshot' || sha256Json(snapshot.document) !== snapshot.documentHash) throw new SessionError('public_snapshot_invalid', 'Public Snapshot hash mismatch');
    let document = clone(snapshot.document) as unknown as JsonValue;
    let documentHash = snapshot.documentHash;
    for (const diffReference of head.diffs) {
      const diff = this.readPayload<SessionPublicDiffPayload>(diffReference, 'Public diff');
      if (diff.kind !== 'diff' || diff.beforeDocumentHash !== documentHash) throw new SessionError('public_diff_invalid', 'Public diff chain has the wrong base');
      document = applyLosslessJsonDiff(document, diff.operations);
      documentHash = sha256Json(document);
      if (documentHash !== diff.afterDocumentHash) throw new SessionError('public_diff_invalid', 'Public diff reconstructed the wrong hash');
    }
    if (documentHash !== head.documentHash) throw new SessionError('public_diff_invalid', 'Public head hash does not match reconstructed state');
    const doc = document as unknown as SessionPublicDocument;
    const state: SessionPublicState = { ...doc, decision: head.decision, traceHeadHash: head.traceHeadHash, documentHash };
    if (active && (state.decision !== active.decision || state.traceHeadHash !== active.traceHeadHash || state.documentHash !== active.publicDocumentHash || state.observation.turn !== active.currentTurn || state.observation.phase !== active.phase)) {
      throw new SessionError('session_corrupt', 'Public State does not match Active commit');
    }
    return state;
  }

  public writeCheckpoint(loaded: LoadedSession, metadataWithoutHashes: Omit<SessionCheckpointMetadata, 'privateState' | 'publicState' | 'publicDocumentHash' | 'metadataIntegrityHash'>): SessionCheckpointMetadata {
    assertSafeIdentifier(metadataWithoutHashes.checkpointId, 'checkpointId');
    const path = join(loaded.directory, 'checkpoints', `${metadataWithoutHashes.checkpointId}${CHECKPOINT_META_SUFFIX}`);
    if (existsSync(path)) throw new SessionError('checkpoint_exists', `Checkpoint ${metadataWithoutHashes.checkpointId} already exists`);
    this.validatePayload(loaded.active.privateState);
    this.faultInjector?.('after-checkpoint-private-write');
    const publicState = this.writePublicHead(loaded.publicState, null, undefined, true);
    this.faultInjector?.('after-checkpoint-public-write');
    const withoutHash = { ...metadataWithoutHashes, privateState: loaded.active.privateState, publicState, publicDocumentHash: loaded.publicState.documentHash } satisfies Omit<SessionCheckpointMetadata, 'metadataIntegrityHash'>;
    const metadata: SessionCheckpointMetadata = { ...withoutHash, metadataIntegrityHash: sha256Json(withoutHash) };
    this.faultInjector?.('before-checkpoint-metadata');
    this.writeUniqueJson(path, metadata);
    return clone(metadata);
  }

  public listCheckpoints(sessionId: string): SessionCheckpointMetadata[] {
    const directory = this.sessionDirectory(sessionId);
    const descriptor = this.readDescriptor(directory);
    const checkpointDirectory = join(directory, 'checkpoints');
    return readdirSync(assertSafeInputDirectory(this.safeRoot, checkpointDirectory)).filter((name) => name.endsWith(CHECKPOINT_META_SUFFIX)).map((name) => this.readCheckpointMetadata(directory, descriptor, join(checkpointDirectory, name))).sort((a, b) => a.decision - b.decision || a.checkpointId.localeCompare(b.checkpointId));
  }

  public loadCheckpoint(sessionId: string, checkpointId: string): { source: LoadedSession; metadata: SessionCheckpointMetadata; privateState: JsonValue; publicState: SessionPublicState } {
    assertSafeIdentifier(checkpointId, 'checkpointId');
    const directory = this.sessionDirectory(sessionId);
    const descriptor = this.readDescriptor(directory);
    this.validateBranchBase(descriptor);
    const runBase = parseJson<SessionRunBase>(readFileSync(assertSafeInputFile(this.safeRoot, join(directory, 'run.partial.json')), 'utf8'), 'run.partial.json');
    ensureObject(runBase, 'run.partial.json');
    if (runBase.sessionId !== descriptor.sessionId || runBase.buildId !== descriptor.buildId || runBase.runBaseIntegrityHash !== integrityHash(runBase as unknown as Record<string, unknown>, 'runBaseIntegrityHash')) throw new SessionError('session_corrupt', 'run.partial.json does not match session.json or its integrity hash');
    this.validatePayload(runBase.fixedMap);
    this.validatePayload(runBase.initialPublicState);
    const metadata = this.readCheckpointMetadata(directory, descriptor, join(directory, 'checkpoints', `${checkpointId}${CHECKPOINT_META_SUFFIX}`));
    const privateState = this.readPrivateState(metadata.privateState);
    const publicState = this.readPublicState(metadata.publicState);
    if (publicState.decision !== metadata.decision || publicState.traceHeadHash !== metadata.publicTraceHeadHash || publicState.documentHash !== metadata.publicDocumentHash) throw new SessionError('checkpoint_corrupt', 'Checkpoint Public State does not match metadata');
    let head = ZERO_HASH;
    let count = 0;
    for (const record of this.iterateAllDecisionRecords(sessionId, metadata.decision)) { head = record.decisionHash; count += 1; }
    if (count !== metadata.decision) throw new SessionError('checkpoint_corrupt', 'Checkpoint history range is incomplete');
    if (head !== metadata.publicTraceHeadHash) throw new SessionError('checkpoint_corrupt', 'Checkpoint trace head does not match history');
    const pseudoActive = { decision: metadata.decision, traceHeadHash: metadata.publicTraceHeadHash, publicDocumentHash: metadata.publicDocumentHash } as ActiveCommit;
    return { source: { directory, descriptor, runBase, active: pseudoActive, privateState, publicState, lastDecision: null }, metadata, privateState, publicState };
  }

  /** Explicit compatibility helper. Normal load/query/export use the iterator. */
  public readAllDecisionRecords(sessionId: string, throughDecision?: number): PublicDecisionRecord[] {
    return [...this.iterateAllDecisionRecords(sessionId, throughDecision)];
  }

  public *iterateAllDecisionRecords(sessionId: string, throughDecision?: number): Generator<PublicDecisionRecord> {
    const directory = this.sessionDirectory(sessionId);
    const descriptor = this.readDescriptor(directory);
    const active = this.readLatestCommit(directory, descriptor);
    const limit = throughDecision ?? active.decision;
    if (descriptor.branchBase) {
      for (const record of this.iterateAncestorRecords(descriptor)) {
        if (record.decision > limit) return;
        yield record;
      }
    }
    let localBasePublicHash = descriptor.branchBase?.basePublicSnapshotHash;
    if (!localBasePublicHash) {
      const runBase = parseJson<SessionRunBase>(readFileSync(assertSafeInputFile(this.safeRoot, join(directory, 'run.partial.json')), 'utf8'), 'run.partial.json');
      localBasePublicHash = runBase.initialPublicHash;
    }
    for (const record of this.iterateLocalDecisionRecords(directory, descriptor, active, localBasePublicHash)) {
      if (record.decision > limit) return;
      yield record;
    }
  }

  public createAncestorManifest(sourceSessionId: string, throughDecision: number, publicHash: string): SessionPayloadReference {
    return this.createAncestorManifestDetails(sourceSessionId, throughDecision, publicHash).reference;
  }

  public createAncestorManifestDetails(sourceSessionId: string, throughDecision: number, publicHash: string): { reference: SessionPayloadReference; acceptedActionCount: number; invalidActionCount: number } {
    const sourceDescriptor = this.readDescriptor(this.sessionDirectory(sourceSessionId));
    let decisionCount = 0;
    let acceptedActionCount = 0;
    let invalidActionCount = 0;
    let head = ZERO_HASH;
    const self = this;
    function *entries(): Generator<SessionAncestorEntry> {
      for (const record of self.iterateAllDecisionRecords(sourceSessionId, throughDecision)) {
        decisionCount += 1; head = record.decisionHash;
        if (record.accepted) acceptedActionCount += 1; else invalidActionCount += 1;
        yield { sessionId: sourceDescriptor.sessionId, decision: record.decision, decisionHash: record.decisionHash, previousDecisionHash: record.previousDecisionHash, record: self.writePayload('public', record) };
      }
    }
    const decisionEntries = this.writeNdjsonPayload('public', entries());
    if (decisionCount !== throughDecision) throw new SessionError('ancestor_manifest_invalid', 'Ancestor history range is incomplete');
    const withoutHash = {
      sessionSchemaVersion: SESSION_SCHEMA_VERSION,
      rootSessionId: sourceDescriptor.branchBase?.rootSessionId ?? sourceDescriptor.sessionId,
      baseDecision: throughDecision,
      baseTraceHeadHash: head,
      basePublicSnapshotHash: publicHash,
      decisionCount,
      decisionEntries,
    } satisfies Omit<SessionAncestorManifest, 'ancestorManifestHash'>;
    const reference = this.writePayload('public', { ...withoutHash, ancestorManifestHash: sha256Json(withoutHash) } satisfies SessionAncestorManifest);
    return { reference, acceptedActionCount, invalidActionCount };
  }

  public recordDiagnostic(sessionId: string, kind: SessionDiagnosticEventKind, operation: string): void {
    const directory = this.sessionDirectory(sessionId);
    if (!existsSync(join(directory, 'session.json'))) return;
    const withoutHash = { sessionSchemaVersion: SESSION_SCHEMA_VERSION, sessionId, eventId: randomUUID(), kind, operation, recordedAt: new Date().toISOString() } satisfies Omit<SessionDiagnosticEvent, 'integrityHash'>;
    this.writeUniqueJson(join(directory, 'diagnostics', `${withoutHash.eventId}.json`), { ...withoutHash, integrityHash: sha256Json(withoutHash) } satisfies SessionDiagnosticEvent);
  }

  public readSessionMetrics(sessionId: string): SessionMetrics {
    const metrics: SessionMetrics = { activeSessionResumes: 0, manualCheckpointsCreated: 0, periodicCheckpointsCreated: 0, finalCheckpointsCreated: 0, branchedSessionsCreated: 0, hashRejections: 0, versionRejections: 0, buildRejections: 0, corruptionRejections: 0, invalidDecisions: 0, inputFormatRejections: 0, staleRevisionRejections: 0, diagnosticIntegrityErrors: 0 };
    const directory = join(this.sessionDirectory(sessionId), 'diagnostics');
    if (!existsSync(directory)) return metrics;
    const fields: Record<SessionDiagnosticEventKind, keyof SessionMetrics> = { activeSessionResumed: 'activeSessionResumes', manualCheckpointCreated: 'manualCheckpointsCreated', periodicCheckpointCreated: 'periodicCheckpointsCreated', finalCheckpointCreated: 'finalCheckpointsCreated', branchedSessionCreated: 'branchedSessionsCreated', hashRejected: 'hashRejections', versionRejected: 'versionRejections', buildRejected: 'buildRejections', corruptionRejected: 'corruptionRejections', invalidDecision: 'invalidDecisions', inputFormatRejected: 'inputFormatRejections', staleRevisionRejected: 'staleRevisionRejections' };
    for (const name of readdirSync(assertSafeInputDirectory(this.safeRoot, directory)).filter((candidate) => candidate.endsWith('.json'))) {
      try {
        const event = parseJson<SessionDiagnosticEvent>(readFileSync(assertSafeInputFile(this.safeRoot, join(directory, name)), 'utf8'), `Diagnostic ${name}`);
        const expected = integrityHash(event as unknown as Record<string, unknown>, 'integrityHash');
        if (event.sessionSchemaVersion !== SESSION_SCHEMA_VERSION || event.sessionId !== sessionId || !hashesEqual(expected, event.integrityHash) || !(event.kind in fields)) metrics.diagnosticIntegrityErrors += 1;
        else metrics[fields[event.kind]] += 1;
      } catch { metrics.diagnosticIntegrityErrors += 1; }
    }
    return metrics;
  }

  public getDescriptor(sessionId: string): SessionDescriptor { return this.readDescriptor(this.sessionDirectory(sessionId)); }

  private ensureStoreManifest(): SessionStoreManifest {
    const path = join(this.sessionsRoot, STORE_MANIFEST);
    if (!existsSync(path)) {
      const withoutHash = { storeSchemaVersion: SESSION_STORE_SCHEMA_VERSION, storeId: randomUUID(), publicPoolPath: 'pool/public', privatePoolPath: 'pool/private', chunkBytes: CHUNK_BYTES, createdAt: new Date().toISOString() } satisfies Omit<SessionStoreManifest, 'manifestIntegrityHash'>;
      try { this.writeUniqueJson(path, { ...withoutHash, manifestIntegrityHash: sha256Json(withoutHash) }); }
      catch (error) { if (!existsSync(path)) throw error; }
    }
    const manifest = parseJson<SessionStoreManifest>(readFileSync(assertSafeInputFile(this.safeRoot, path), 'utf8'), STORE_MANIFEST);
    const expected = integrityHash(manifest as unknown as Record<string, unknown>, 'manifestIntegrityHash');
    if (manifest.storeSchemaVersion !== SESSION_STORE_SCHEMA_VERSION || manifest.chunkBytes !== CHUNK_BYTES || !hashesEqual(expected, manifest.manifestIntegrityHash)) throw new SessionError('store_manifest_invalid', 'Session Store manifest is unsupported or corrupt');
    assertSafeIdentifier(manifest.storeId, 'storeId');
    ensureSafeOutputDirectory(this.safeRoot, join(this.sessionsRoot, 'pool/public'));
    ensureSafeOutputDirectory(this.safeRoot, join(this.sessionsRoot, 'pool/private'));
    return manifest;
  }

  private readDescriptor(directory: string): SessionDescriptor {
    const path = join(directory, 'session.json');
    if (!existsSync(path)) throw new SessionError('session_not_found', `No Session exists at ${directory}`);
    const descriptor = parseJson<SessionDescriptor>(readFileSync(assertSafeInputFile(this.safeRoot, path), 'utf8'), 'session.json');
    ensureObject(descriptor, 'session.json');
    if (descriptor.sessionSchemaVersion !== SESSION_SCHEMA_VERSION || descriptor.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION) throw new SessionError('session_version_mismatch', 'Session or Checkpoint Schema Version is unsupported');
    assertSafeIdentifier(descriptor.sessionId, 'sessionId');
    if (descriptor.storeId !== this.manifest.storeId) throw new SessionError('session_corrupt', 'Session belongs to a different Store');
    const expected = integrityHash(descriptor as unknown as Record<string, unknown>, 'descriptorIntegrityHash');
    if (!hashesEqual(expected, descriptor.descriptorIntegrityHash)) throw new SessionError('session_corrupt', 'session.json integrity hash mismatch');
    if ((descriptor.parentSessionId === null) !== (descriptor.branchBase === null)) throw new SessionError('session_corrupt', 'Root/branch lineage fields are inconsistent');
    return descriptor;
  }

  private validateBranchBase(descriptor: SessionDescriptor): void {
    if (!descriptor.branchBase) return;
    const manifest = this.readAncestorManifest(descriptor);
    const base = descriptor.branchBase;
    if (manifest.rootSessionId !== base.rootSessionId || manifest.baseDecision !== base.baseDecision || manifest.baseTraceHeadHash !== base.baseTraceHeadHash || manifest.basePublicSnapshotHash !== base.basePublicSnapshotHash) throw new SessionError('ancestor_manifest_invalid', 'Ancestor Manifest does not match branchBase');
    for (const _record of this.iterateAncestorRecords(descriptor, manifest)) { /* streamed validation */ }
  }

  private readAncestorManifest(descriptor: SessionDescriptor): SessionAncestorManifest {
    const base = descriptor.branchBase;
    if (!base) throw new SessionError('ancestor_manifest_invalid', 'Root Session has no ancestor manifest');
    const manifest = this.readPayload<SessionAncestorManifest>(this.payloadReferenceByHash('public', base.ancestorManifestHash), 'Ancestor Manifest');
    const { ancestorManifestHash: _hash, ...withoutHash } = manifest;
    if (!hashesEqual(sha256Json(withoutHash), manifest.ancestorManifestHash)) throw new SessionError('ancestor_manifest_invalid', 'Ancestor Manifest hash mismatch');
    if (manifest.decisionCount !== manifest.baseDecision) throw new SessionError('ancestor_manifest_invalid', 'Ancestor Manifest range has a gap or overlap');
    return manifest;
  }

  private *iterateAncestorRecords(descriptor: SessionDescriptor, suppliedManifest?: SessionAncestorManifest): Generator<PublicDecisionRecord> {
    const manifest = suppliedManifest ?? this.readAncestorManifest(descriptor);
    let count = 0;
    let head = ZERO_HASH;
    let publicHash: string | null = null;
    for (const entry of this.readNdjsonPayload<SessionAncestorEntry>(manifest.decisionEntries, 'Ancestor Decision entries')) {
      count += 1;
      if (entry.decision !== count || entry.previousDecisionHash !== head) throw new SessionError('ancestor_manifest_invalid', 'Ancestor Manifest chain is not contiguous');
      const record = this.readPayload<PublicDecisionRecord>(entry.record, `Ancestor Decision ${entry.decision}`);
      const { decisionHash: _decisionHash, ...recordWithoutHash } = record;
      if (record.decision !== entry.decision || record.previousDecisionHash !== entry.previousDecisionHash || record.decisionHash !== entry.decisionHash || !hashesEqual(decisionHash(recordWithoutHash), record.decisionHash)) throw new SessionError('ancestor_manifest_invalid', 'Ancestor Decision record does not match its manifest');
      if (publicHash !== null && record.beforePublicHash !== publicHash) throw new SessionError('ancestor_manifest_invalid', 'Ancestor public hash chain is not contiguous');
      this.validateDecisionPublicPayload(record);
      publicHash = record.afterPublicHash;
      head = entry.decisionHash;
      yield record;
    }
    if (count !== manifest.decisionCount || head !== manifest.baseTraceHeadHash || (count > 0 && publicHash !== manifest.basePublicSnapshotHash)) throw new SessionError('ancestor_manifest_invalid', 'Ancestor Manifest head, public hash, or range is inconsistent');
  }

  private readLatestCommit(directory: string, descriptor: SessionDescriptor): ActiveCommit {
    const commitDirectory = assertSafeInputDirectory(this.safeRoot, join(directory, 'commits'));
    let latest: { name: string; generation: number; decision: number } | null = null;
    const handle = opendirSync(commitDirectory);
    try {
      while (true) {
        const entry = handle.readSync();
        if (!entry) break;
        if (!entry.isFile()) continue;
        const match = COMMIT_FILE_PATTERN.exec(entry.name);
        if (!match) continue;
        const generation = Number(match[1]);
        if (!latest || generation > latest.generation) latest = { name: entry.name, generation, decision: Number(match[2]) };
      }
    } finally { handle.closeSync(); }
    if (!latest) throw new SessionError('session_corrupt', 'Session has no committed Active generation');
    const commit = parseJson<ActiveCommit>(readFileSync(assertSafeInputFile(this.safeRoot, join(commitDirectory, latest.name)), 'utf8'), 'Active commit');
    if (commit.sessionId !== descriptor.sessionId || commit.sessionSchemaVersion !== SESSION_SCHEMA_VERSION || commit.generation !== latest.generation || commit.revision !== commit.decision || commit.decision !== latest.decision) throw new SessionError('session_corrupt', 'Active commit does not match Session or filename');
    const expected = integrityHash(commit as unknown as Record<string, unknown>, 'commitIntegrityHash');
    if (!hashesEqual(expected, commit.commitIntegrityHash)) throw new SessionError('session_corrupt', 'Active commit integrity hash mismatch');
    return commit;
  }

  private *iterateLocalDecisionRecords(directory: string, descriptor: SessionDescriptor, active: ActiveCommit, basePublicHash: string): Generator<PublicDecisionRecord> {
    const baseDecision = descriptor.branchBase?.baseDecision ?? 0;
    const baseHash = descriptor.branchBase?.baseTraceHeadHash ?? ZERO_HASH;
    if (active.localDecisionCount === 0) {
      if (active.decision !== baseDecision || active.traceHeadHash !== baseHash || active.publicDocumentHash !== basePublicHash) throw new SessionError('trace_chain_invalid', 'Empty local chain does not end at its branch base');
      return;
    }
    let count = 0;
    let previousHash = baseHash;
    let previousPublicHash = basePublicHash;
    for (const line of this.traceLines(join(directory, 'trace.ndjson'))) {
      if (count >= active.localDecisionCount) break;
      const record = parseJson<PublicDecisionRecord>(line, `trace Decision ${baseDecision + count + 1}`);
      const { decisionHash: _hash, ...withoutHash } = record;
      const expectedDecision = baseDecision + count + 1;
      if (record.decision !== expectedDecision || record.previousDecisionHash !== previousHash || !hashesEqual(decisionHash(withoutHash), record.decisionHash)) throw new SessionError('trace_chain_invalid', `trace.ndjson Decision ${expectedDecision} does not continue the local chain`);
      if (record.beforePublicHash !== previousPublicHash) throw new SessionError('trace_chain_invalid', `trace.ndjson Decision ${expectedDecision} does not continue the public hash chain`);
      const path = join(directory, 'public/decisions', `d${this.pad(record.decision)}-${record.decisionHash}.json`);
      if (!existsSync(path) || readFileSync(assertSafeInputFile(this.safeRoot, path), 'utf8') !== `${canonicalJson(record)}\n`) throw new SessionError('trace_chain_invalid', `Decision payload ${record.decision} is missing or differs from trace.ndjson`);
      this.validateDecisionPublicPayload(record);
      previousHash = record.decisionHash;
      previousPublicHash = record.afterPublicHash;
      count += 1;
      yield record;
    }
    if (count !== active.localDecisionCount || previousHash !== active.traceHeadHash || previousPublicHash !== active.publicDocumentHash || active.decision - active.localDecisionCount !== baseDecision) throw new SessionError('trace_chain_invalid', 'Local chain is incomplete or does not terminate at Active head');
  }

  private validateDecisionPublicPayload(record: PublicDecisionRecord): void {
    if (record.publicPayloadKind === 'snapshot') {
      const snapshot = this.readPayload<SessionPublicSnapshotPayload>(record.publicPayload, `Decision ${record.decision} Snapshot`);
      if (snapshot.kind !== 'snapshot' || snapshot.documentHash !== record.afterPublicHash || sha256Json(snapshot.document) !== snapshot.documentHash) throw new SessionError('public_snapshot_invalid', `Decision ${record.decision} Snapshot is invalid`);
      return;
    }
    const diff = this.readPayload<SessionPublicDiffPayload>(record.publicPayload, `Decision ${record.decision} diff`);
    validateLosslessJsonDiffOperations(diff.operations);
    if (diff.kind !== 'diff' || diff.beforeDocumentHash !== record.beforePublicHash || diff.afterDocumentHash !== record.afterPublicHash || (record.publicPayloadKind === 'unchanged' && (diff.operations.length !== 0 || record.beforePublicHash !== record.afterPublicHash))) throw new SessionError('public_diff_invalid', `Decision ${record.decision} diff metadata is invalid`);
  }

  private *traceLines(path: string): Generator<string> {
    if (!existsSync(path)) throw new SessionError('trace_chain_invalid', 'trace.ndjson is missing');
    const fd = openSync(assertSafeInputFile(this.safeRoot, path), 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    try {
      while (true) {
        const bytes = readSync(fd, buffer, 0, buffer.length, null);
        if (bytes === 0) break;
        pending += decoder.write(buffer.subarray(0, bytes));
        if (Buffer.byteLength(pending, 'utf8') > MAX_TRACE_LINE_BYTES && !pending.includes('\n')) throw new SessionError('trace_line_too_large', 'trace.ndjson contains an oversized record');
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).replace(/\r$/u, '');
          pending = pending.slice(newline + 1);
          if (line.length > 0) yield line;
        }
      }
      pending += decoder.end();
      if (pending.replace(/\r$/u, '').length > 0) yield pending.replace(/\r$/u, '');
    } finally { closeSync(fd); }
  }

  private readCheckpointMetadata(directory: string, descriptor: SessionDescriptor, path: string): SessionCheckpointMetadata {
    if (!existsSync(path)) throw new SessionError('checkpoint_not_found', `Checkpoint metadata not found: ${path}`);
    const metadata = parseJson<SessionCheckpointMetadata>(readFileSync(assertSafeInputFile(this.safeRoot, path), 'utf8'), 'Checkpoint metadata');
    if (metadata.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION || metadata.sessionSchemaVersion !== SESSION_SCHEMA_VERSION || metadata.sessionId !== descriptor.sessionId) throw new SessionError('checkpoint_version_mismatch', 'Checkpoint does not match Session Schema');
    const expected = integrityHash(metadata as unknown as Record<string, unknown>, 'metadataIntegrityHash');
    if (!hashesEqual(expected, metadata.metadataIntegrityHash)) throw new SessionError('checkpoint_corrupt', 'Checkpoint metadata integrity hash mismatch');
    for (const field of ['appVersion', 'gameRulesVersion', 'saveFormatVersion', 'artifactSchemaVersion', 'agentApiVersion', 'observationApiVersion', 'bridgeApiVersion', 'buildId', 'gitCommit', 'mapId', 'seed'] as const) {
      if (metadata[field] !== descriptor[field]) throw new SessionError('checkpoint_version_mismatch', `Checkpoint ${field} does not match Session`);
    }
    if (metadata.publicConfigHash !== sha256Json(descriptor.publicConfig)) throw new SessionError('checkpoint_version_mismatch', 'Checkpoint Public Config does not match Session');
    this.validatePayload(metadata.privateState);
    this.validatePayload(metadata.publicState);
    return metadata;
  }

  private validateReferenceShape(reference: SessionPayloadReference): void {
    ensureObject(reference, 'Payload reference');
    const logicalLimit = reference.encoding === 'utf8+gzip-chunks' ? MAX_STREAM_PAYLOAD_BYTES : MAX_PAYLOAD_BYTES;
    if (!['public', 'private'].includes(reference.domain) || !['canonical-json+gzip-chunks', 'utf8+gzip-chunks'].includes(reference.encoding) || !isSha256(reference.contentHash) || !Number.isSafeInteger(reference.logicalBytes) || reference.logicalBytes < 0 || reference.logicalBytes > logicalLimit || !Number.isSafeInteger(reference.compressedBytes) || reference.compressedBytes < 0 || !Array.isArray(reference.chunks) || reference.chunks.length < 1 || reference.chunks.length > Math.ceil(logicalLimit / CHUNK_BYTES) + 1) throw new SessionError('payload_reference_invalid', 'Payload reference is invalid or oversized');
    for (const chunk of reference.chunks) if (!isSha256(chunk.hash) || !Number.isSafeInteger(chunk.compressedBytes) || chunk.compressedBytes < 1 || chunk.compressedBytes > CHUNK_BYTES * 2) throw new SessionError('payload_reference_invalid', 'Payload chunk reference is invalid');
  }

  private tryReadPayloadReference(domain: 'public' | 'private', hash: string): SessionPayloadReference | null {
    const path = this.referencePath(domain, hash);
    if (!existsSync(path)) return null;
    const reference = parseJson<SessionPayloadReference>(readFileSync(assertSafeInputFile(this.safeRoot, path), 'utf8'), `Payload reference ${hash}`);
    if (reference.domain !== domain || reference.contentHash !== hash) throw new SessionError('payload_reference_invalid', `Payload reference ${hash} does not match its index`);
    return reference;
  }

  private chunkPath(domain: 'public' | 'private', hash: string): string { return join(this.sessionsRoot, 'pool', domain, 'chunks', hash.slice(0, 2), `${hash}.gz`); }
  private referencePath(domain: 'public' | 'private', hash: string): string { return join(this.sessionsRoot, 'pool', domain, 'refs', hash.slice(0, 2), `${hash}.json`); }
  private writeUniqueJson(path: string, value: unknown): void { this.writeUniqueText(path, `${canonicalJson(value)}\n`); }
  private writeUniqueText(path: string, text: string): void { this.writeUniqueBuffer(path, Buffer.from(text, 'utf8')); }
  private writeUniqueBuffer(path: string, bytes: Uint8Array): void {
    ensureSafeOutputDirectory(this.safeRoot, dirname(path));
    if (existsSync(path)) throw new SessionError('refusing_overwrite', `Refusing to overwrite ${path}`);
    const pendingDirectory = join(dirname(path), '.pending');
    ensureSafeOutputDirectory(this.safeRoot, pendingDirectory);
    const pending = assertSafeOutputPath(this.safeRoot, join(pendingDirectory, `${randomUUID()}.tmp`));
    const fd = openSync(pending, 'wx');
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(assertSafeInputFile(this.safeRoot, pending), assertSafeOutputPath(this.safeRoot, path));
  }
  private pad(value: number): string {
    if (!Number.isSafeInteger(value) || value < 0 || value > 999_999_999_999) throw new SessionError('session_limit', 'Session counter is out of range');
    return String(value).padStart(12, '0');
  }
}
