import { expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { createInitialState, createUnit } from '../core/state';
import { calculateTerminalScore } from '../core/terminal-score';
import { createAgentResult } from './observation';
import { runAgentGame } from './runner';

it('publishes the same detached terminal snapshot without hidden population, enemy or start-manifest data', () => {
  const state = createInitialState(42, createDefaultConfig({ mapMode: 'fixed' }));
  const terminalScore = calculateTerminalScore(state, 'won');
  const result = { outcome: 'won' as const, reason: 'stateSecured' as const, turn: state.turn, statistics: state.statistics, terminalScore };
  const projected = createAgentResult(result)!;
  expect(projected.terminalScore).toEqual(terminalScore); expect(projected.terminalScore).not.toBe(terminalScore);
  state.units.push(createUnit(state, 'hidden-score-sentinel', 'zombie', { q: 1, r: 1 }));
  for (const f of state.facilities.filter(f => f.owner === 'none')) f.workers = 9876;
  expect(calculateTerminalScore(state, 'won')).toEqual(terminalScore);
  for (const hidden of ['hidden-score-sentinel', '9876', 'initialUnits', 'initialFacilityIds', 'rngState', 'rejectedBonusZombiesByDirection']) {
    expect(JSON.stringify(projected)).not.toContain(hidden);
  }
});

it('does not manufacture a score for a real Runner limit or an agent failure', () => {
  const config = createDefaultConfig({ mapMode: 'fixed' });
  const limited = runAgentGame(42, { config, agent: { id: 'end-only', version: '1', decide: () => ({ action: { type: 'EndTurn' } }) },
    limits: { maxTurns: 1, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 10 } });
  expect(limited.limitReached).toBe(true); expect(limited.result).toBeNull(); expect(limited.finalObservation?.result).toBeNull();
  const failed = runAgentGame(42, { config, agent: { id: 'failing-agent', version: '1', decide: () => { throw new Error('test agent failure'); } } });
  expect(failed.technicalFailure).toBe(true); expect(failed.result).toBeNull(); expect(failed.finalObservation).toBeNull();
});
