import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIMIT_CODE = 'TURN_SAFETY_LIMIT';

function fail(message) { throw new Error(`Baseline report normalization failed: ${message}`); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/u, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) fail('games.csv has an unterminated quoted field');
  if (cell.length > 0 || row.length > 0) { row.push(cell.replace(/\r$/u, '')); rows.push(row); }
  return rows.filter((candidate) => candidate.length > 1 || candidate[0] !== '');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serializeCsv(rows) { return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`; }
function gameKey(game) { return `${game.agentId}\u0000${game.seed}`; }

function normalizeGamesAndFailures(report) {
  if (!Array.isArray(report.games) || !Array.isArray(report.failures)) fail('run.json must contain games and failures arrays');
  for (const [index, game] of report.games.entries()) {
    if (!isObject(game)) fail(`game ${index} is not an object`);
  }
  const limitedIndexes = new Set();
  for (const [failureIndex, failure] of report.failures.entries()) {
    if (!isObject(failure)) fail(`failure ${failureIndex} is not an object`);
    if (failure.code !== LIMIT_CODE) continue;
    const index = failure.artifactIndex;
    if (!Number.isSafeInteger(index) || index < 0 || index >= report.games.length) fail('TURN_SAFETY_LIMIT failure has an invalid artifactIndex');
    const game = report.games[index];
    if (!isObject(game) || game.agentId !== failure.agent || game.seed !== failure.seed || game.outcome !== 'technical_failure' || !isObject(game.failure) || game.failure.code !== LIMIT_CODE) fail(`TURN_SAFETY_LIMIT failure at artifactIndex ${index} does not match its game`);
    if (limitedIndexes.has(index)) fail(`duplicate TURN_SAFETY_LIMIT failure at artifactIndex ${index}`);
    limitedIndexes.add(index);
  }
  for (const [index, game] of report.games.entries()) {
    if (isObject(game?.failure) && game.failure.code === LIMIT_CODE && !limitedIndexes.has(index)) fail(`game ${index} has an unindexed TURN_SAFETY_LIMIT failure`);
    if (!limitedIndexes.has(index)) {
      if (game.outcome === 'limit_reached') fail(`raw v1.5.0 game ${index} is already normalized`);
      game.limitReached = false;
      continue;
    }
    game.outcome = 'limit_reached';
    game.limitReached = true;
    game.gameOverReason = null;
    game.failure = null;
  }
  report.failures = report.failures.filter((failure) => failure.code !== LIMIT_CODE);
  report.limitReachedCount = limitedIndexes.size;
  report.technicalFailureCount = report.failures.length;
  report.exitCode = report.failures.length > 0 ? 1 : 0;
  return limitedIndexes;
}

function normalizeAggregate(report) {
  if (!isObject(report.aggregate) || !isObject(report.execution) || !Array.isArray(report.execution.agents)) fail('run.json aggregate/execution shape is invalid');
  for (const agent of report.execution.agents) {
    const rows = report.games.filter((game) => game.agentId === agent);
    const aggregate = report.aggregate[agent];
    if (!isObject(aggregate)) fail(`aggregate is missing agent ${agent}`);
    const wins = rows.filter((game) => game.outcome === 'won').length;
    const losses = rows.filter((game) => game.outcome === 'lost').length;
    aggregate.executions = rows.length;
    aggregate.completed = wins + losses;
    aggregate.limitReached = rows.filter((game) => game.outcome === 'limit_reached').length;
    aggregate.technicalFailures = rows.filter((game) => game.outcome === 'technical_failure').length;
    aggregate.wins = wins;
    aggregate.losses = losses;
    aggregate.winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  }
}

function normalizeComparisons(report) {
  const agents = report.execution.agents;
  const seeds = [...new Set(report.games.map((game) => game.seed))].sort((a, b) => a - b);
  const games = new Map(report.games.map((game) => [gameKey(game), game]));
  report.comparisons = seeds.map((seed) => ({
    seed,
    agents: Object.fromEntries([...agents].sort((a, b) => a.localeCompare(b)).map((agent) => {
      const game = games.get(`${agent}\u0000${seed}`);
      return [agent, game ? {
        outcome: game.outcome,
        finalTurn: game.finalTurn,
        acceptedActionCount: game.acceptedActionCount,
        technicalFailure: game.outcome === 'technical_failure',
        limitReached: game.outcome === 'limit_reached',
      } : { outcome: 'technical_failure', finalTurn: 0, acceptedActionCount: 0, technicalFailure: true, limitReached: false }];
    })),
  }));
}

function normalizeCsv(rawCsv, games, limitedIndexes) {
  const rows = parseCsv(rawCsv);
  if (rows.length !== games.length + 1) fail(`games.csv row count ${rows.length - 1} does not match games count ${games.length}`);
  const header = rows[0];
  const outcomeIndex = header.indexOf('outcome');
  const agentIndex = header.indexOf('agentId');
  const seedIndex = header.indexOf('seed');
  if (outcomeIndex < 0 || agentIndex < 0 || seedIndex < 0 || header.includes('limitReached')) fail('games.csv header is not the expected raw v1.5.0 shape');
  header.splice(outcomeIndex + 1, 0, 'limitReached');
  for (let index = 0; index < games.length; index += 1) {
    const row = rows[index + 1];
    const game = games[index];
    if (row[agentIndex] !== String(game.agentId) || row[seedIndex] !== String(game.seed)) fail(`games.csv row ${index + 1} does not match run.json game order`);
    row[outcomeIndex] = game.outcome;
    row.splice(outcomeIndex + 1, 0, limitedIndexes.has(index) ? 'true' : 'false');
  }
  return serializeCsv(rows);
}

export function normalizeBaselineReport(inputDirectory, outputDirectory) {
  const input = resolve(inputDirectory);
  const output = resolve(outputDirectory);
  const runPath = resolve(input, 'run.json');
  const csvPath = resolve(input, 'games.csv');
  if (!existsSync(runPath) || !existsSync(csvPath)) fail(`raw run.json and games.csv are required in ${input}`);
  if (input === output) fail('raw input and normalized output directories must differ');
  const report = JSON.parse(readFileSync(runPath, 'utf8'));
  if (!isObject(report) || report.schemaVersion !== '6.0.0') fail('run.json is not a v1.5.0 Schema 6 report');
  const limitedIndexes = normalizeGamesAndFailures(report);
  normalizeAggregate(report);
  normalizeComparisons(report);
  const csv = normalizeCsv(readFileSync(csvPath, 'utf8'), report.games, limitedIndexes);
  mkdirSync(output, { recursive: true });
  const outputRun = resolve(output, 'run.json');
  const outputCsv = resolve(output, 'games.csv');
  if (existsSync(outputRun) || existsSync(outputCsv)) fail(`refusing to overwrite normalized output in ${output}`);
  writeFileSync(outputRun, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(outputCsv, csv, 'utf8');
  return report;
}

function option(argv, name) {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const input = option(process.argv.slice(2), '--input');
    const output = option(process.argv.slice(2), '--out');
    if (!input || !output) fail('usage: node scripts/normalize-baseline-report.mjs --input RAW_DIR --out OUTPUT_DIR');
    const report = normalizeBaselineReport(input, output);
    process.stdout.write(`${JSON.stringify({ normalized: report.games.length, limitReached: report.limitReachedCount, technicalFailures: report.technicalFailureCount, exitCode: report.exitCode })}\n`);
    process.exitCode = report.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
