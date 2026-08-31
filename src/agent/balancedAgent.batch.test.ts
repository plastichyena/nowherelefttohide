import { afterAll, describe, expect, it } from 'vitest';
import { BalancedAgent } from './balancedAgent';
import { createAgentGame } from './game';
import { RandomAgent } from './randomAgent';

describe('Agent seed regression', () => {
  const finalTurns = new Map<number, number>();
  const strategy = process.env.AGENT_STRATEGY ?? 'balanced';
  const firstSeed = Number.parseInt(process.env.BALANCED_SEED_START ?? '1', 10);
  const lastSeed = Number.parseInt(process.env.BALANCED_SEED_END ?? '30', 10);
  const batchTimeoutMs = Number.parseInt(process.env.BALANCED_BATCH_TIMEOUT_MS ?? '120000', 10);
  if (
    !['balanced', 'random'].includes(strategy) ||
    !Number.isSafeInteger(firstSeed) ||
    !Number.isSafeInteger(lastSeed) ||
    lastSeed < firstSeed ||
    !Number.isSafeInteger(batchTimeoutMs) ||
    batchTimeoutMs < 1
  ) {
    throw new Error('Agent strategy, seed range, and timeout environment variables must be valid');
  }
  // Keep each CI case comfortably below the per-test timeout while preserving
  // the default deterministic 30-seed coverage. Release validation can split
  // the required 1..300 range across independent Vitest processes.
  const seedBatches = Array.from({ length: Math.ceil((lastSeed - firstSeed + 1) / 5) }, (_, index) => ({
    start: firstSeed + index * 5,
    end: Math.min(lastSeed, firstSeed + index * 5 + 4),
  }));

  it.each(seedBatches)('completes standard-config seeds $start through $end without technical failure', async ({ start, end }) => {
    for (let seed = start; seed <= end; seed += 1) {
      const game = createAgentGame();
      game.reset({ seed, agent: { id: strategy } });
      const agent = strategy === 'random' ? new RandomAgent(seed) : new BalancedAgent();
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
  }, batchTimeoutMs);

  afterAll(() => {
    expect(finalTurns.size).toBe(lastSeed - firstSeed + 1);
    const turnsBySeed = Array.from({ length: lastSeed - firstSeed + 1 }, (_, index) => finalTurns.get(firstSeed + index)!);
    expect(turnsBySeed.every(Number.isFinite)).toBe(true);
    expect(turnsBySeed.every((turn) => Number.isInteger(turn) && turn > 0)).toBe(true);
  });
});
