import type { SimulationReport } from '../agent/sim-cli';

export const RELEASE_SEED_STARTS = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91];

export function validateReleaseSeedReport(report: SimulationReport, agent: string, start: number, count: number): void {
  const seeds = Array.from({ length: count }, (_, index) => start + index);
  if (report.appVersion !== '1.5.5') throw new Error('Unexpected app version');
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
  const finalHordeRuns = reports.filter(report => report.execution.agents[0] === 'balanced')
    .flatMap(report => report.games)
    .filter(game => game.finalHordeSpawned > 0 && game.finalTurn > 50);
  if (finalHordeRuns.length === 0) throw new Error('No Balanced run reached a spawned Final Horde and continued past turn 50');
  return { games: 200, seedsPerAgent: 100, finalHordeReachableRuns: finalHordeRuns.length };
}
