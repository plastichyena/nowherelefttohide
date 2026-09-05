import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyReleaseBaseline } from './verify-release-baseline.mjs';

function writeReport(path, game = {}) {
  const report = {
    schemaVersion: '7.0.0',
    appVersion: '1.5.1',
    artifactSchemaVersion: '7.0.0',
    execution: {
      agents: ['random'],
      seeds: [1],
      config: { version: '4.0.0', maxActionsPerTurn: 10 },
      limits: { maxTurns: 100 },
      failFast: false,
      buildId: 'baseline-build',
    },
    games: [{
      appVersion: '1.5.1', gameRulesVersion: '4.0.0', agentId: 'random', agentVersion: '3.0.0', strategy: 'random',
      agentApiVersion: '8.0.0', observationApiVersion: '8.0.0', bridgeApiVersion: '8.0.0', buildId: 'baseline-build',
      seed: 1, config: { version: '4.0.0', maxActionsPerTurn: 10 }, outcome: 'lost', limitReached: false,
      gameOverReason: 'capitalLost', finalTurn: 12, acceptedActionCount: 36, ...game,
    }],
    failures: [], technicalFailureCount: 0, exitCode: 0,
  };
  writeFileSync(path, JSON.stringify(report), 'utf8');
}

test('permits the v1.5.2 public-version bump when game metrics are unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-release-baseline-'));
  const baseline = join(root, 'baseline.json');
  const candidate = join(root, 'candidate.json');
  writeReport(baseline);
  writeReport(candidate, {
    appVersion: '1.5.2', agentApiVersion: '9.0.0', observationApiVersion: '9.0.0', bridgeApiVersion: '9.0.0', buildId: 'candidate-build',
  });
  assert.deepEqual(verifyReleaseBaseline(baseline, candidate), {
    ok: true,
    baseline,
    candidate,
    comparedGames: 1,
    ignoredGameMetadata: ['appVersion', 'agentApiVersion', 'observationApiVersion', 'bridgeApiVersion', 'buildId'],
  });
});

test('rejects a changed deterministic game metric', () => {
  const root = mkdtempSync(join(tmpdir(), 'nlth-release-baseline-'));
  const baseline = join(root, 'baseline.json');
  const candidate = join(root, 'candidate.json');
  writeReport(baseline);
  writeReport(candidate, { finalTurn: 13 });
  assert.throws(() => verifyReleaseBaseline(baseline, candidate), /game\(random, seed=1\)\.finalTurn/);
});
