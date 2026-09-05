import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const GAME_METADATA_KEYS = new Set([
  'appVersion',
  'agentApiVersion',
  'observationApiVersion',
  'bridgeApiVersion',
  'buildId',
]);

function fail(message) {
  throw new Error(`Release baseline verification failed: ${message}`);
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function loadReport(path, label) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) fail(`${label} report does not exist: ${resolved}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (error) {
    fail(`${label} report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = object(parsed, `${label} report`);
  array(report.games, `${label}.games`);
  object(report.execution, `${label}.execution`);
  return { path: resolved, report };
}

function gameKey(game, label) {
  const row = object(game, label);
  if (typeof row.agentId !== 'string' || row.agentId.length === 0) fail(`${label}.agentId must be a non-empty string`);
  if (!Number.isSafeInteger(row.seed)) fail(`${label}.seed must be a safe integer`);
  return `${row.agentId}\u0000${row.seed}`;
}

function indexGames(games, label) {
  const indexed = new Map();
  for (const [index, game] of games.entries()) {
    const key = gameKey(game, `${label}[${index}]`);
    if (indexed.has(key)) fail(`${label} contains duplicate game ${key.replace('\u0000', ' seed ')}`);
    indexed.set(key, object(game, `${label}[${index}]`));
  }
  return indexed;
}

function comparableGame(game) {
  return Object.fromEntries(Object.entries(game).filter(([key]) => !GAME_METADATA_KEYS.has(key)));
}

function firstDifference(left, right, path = '$') {
  if (isDeepStrictEqual(left, right)) return null;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return `${path}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    if (!(key in left)) return `${path}.${key}: missing from baseline`;
    if (!(key in right)) return `${path}.${key}: missing from candidate`;
    const difference = firstDifference(left[key], right[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return `${path}: values differ`;
}

function requireSuccessful(report, label) {
  if (report.exitCode !== 0 || report.technicalFailureCount !== 0) {
    fail(`${label} contains technical failures (exitCode=${String(report.exitCode)}, technicalFailureCount=${String(report.technicalFailureCount)})`);
  }
  const failures = array(report.failures, `${label}.failures`);
  if (failures.length !== 0) fail(`${label}.failures must be empty`);
}

/**
 * Compare a v1.5.2 candidate to the immutable v1.5.1 baseline.  App and
 * public API Version stamps are intentionally excluded: their contract is
 * revised in v1.5.2, while the game rules and deterministic simulation output
 * must remain unchanged.
 */
export function verifyReleaseBaseline(baselinePath, candidatePath) {
  const baseline = loadReport(baselinePath, 'baseline');
  const candidate = loadReport(candidatePath, 'candidate');
  requireSuccessful(baseline.report, 'baseline');
  requireSuccessful(candidate.report, 'candidate');

  const baselineExecution = object(baseline.report.execution, 'baseline.execution');
  const candidateExecution = object(candidate.report.execution, 'candidate.execution');
  for (const field of ['agents', 'seeds', 'config', 'limits', 'failFast']) {
    const difference = firstDifference(baselineExecution[field], candidateExecution[field], `execution.${field}`);
    if (difference) fail(difference);
  }

  const baselineGames = indexGames(array(baseline.report.games, 'baseline.games'), 'baseline.games');
  const candidateGames = indexGames(array(candidate.report.games, 'candidate.games'), 'candidate.games');
  if (baselineGames.size !== candidateGames.size) {
    fail(`game count differs: baseline=${baselineGames.size}, candidate=${candidateGames.size}`);
  }
  for (const [key, baselineGame] of baselineGames) {
    const candidateGame = candidateGames.get(key);
    if (!candidateGame) fail(`candidate is missing ${key.replace('\u0000', ' seed ')}`);
    const difference = firstDifference(comparableGame(baselineGame), comparableGame(candidateGame), `game(${key.replace('\u0000', ', seed=')})`);
    if (difference) fail(difference);
  }
  return {
    ok: true,
    baseline: baseline.path,
    candidate: candidate.path,
    comparedGames: baselineGames.size,
    ignoredGameMetadata: [...GAME_METADATA_KEYS],
  };
}

function option(argv, name) {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const baseline = option(process.argv.slice(2), '--baseline');
    const candidate = option(process.argv.slice(2), '--candidate');
    const out = option(process.argv.slice(2), '--out');
    if (!baseline || !candidate || !out) fail('usage: node scripts/verify-release-baseline.mjs --baseline BASELINE_RUN_JSON --candidate CANDIDATE_RUN_JSON --out COMPARISON_JSON');
    const output = resolve(out);
    if (existsSync(output)) fail(`refusing to overwrite comparison output: ${output}`);
    const report = verifyReleaseBaseline(baseline, candidate);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
