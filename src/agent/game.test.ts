import { describe, expect, it } from 'vitest';
import { createAgentGame } from './game';

describe('AgentGame public boundary', () => {
  it('returns a deterministic JSON observation without private random state', () => {
    const game = createAgentGame();
    const first = game.reset({ seed: 42, agent: { id: 'boundary-test' } });
    const second = game.reset({ seed: 42, agent: { id: 'boundary-test' } });
    expect(second).toEqual(first);
    const encoded = JSON.stringify(first);
    expect(JSON.parse(encoded)).toEqual(first);
    expect(encoded).not.toContain('rngState');
    expect(encoded).not.toContain('spawnedCount');
    expect(first.map.tiles).toHaveLength(225);
  });

  it('does not share returned references with the private engine state', () => {
    const game = createAgentGame();
    const observation = game.reset({ seed: 3 });
    observation.resources.food = -999;
    observation.facilities[0]!.healthyPopulation = -999;
    const fresh = game.getObservation();
    expect(fresh.resources.food).toBeGreaterThanOrEqual(0);
    expect(fresh.facilities[0]!.healthyPopulation).toBeGreaterThanOrEqual(0);
  });

  it('rejects illegal actions and invalid reset input without changing the session', () => {
    const game = createAgentGame();
    const before = game.reset({ seed: 9, agent: { id: 'safe-agent' } });
    const rejected = game.step({ type: 'Wait', unitId: 'does-not-exist' });
    expect(rejected.error?.code).toBe('action_not_legal');
    expect(rejected.observation).toEqual(before);
    expect(game.getRunArtifact().acceptedActions).toHaveLength(0);
    expect(game.getRunArtifact().invalidAttempts).toHaveLength(1);
    expect(() => game.reset({ seed: 10, configOverrides: { unknown: 1 } as never })).toThrow(/Unknown field/);
    expect(game.getObservation()).toEqual(before);
  });

  it('returns only engine-legal actions and never exposes GameState in step results', () => {
    const game = createAgentGame();
    game.reset({ seed: 11 });
    const actions = game.getLegalActions();
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions.slice(0, 20)) {
      const isolated = createAgentGame();
      isolated.reset({ seed: 11 });
      const result = isolated.step(action);
      expect(result.error).toBeNull();
      expect(result).not.toHaveProperty('state');
      expect(result.observation).not.toHaveProperty('rngState');
    }
  });
});

