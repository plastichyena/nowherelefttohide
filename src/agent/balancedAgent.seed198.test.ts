import { describe, expect, it } from 'vitest';
import { BalancedAgent } from './balancedAgent';
import { createAgentGame } from './game';

describe('Balanced Agent checkpoint infection regression', () => {
  it('cleans checkpoint-queue infection in seed 198 before turn 100', async () => {
    const game = createAgentGame();
    let observation = game.reset({ seed: 198, agent: { id: 'balanced' } });
    const agent = new BalancedAgent();
    let decisions = 0;
    while (!game.isGameOver() && observation.turn <= 100 && decisions < 5_000) {
      const result = game.step(agent.decide(observation, game.getLegalActions()).action);
      expect(result.error, `seed 198, decision ${decisions + 1}`).toBeNull();
      observation = result.observation;
      decisions += 1;
      if (decisions % 5 === 0) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    }
    expect(game.isGameOver(), `seed 198 reached turn ${observation.turn} with ${observation.population.infected} infected`).toBe(true);
    expect(game.getResult()?.turn).toBeLessThanOrEqual(100);
  }, 300_000);
});
