import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { normalizeBaselineReport } from './normalize-baseline-report.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nlth-baseline-normalizer-'));
  const raw = join(root, 'raw');
  const out = join(root, 'normalized');
  mkdirSync(raw);
  const games = [
    { agentId: 'balanced', seed: 1, outcome: 'technical_failure', gameOverReason: null, finalTurn: 101, acceptedActionCount: 20, actionCounts: {}, priorityGoalCounts: {}, failure: { code: 'TURN_SAFETY_LIMIT', message: 'cap' } },
    { agentId: 'balanced', seed: 2, outcome: 'technical_failure', gameOverReason: null, finalTurn: 5, acceptedActionCount: 2, actionCounts: {}, priorityGoalCounts: {}, failure: { code: 'ENGINE_THREW', message: 'bug' } },
    { agentId: 'balanced', seed: 3, outcome: 'won', gameOverReason: 'victory', finalTurn: 60, acceptedActionCount: 30, actionCounts: {}, priorityGoalCounts: {}, failure: null },
  ];
  const report = {
    schemaVersion: '6.0.0', appVersion: '1.5.0', artifactSchemaVersion: '6.0.0',
    execution: { agents: ['balanced'], seeds: [1, 2, 3] }, games,
    aggregate: { balanced: { executions: 3, completed: 1, technicalFailures: 2, wins: 1, losses: 0, winRate: 1, metrics: { finalTurn: { average: 55 } }, gameOverReasons: { victory: 1 }, actionCounts: {}, priorityGoalCounts: {} } },
    comparisons: [],
    failures: [
      { agent: 'balanced', seed: 1, artifactIndex: 0, code: 'TURN_SAFETY_LIMIT', message: 'cap' },
      { agent: 'balanced', seed: 2, artifactIndex: 1, code: 'ENGINE_THREW', message: 'bug' },
    ],
    technicalFailureCount: 2, exitCode: 1,
  };
  const csv = 'agentId,seed,outcome,gameOverReason,finalTurn,note\n' +
    'balanced,1,technical_failure,,101,"cap, quoted"\n' +
    'balanced,2,technical_failure,,5,bug\n' +
    'balanced,3,won,victory,60,ok\n';
  writeFileSync(join(raw, 'run.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(raw, 'games.csv'), csv, 'utf8');
  return { raw, out, report, csv };
}

test('normalizes only TURN_SAFETY_LIMIT and keeps JSON, CSV, aggregate, and comparisons consistent', () => {
  const { raw, out, report, csv } = fixture();
  const normalized = normalizeBaselineReport(raw, out);
  assert.equal(readFileSync(join(raw, 'run.json'), 'utf8'), `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(readFileSync(join(raw, 'games.csv'), 'utf8'), csv);
  assert.deepEqual(normalized.games.map((game) => [game.outcome, game.limitReached, game.failure?.code ?? null]), [
    ['limit_reached', true, null], ['technical_failure', false, 'ENGINE_THREW'], ['won', false, null],
  ]);
  assert.deepEqual(normalized.failures.map((failure) => failure.code), ['ENGINE_THREW']);
  assert.equal(normalized.limitReachedCount, 1);
  assert.equal(normalized.technicalFailureCount, 1);
  assert.equal(normalized.exitCode, 1);
  assert.deepEqual(normalized.aggregate.balanced, { ...report.aggregate.balanced, completed: 1, limitReached: 1, technicalFailures: 1 });
  assert.deepEqual(normalized.comparisons[0].agents.balanced, { outcome: 'limit_reached', finalTurn: 101, acceptedActionCount: 20, technicalFailure: false, limitReached: true });
  const csvRows = readFileSync(join(out, 'games.csv'), 'utf8').trimEnd().split('\n');
  assert.equal(csvRows[0], 'agentId,seed,outcome,limitReached,gameOverReason,finalTurn,note');
  assert.equal(csvRows[1], 'balanced,1,limit_reached,true,,101,"cap, quoted"');
  assert.equal(csvRows[2], 'balanced,2,technical_failure,false,,5,bug');
});

test('returns a successful normalized report when every raw failure is the comparison turn cap', () => {
  const { raw, out } = fixture();
  const report = JSON.parse(readFileSync(join(raw, 'run.json'), 'utf8'));
  report.games = [report.games[0]];
  report.execution.seeds = [1];
  report.failures = [report.failures[0]];
  report.aggregate.balanced.executions = 1;
  writeFileSync(join(raw, 'run.json'), `${JSON.stringify(report)}\n`, 'utf8');
  writeFileSync(join(raw, 'games.csv'), 'agentId,seed,outcome\nbalanced,1,technical_failure\n', 'utf8');
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'normalize-baseline-report.mjs'), '--input', raw, '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const normalized = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.equal(normalized.exitCode, 0);
  assert.equal(normalized.technicalFailureCount, 0);
  assert.equal(normalized.limitReachedCount, 1);
});

test('CLI keeps a non-limit technical failure as a failed batch', () => {
  const { raw, out } = fixture();
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'normalize-baseline-report.mjs'), '--input', raw, '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const normalized = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.equal(normalized.exitCode, 1);
  assert.deepEqual(normalized.failures.map((failure) => failure.code), ['ENGINE_THREW']);
});
