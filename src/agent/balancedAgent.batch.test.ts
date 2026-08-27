import { describe, expect, it } from 'vitest';
import { BalancedAgent } from './balancedAgent';
import { createAgentGame } from './game';

describe('Balanced Agent 100-seed smoke', () => {
  it('completes standard-config seeds 1 through 100 without technical failure', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
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
      expect(game.getResult(), `seed ${seed} has no result`).not.toBeNull();
    }
  }, 60_000);
});

