import { afterAll, describe, expect, it } from 'vitest';
import { BalancedAgent } from './balancedAgent';
import { createAgentGame } from './game';

describe('Balanced Agent 30-seed regression', () => {
  const finalTurns = new Map<number, number>();
  const seedBatches = Array.from({ length: 3 }, (_, index) => ({ start: index * 10 + 1, end: index * 10 + 10 }));

  it.each(seedBatches)('completes standard-config seeds $start through $end without technical failure', ({ start, end }) => {
    for (let seed = start; seed <= end; seed += 1) {
      const game = createAgentGame();
      game.reset({ seed, agent: { id: 'balanced' } });
      const agent = new BalancedAgent();
      let decisions = 0;
      while (!game.isGameOver() && decisions < 5_000) {
        const decision = agent.decide(game.getObservation(), game.getLegalActions());
        const result = game.step(decision.action);
        expect(result.error, `seed ${seed}, decision ${decisions + 1}`).toBeNull();
        decisions += 1;
      }
      expect(game.isGameOver(), `seed ${seed} exceeded the decision limit`).toBe(true);
      const result = game.getResult();
      expect(result, `seed ${seed} has no result`).not.toBeNull();
      finalTurns.set(seed, result!.turn);
    }
  }, 30_000);

  afterAll(() => {
    expect(finalTurns.size).toBe(30);
    const turnsBySeed = Array.from({ length: 30 }, (_, index) => finalTurns.get(index + 1)!);
    expect(turnsBySeed.every(Number.isFinite)).toBe(true);
    const orderedTurns = [...turnsBySeed].sort((left, right) => left - right);
    expect(Math.min(...orderedTurns), 'facility-contact denial regressed to an early collapse').toBeGreaterThanOrEqual(10);
    expect(orderedTurns[14], 'median survival regressed below the contact-denial baseline').toBeGreaterThanOrEqual(20);
    expect(turnsBySeed[0], 'seed 1 regressed below the documented manual-play comparison').toBeGreaterThanOrEqual(20);
  });
});
