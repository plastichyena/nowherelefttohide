import { afterAll, describe, expect, it } from 'vitest';
import { BalancedAgent } from './balancedAgent';
import { createAgentGame } from './game';

describe('Balanced Agent 30-seed regression', () => {
  const finalTurns = new Map<number, number>();
  // Keep each CI case comfortably below the per-test timeout while preserving
  // the same deterministic 30-seed coverage.
  const seedBatches = Array.from({ length: 6 }, (_, index) => ({ start: index * 5 + 1, end: index * 5 + 5 }));

  it.each(seedBatches)('completes standard-config seeds $start through $end without technical failure', async ({ start, end }) => {
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
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    }
  }, 60_000);

  afterAll(() => {
    expect(finalTurns.size).toBe(30);
    const turnsBySeed = Array.from({ length: 30 }, (_, index) => finalTurns.get(index + 1)!);
    expect(turnsBySeed.every(Number.isFinite)).toBe(true);
    expect(turnsBySeed.every((turn) => Number.isInteger(turn) && turn > 0)).toBe(true);
  });
});
