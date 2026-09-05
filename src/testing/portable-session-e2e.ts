import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createAgentSessionGameFactory, resolveSessionIdentity } from '../session/agent-adapter';
import { sha256Json } from '../session/hash';
import { SessionService } from '../session/service';
import { SessionStore } from '../session/store';

const MAX_DECISIONS = 200;
const CLI_MAX_BUFFER = 64 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

export interface PortableSessionE2EOptions {
  seeds: readonly number[];
  cli: string;
  root: string;
  out: string;
}

interface StatusView {
  revision: number;
  gameOver: boolean;
  result: unknown;
  observation: JsonRecord;
}

interface FullSnapshotView {
  revision: number;
  observation: JsonRecord;
  legalActions: unknown[];
}

interface ResultSummary {
  outcome: 'won' | 'lost';
  reason: string;
  turn: number;
}

interface SeedReport {
  seed: number;
  sessionId: string;
  gameOver: true;
  result: ResultSummary;
  finalRevision: number;
  finalTurn: number;
  counts: {
    decisions: number;
    legalActionQueries: number;
    fullSnapshotQueries: number;
    statusCommands: number;
  };
  artifact: {
    path: string;
    decisionCount: number;
    acceptedActionCount: number;
    readMatched: true;
    replayMatched: true;
  };
}

export interface PortableSessionE2EReport {
  ok: true;
  cli: string;
  root: string;
  node: { version: string; platform: NodeJS.Platform; arch: string };
  seeds: SeedReport[];
  replayMatched: true;
}

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a JSON object`);
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be a JSON array`);
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(`${label} must be a safe integer`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function sameJson(label: string, left: unknown, right: unknown): void {
  if (sha256Json(left) !== sha256Json(right)) fail(`${label} differs between public Session views`);
}

function statusView(payload: JsonRecord, label: string): StatusView {
  const observation = record(payload.observation, `${label}.observation`);
  const gameOver = payload.gameOver;
  if (typeof gameOver !== 'boolean') fail(`${label}.gameOver must be a boolean`);
  if (observation.gameOver !== gameOver) fail(`${label}.gameOver differs from compact observation`);
  return {
    revision: safeInteger(payload.revision, `${label}.revision`),
    gameOver,
    result: payload.result ?? null,
    observation,
  };
}

function invokeCli(
  options: PortableSessionE2EOptions,
  args: readonly string[],
  input?: unknown,
): JsonRecord {
  const child = spawnSync(process.execPath, [options.cli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
    input: input === undefined ? undefined : `${JSON.stringify(input)}\n`,
    maxBuffer: CLI_MAX_BUFFER,
  });
  if (child.error) fail(`Session CLI ${args[0] ?? 'command'} could not start: ${child.error.message}`);
  const stdout = String(child.stdout ?? '');
  const stderr = String(child.stderr ?? '');
  if (child.status !== 0) {
    const detail = (stderr.trim() || stdout.trim()).slice(0, 2_000);
    fail(`Session CLI ${args[0] ?? 'command'} failed with exit ${String(child.status)}${detail ? `: ${detail}` : ''}`);
  }
  const output = stdout.trim();
  if (output.length === 0) fail(`Session CLI ${args[0] ?? 'command'} returned no JSON`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch (error) {
    fail(`Session CLI ${args[0] ?? 'command'} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const payload = record(parsed, `Session CLI ${args[0] ?? 'command'} response`);
  if (payload.ok !== true) fail(`Session CLI ${args[0] ?? 'command'} returned ok=false`);
  return payload;
}

function commonArgs(root: string, sessionId: string): string[] {
  return ['--root', root, '--session', sessionId];
}

const FACILITY_FIELDS = ['id', 'type', 'position', 'status', 'owner', 'healthyPopulation', 'infectedPopulation', 'inSupply'] as const;
const UNIT_FIELDS = [
  'id', 'type', 'unitType', 'position', 'hp', 'maxHp', 'proficiency', 'attackChargesRemaining', 'maxAttackCharges',
  'canMove', 'canAttack', 'inSupply', 'currentFuel', 'maxFuel', 'currentMilitaryGoods', 'maxMilitaryGoods',
  'fixedMilitaryGoodsUpkeepPerTurn', 'attack', 'baseRecruitAttack', 'effectiveAttack', 'movement',
  'effectiveMovementCostAtPosition', 'baseRange', 'effectiveRange', 'rangeModifierReason', 'emergencyMovementPoints',
  'emergencyMovementAvailable',
] as const;
const CHECKPOINT_FIELDS = ['id', 'branchId', 'position', 'status', 'role', 'waiting', 'screening', 'approved', 'infected', 'currentPolicy', 'providesSupply'] as const;

function projectArray(value: unknown, fields: readonly string[], label: string): JsonRecord[] {
  return array(value, label).map((item, index) => {
    const source = record(item, `${label}[${index}]`);
    return Object.fromEntries(fields.map((field) => [field, source[field]]));
  });
}

function assertStatusMatchesFull(status: StatusView, full: FullSnapshotView, label: string): void {
  if (status.revision !== full.revision) fail(`${label} revision differs between status and full-snapshot`);
  const fullObservation = full.observation;
  for (const field of [
    'apiVersion', 'gameRulesVersion', 'turn', 'phase', 'resources', 'population', 'visibleEnemies', 'horde', 'victory',
    'crisisSummary', 'endTurnRisk', 'gameOver', 'result',
  ]) sameJson(`${label}.${field}`, status.observation[field], field === 'visibleEnemies' ? fullObservation.zombies : fullObservation[field]);
  sameJson(`${label}.facilities`, projectArray(status.observation.facilities, FACILITY_FIELDS, `${label}.status.facilities`), projectArray(fullObservation.facilities, FACILITY_FIELDS, `${label}.full.facilities`));
  sameJson(`${label}.units`, projectArray(status.observation.units, UNIT_FIELDS, `${label}.status.units`), projectArray(fullObservation.units, UNIT_FIELDS, `${label}.full.units`));
  sameJson(`${label}.checkpoints`, projectArray(status.observation.checkpoints, CHECKPOINT_FIELDS, `${label}.status.checkpoints`), projectArray(fullObservation.checkpoints, CHECKPOINT_FIELDS, `${label}.full.checkpoints`));
  sameJson(`${label}.result`, status.result, fullObservation.result);
}

function readFullSnapshot(options: PortableSessionE2EOptions, sessionId: string, revision: number): FullSnapshotView {
  const payload = invokeCli(options, [
    'query', ...commonArgs(options.root, sessionId), '--target', 'full-snapshot', '--revision', String(revision), '--page-size', '1',
  ]);
  const value = record(payload.value, 'full-snapshot.value');
  return {
    revision: safeInteger(payload.revision, 'full-snapshot.revision'),
    observation: record(value.observation, 'full-snapshot.value.observation'),
    legalActions: array(value.legalActions, 'full-snapshot.value.legalActions'),
  };
}

function readEndTurnAction(options: PortableSessionE2EOptions, sessionId: string, revision: number): { action: unknown; queries: number } {
  let cursor: string | undefined;
  let queries = 0;
  while (true) {
    const args = [
      'query', ...commonArgs(options.root, sessionId), '--target', 'legal-actions', '--revision', String(revision), '--page-size', '500',
    ];
    if (cursor) args.push('--cursor', cursor);
    const payload = invokeCli(options, args);
    queries += 1;
    if (safeInteger(payload.revision, 'legal-actions.revision') !== revision) fail('legal-actions revision differs from expectedRevision');
    const items = array(payload.items, 'legal-actions.items');
    const endTurn = items.find((action) => record(action, 'legal-actions.action').type === 'EndTurn');
    if (endTurn) return { action: endTurn, queries };
    if (payload.hasMore !== true) break;
    const nextCursor = payload.nextCursor;
    if (typeof nextCursor !== 'string' || nextCursor.length === 0) fail('legal-actions pagination omitted its nextCursor');
    cursor = nextCursor;
  }
  fail(`Session has no EndTurn in public Legal Actions at revision ${revision}`);
}

function resultSummary(value: unknown, label: string): ResultSummary {
  const result = record(value, label);
  const outcome = result.outcome;
  if (outcome !== 'won' && outcome !== 'lost') fail(`${label}.outcome must be won or lost`);
  return {
    outcome,
    reason: text(result.reason, `${label}.reason`),
    turn: safeInteger(result.turn, `${label}.turn`),
  };
}

function assertStatusSame(left: StatusView, right: StatusView, label: string): void {
  if (left.revision !== right.revision || left.gameOver !== right.gameOver) fail(`${label} status control fields differ`);
  sameJson(`${label}.observation`, left.observation, right.observation);
  sameJson(`${label}.result`, left.result, right.result);
}

function runSeed(options: PortableSessionE2EOptions, seed: number): SeedReport {
  const sessionId = `portable-e2e-seed-${String(seed).replace(/^-/, 'n')}`;
  const agentId = `portable-public-seed-${String(seed).replace(/^-/, 'n')}`;
  const created = invokeCli(options, [
    'new', '--root', options.root, '--session', sessionId, '--seed', String(seed), '--agent-id', agentId,
  ]);
  const initialFromNew = statusView(created, `new seed ${seed}`);
  const initialFromStatus = statusView(invokeCli(options, ['status', ...commonArgs(options.root, sessionId)]), `status seed ${seed} initial`);
  assertStatusSame(initialFromNew, initialFromStatus, `seed ${seed} initial`);

  let current = initialFromStatus;
  let lastFull = readFullSnapshot(options, sessionId, current.revision);
  assertStatusMatchesFull(current, lastFull, `seed ${seed} initial`);
  let decisions = 0;
  let legalActionQueries = 0;
  let fullSnapshotQueries = 1;

  while (!current.gameOver) {
    if (decisions >= MAX_DECISIONS) fail(`Seed ${seed} did not reach Game Over within ${MAX_DECISIONS} decisions`);
    const legal = readEndTurnAction(options, sessionId, current.revision);
    legalActionQueries += legal.queries;
    if (!lastFull.legalActions.some((action) => record(action, `seed ${seed} full legal action`).type === 'EndTurn')) {
      fail(`Seed ${seed} full-snapshot omitted EndTurn at revision ${current.revision}`);
    }
    const stepPayload = invokeCli(options, [
      'step', ...commonArgs(options.root, sessionId),
    ], {
      action: legal.action,
      decisionSummary: `portable public EndTurn seed ${seed} decision ${decisions + 1}`,
      expectedRevision: current.revision,
    });
    if (stepPayload.accepted !== true || stepPayload.error !== null) fail(`Seed ${seed} EndTurn was not accepted at decision ${decisions + 1}`);
    const next = statusView(stepPayload, `seed ${seed} step ${decisions + 1}`);
    if (next.revision !== current.revision + 1) fail(`Seed ${seed} revision did not advance by one`);
    decisions += 1;
    current = next;
    lastFull = readFullSnapshot(options, sessionId, current.revision);
    fullSnapshotQueries += 1;
    assertStatusMatchesFull(current, lastFull, `seed ${seed} decision ${decisions}`);
  }

  const finalFromStatus = statusView(invokeCli(options, ['status', ...commonArgs(options.root, sessionId)]), `status seed ${seed} final`);
  assertStatusSame(current, finalFromStatus, `seed ${seed} final`);
  assertStatusMatchesFull(finalFromStatus, lastFull, `seed ${seed} final`);
  if (finalFromStatus.result === null) fail(`Seed ${seed} reached Game Over without a Result`);
  const summary = resultSummary(finalFromStatus.result, `seed ${seed} result`);
  const artifactPath = join(options.root, `portable-e2e-seed-${String(seed).replace(/^-/, 'n')}.nlth-artifact`);
  const artifactPayload = invokeCli(options, [
    'artifact', ...commonArgs(options.root, sessionId), '--out', artifactPath,
  ]);
  const exportedManifest = record(artifactPayload.artifact, `seed ${seed} artifact manifest`);
  const exportedManifestHash = text(exportedManifest.manifestHash, `seed ${seed} artifact manifestHash`);

  // Verification uses the SessionService's public artifact APIs only. The
  // driver never reads Private State, decision internals, or Session files.
  const identity = resolveSessionIdentity(process.env);
  const verifier = new SessionService(new SessionStore(options.root), createAgentSessionGameFactory(identity.buildId), identity);
  const readManifest = verifier.readArtifact(artifactPath);
  if (readManifest.manifestHash !== exportedManifestHash) fail(`Seed ${seed} Artifact read manifest differs from export`);
  if (readManifest.decisionCount !== decisions || readManifest.acceptedActionCount !== decisions) fail(`Seed ${seed} Artifact counts differ from the public step loop`);
  const replay = verifier.replayArtifact(artifactPath);
  if (replay.matched !== true || replay.decisionCount !== decisions) fail(`Seed ${seed} Artifact Replay did not match`);
  if (sha256Json(replay.result) !== sha256Json(finalFromStatus.result)) fail(`Seed ${seed} Artifact Replay Result differs from final public Result`);

  return {
    seed,
    sessionId,
    gameOver: true,
    result: summary,
    finalRevision: finalFromStatus.revision,
    finalTurn: safeInteger(finalFromStatus.observation.turn, `seed ${seed} final turn`),
    counts: { decisions, legalActionQueries, fullSnapshotQueries, statusCommands: 2 },
    artifact: {
      path: artifactPath,
      decisionCount: readManifest.decisionCount,
      acceptedActionCount: readManifest.acceptedActionCount,
      readMatched: true,
      replayMatched: true,
    },
  };
}

function parseInteger(value: string, name: string): number {
  if (!/^-?\d+$/u.test(value)) fail(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`${name} must be a safe integer`);
  return parsed;
}

function optionValue(argv: readonly string[], index: number, name: string): { value: string; nextIndex: number } {
  const argument = argv[index]!;
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), nextIndex: index };
  if (argument !== name || index + 1 >= argv.length) fail(`${name} requires a value`);
  return { value: argv[index + 1]!, nextIndex: index + 1 };
}

export function parsePortableSessionE2EArguments(argv: readonly string[]): PortableSessionE2EOptions {
  const seedValues: number[] = [];
  let cli = resolve('dist/portable/session-cli.mjs');
  let root = resolve('output', `portable-session-e2e-${Date.now()}`);
  let out: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--help') fail('Usage: portable-session-e2e.ts [--seed=N] [--cli=path/to/session-cli.mjs] [--root=output/unique] [--out=report.json]');
    if (argument === '--seed' || argument.startsWith('--seed=')) {
      const option = optionValue(argv, index, '--seed');
      index = option.nextIndex;
      for (const raw of option.value.split(',')) seedValues.push(parseInteger(raw, '--seed'));
    } else if (argument === '--cli' || argument.startsWith('--cli=')) {
      const option = optionValue(argv, index, '--cli');
      index = option.nextIndex;
      cli = resolve(option.value);
    } else if (argument === '--root' || argument.startsWith('--root=')) {
      const option = optionValue(argv, index, '--root');
      index = option.nextIndex;
      root = resolve(option.value);
    } else if (argument === '--out' || argument.startsWith('--out=')) {
      const option = optionValue(argv, index, '--out');
      index = option.nextIndex;
      out = resolve(option.value);
    } else {
      fail(`Unknown option: ${argument}`);
    }
  }
  const seeds = [...new Set(seedValues.length > 0 ? seedValues : [1, 7])];
  if (!existsSync(cli) || !statSync(cli).isFile()) fail(`Bundled Session CLI does not exist: ${cli}`);
  if (existsSync(root) && !statSync(root).isDirectory()) fail(`Session root is not a directory: ${root}`);
  if (existsSync(root) && readdirSync(root).length > 0) fail(`Session root must be unique and empty: ${root}`);
  if (!out) out = join(root, 'report.json');
  return { seeds, cli, root, out };
}

export function runPortableSessionE2E(options: PortableSessionE2EOptions): PortableSessionE2EReport {
  mkdirSync(options.root, { recursive: true });
  const seeds = options.seeds.length > 0 ? [...new Set(options.seeds)] : [1, 7];
  const reports = seeds.map((seed) => runSeed(options, seed));
  const report: PortableSessionE2EReport = {
    ok: true,
    cli: options.cli,
    root: options.root,
    node: { version: process.version, platform: process.platform, arch: process.arch },
    seeds: reports,
    replayMatched: true,
  };
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return report;
}

export function runCli(argv: readonly string[] = process.argv.slice(2)): number {
  const options = parsePortableSessionE2EArguments(argv);
  const report = runPortableSessionE2E(options);
  process.stdout.write(`${JSON.stringify({ ok: true, output: options.out, seeds: report.seeds.map(({ seed, result, counts, artifact }) => ({ seed, result, decisions: counts.decisions, artifact: artifact.path, replayMatched: artifact.replayMatched })) })}\n`);
  return 0;
}

const entry = process.argv[1];
if (entry && /portable-session-e2e\.(?:ts|js|mjs)$/u.test(entry)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
