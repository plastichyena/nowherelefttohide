import { describe, expect, it } from 'vitest';
import type { SimulationReport } from '../agent/sim-cli';
import { RELEASE_SEED_STARTS, validateReleaseSeedCoverage, validateReleaseSeedReport } from './release-seed-report';

function report(agent = 'balanced', start = 1): SimulationReport {
  const seeds = Array.from({ length: 10 }, (_, index) => start + index);
  return {
    appVersion: '1.5.5',
    execution: { agents: [agent], seeds, limits: { maxTurns: 100 } },
    games: seeds.map(seed => ({ agentId: agent, seed, outcome: 'lost', finalTurn: 60, finalHordeSpawned: 1 })),
    failures: [], technicalFailureCount: 0, limitReachedCount: 0, exitCode: 0,
  } as unknown as SimulationReport;
}

describe('release seed validation gates', () => {
  it('accepts exactly 100 completed games per agent across all shards', () => {
    const reports = ['random', 'balanced'].flatMap(agent => RELEASE_SEED_STARTS.map(start => report(agent, start)));
    expect(validateReleaseSeedCoverage(reports)).toMatchObject({ games: 200, seedsPerAgent: 100, finalHordeReachableRuns: 100, finalHordeSpawnedRuns: 100, balancedMaxFinalTurn: 60 });
  });
  it.each(['technical', 'limit', 'outcome', 'seed', 'agent', 'maxTurns', 'version', 'missingGame'])('rejects %s violations', kind => {
    const value = report();
    if (kind === 'technical') value.technicalFailureCount = 1;
    if (kind === 'limit') value.limitReachedCount = 1;
    if (kind === 'outcome') value.games[0]!.outcome = 'limit_reached';
    if (kind === 'seed') value.games[0]!.seed = 11;
    if (kind === 'agent') value.execution.agents = ['random'];
    if (kind === 'maxTurns') value.execution.limits.maxTurns = 101;
    if (kind === 'version') value.appVersion = '1.5.4';
    if (kind === 'missingGame') value.games.pop();
    expect(() => validateReleaseSeedReport(value, 'balanced', 1, 10)).toThrow();
  });
  it('rejects missing and duplicated shards', () => {
    const reports = ['random', 'balanced'].flatMap(agent => RELEASE_SEED_STARTS.map(start => report(agent, start)));
    expect(() => validateReleaseSeedCoverage(reports.slice(1))).toThrow(/20/);
    reports[0] = reports[1]!;
    expect(() => validateReleaseSeedCoverage(reports)).toThrow(/Missing or duplicate/);
  });
  it('records zero Final Horde coverage without misclassifying completed losses', () => {
    const reports = ['random', 'balanced'].flatMap(agent => RELEASE_SEED_STARTS.map(start => report(agent, start)));
    for (const value of reports.filter(value => value.execution.agents[0] === 'balanced')) {
      for (const game of value.games) game.finalHordeSpawned = 0;
    }
    expect(validateReleaseSeedCoverage(reports)).toMatchObject({ finalHordeSpawnedRuns: 0, finalHordeReachableRuns: 0 });
    reports.at(-1)!.games.at(-1)!.finalHordeSpawned = 1;
    expect(validateReleaseSeedCoverage(reports).finalHordeReachableRuns).toBe(1);
  });
  it('rejects missing or invalid progression measurements', () => {
    const value = report();
    value.games[0]!.finalHordeSpawned = Number.NaN;
    expect(() => validateReleaseSeedReport(value, 'balanced', 1, 10)).toThrow(/metrics/);
    value.games[0]!.finalHordeSpawned = 0;
    value.games[0]!.finalTurn = 0;
    expect(() => validateReleaseSeedReport(value, 'balanced', 1, 10)).toThrow(/metrics/);
  });
});
