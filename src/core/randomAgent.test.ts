import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { replayRandomFailure, runRandomTestGame, runRandomTestGames } from './randomAgent';

describe('Random Test Agent', () => {
  it('uses only public legal actions and completes multiple deterministic games', () => {
    const config = createDefaultConfig({ maxTurns: 4, maxActionsPerTurn: 8 });
    const failures = runRandomTestGames([1, 2, 3, 4, 5], config);
    expect(failures).toEqual([]);
  });

  it('reproduces the same action sequence for the same seed', () => {
    const config = createDefaultConfig({ maxTurns: 3, maxActionsPerTurn: 6 });
    const first = runRandomTestGame(91, config);
    const second = runRandomTestGame(91, config);
    expect(first.actions).toEqual(second.actions);
    expect(first.failure).toEqual(second.failure);
    if (first.failure) {
      expect(replayRandomFailure(first.failure)).toEqual(first.failure.stateBeforeFailure);
    }
  });
});
