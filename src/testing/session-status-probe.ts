import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentSessionGameFactory, resolveSessionIdentity } from '../session/agent-adapter';
import { sha256Json } from '../session/hash';
import { SessionService } from '../session/service';
import { SessionStore } from '../session/store';

type JsonRecord = Record<string, unknown>;

export interface SessionStatusProbeOptions {
  root: string;
  session: string;
  out?: string;
}

export interface SessionStatusProbeReport {
  ok: true;
  root: string;
  session: string;
  elapsedMs: number;
  statusElapsedMs: number;
  fullSnapshotLoadMeasured: true;
  fullSnapshotElapsedMs: number;
  peakRssBytes: number;
  rssBytes: number;
  compactResponseBytes: number;
  revision: number;
  publicObservationLegalSha256: string;
  readBytesDelta: number | null;
  rcharDelta: number | null;
}

interface ProcIoCounters {
  readBytes: number;
  rchar: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a JSON object`);
  return value as JsonRecord;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
  return value;
}

function procIo(): ProcIoCounters | null {
  if (process.platform !== 'linux') return null;
  try {
    const contents = readFileSync('/proc/self/io', 'utf8');
    const readBytes = /^read_bytes:\s+(\d+)$/mu.exec(contents);
    const rchar = /^rchar:\s+(\d+)$/mu.exec(contents);
    if (!readBytes || !rchar) return null;
    return { readBytes: Number(readBytes[1]), rchar: Number(rchar[1]) };
  } catch {
    return null;
  }
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function optionValue(argv: readonly string[], index: number, name: string): { value: string; nextIndex: number } {
  const argument = argv[index]!;
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), nextIndex: index };
  if (argument !== name || index + 1 >= argv.length) fail(`${name} requires a value`);
  return { value: argv[index + 1]!, nextIndex: index + 1 };
}

export function parseSessionStatusProbeArguments(argv: readonly string[]): SessionStatusProbeOptions {
  let root: string | null = null;
  let session: string | null = null;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--help') fail('Usage: session-status-probe.ts --root=path/to/session-root --session=session-id [--out=report.json]');
    if (argument === '--root' || argument.startsWith('--root=')) {
      const option = optionValue(argv, index, '--root');
      index = option.nextIndex;
      root = resolve(option.value);
    } else if (argument === '--session' || argument.startsWith('--session=')) {
      const option = optionValue(argv, index, '--session');
      index = option.nextIndex;
      session = option.value;
    } else if (argument === '--out' || argument.startsWith('--out=')) {
      const option = optionValue(argv, index, '--out');
      index = option.nextIndex;
      out = resolve(option.value);
    } else {
      fail(`Unknown option: ${argument}`);
    }
  }
  if (!root) fail('--root is required');
  if (!session) fail('--session is required');
  if (!existsSync(root)) fail(`Session root does not exist: ${root}`);
  return { root, session, out };
}

export function runSessionStatusProbe(options: SessionStatusProbeOptions): SessionStatusProbeReport {
  const root = resolve(options.root);
  const session = options.session;
  const identity = resolveSessionIdentity(process.env);
  const service = new SessionService(new SessionStore(root), createAgentSessionGameFactory(identity.buildId), identity);
  const ioBefore = procIo();
  const statusStarted = performance.now();
  const status = service.status(session);
  const statusElapsedMs = performance.now() - statusStarted;
  const statusRecord = record(status, 'status');
  const revision = integer(statusRecord.revision, 'status.revision');
  const compactResponseBytes = Buffer.byteLength(JSON.stringify(statusRecord), 'utf8');

  // The full snapshot is a public query used only to hash the complete public
  // Observation and Legal Actions. Its load is measured separately below;
  // neither it nor the compact status is included in the report body.
  const fullStarted = performance.now();
  const fullResponse = service.query(session, { target: 'full-snapshot', expectedRevision: revision });
  const fullSnapshotElapsedMs = performance.now() - fullStarted;
  const fullValue = record(fullResponse.value, 'full-snapshot.value');
  if (integer(fullResponse.revision, 'full-snapshot.revision') !== revision) fail('full-snapshot revision differs from status');
  if (!Object.prototype.hasOwnProperty.call(fullValue, 'observation') || !Object.prototype.hasOwnProperty.call(fullValue, 'legalActions')) {
    fail('full-snapshot did not return public Observation and Legal Actions');
  }
  const publicObservationLegalSha256 = sha256Json({ observation: fullValue.observation, legalActions: fullValue.legalActions });
  const ioAfter = procIo();
  const usage = process.resourceUsage();
  const peakRssBytes = usage.maxRSS * 1024;
  const rssBytes = process.memoryUsage().rss;
  const elapsedMs = statusElapsedMs;
  return {
    ok: true,
    root,
    session,
    elapsedMs: roundMilliseconds(elapsedMs),
    statusElapsedMs: roundMilliseconds(statusElapsedMs),
    fullSnapshotLoadMeasured: true,
    fullSnapshotElapsedMs: roundMilliseconds(fullSnapshotElapsedMs),
    peakRssBytes,
    rssBytes,
    compactResponseBytes,
    revision,
    publicObservationLegalSha256,
    readBytesDelta: ioBefore && ioAfter ? ioAfter.readBytes - ioBefore.readBytes : null,
    rcharDelta: ioBefore && ioAfter ? ioAfter.rchar - ioBefore.rchar : null,
  };
}

export function runCli(argv: readonly string[] = process.argv.slice(2)): number {
  const options = parseSessionStatusProbeArguments(argv);
  const report = runSessionStatusProbe(options);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
