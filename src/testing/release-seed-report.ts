import type { SimulationReport } from '../agent/sim-cli';
import { APP_VERSION } from '../agent/types';

export const RELEASE_SEED_STARTS = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91];

export function validateReleaseSeedReport(report: SimulationReport, agent: string, start: number, count: number): void {
  const seeds = Array.from({ length: count }, (_, index) => start + index);
  if (report.appVersion !== APP_VERSION) throw new Error(`Unexpected app version: expected ${APP_VERSION}, received ${report.appVersion}`);
  if (JSON.stringify(report.execution?.agents) !== JSON.stringify([agent])) throw new Error('Agent metadata mismatch');
  if (JSON.stringify(report.execution?.seeds) !== JSON.stringify(seeds)) throw new Error('Seed coverage mismatch');
  if (report.execution?.limits?.maxTurns !== 100) throw new Error('Runner maxTurns must remain 100');
  if (report.games?.length !== count || report.failures?.length !== 0 || report.technicalFailureCount !== 0 || report.exitCode !== 0) {
    throw new Error(`Technical failure in fixed seed batch: ${JSON.stringify(report.failures)}`);
  }
  if (report.limitReachedCount !== 0) throw new Error('Runner limit reached before Game Over');
  for (const [index, game] of report.games.entries()) {
    if (game.agentId !== agent || game.seed !== seeds[index]) throw new Error('Game coverage mismatch');
    if (game.outcome !== 'won' && game.outcome !== 'lost') throw new Error('Game did not complete');
    if (!Number.isSafeInteger(game.finalTurn) || game.finalTurn < 1
      || !Number.isSafeInteger(game.finalHordeSpawned) || game.finalHordeSpawned < 0) throw new Error('Invalid Final Horde metrics');
  }
}

export function validateReleaseSeedCoverage(reports: SimulationReport[]) {
  if (reports.length !== 20) throw new Error('Expected all 20 release shards');
  for (const agent of ['random', 'balanced']) {
    for (const start of RELEASE_SEED_STARTS) {
      const matches = reports.filter(report => report.execution?.agents?.[0] === agent && report.execution?.seeds?.[0] === start);
      if (matches.length !== 1) throw new Error(`Missing or duplicate shard: ${agent} ${start}`);
      validateReleaseSeedReport(matches[0]!, agent, start, 10);
    }
  }
  const balanced = reports.filter(report => report.execution.agents[0] === 'balanced').flatMap(report => report.games);
  // The release acceptance criteria require measuring progression, not a
  // minimum win/survival rate for Balanced. A normal loss is a completed game.
  // Keep zero coverage explicit instead of treating AI strength as a crash.
  return {
    games: 200,
    seedsPerAgent: 100,
    finalHordeSpawnedRuns: balanced.filter(game => game.finalHordeSpawned > 0).length,
    finalHordeReachableRuns: balanced.filter(game => game.finalHordeSpawned > 0 && game.finalTurn > 50).length,
    balancedMaxFinalTurn: Math.max(...balanced.map(game => game.finalTurn)),
    finalHordeCoverageNote: 'Measured Balanced progression; zero means the standard-seed batch provides no Final Horde gameplay coverage. It is not a technical failure.',
  };
}
