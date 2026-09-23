import { describe, expect, it } from 'vitest';
import { createSessionReleaseFixtureFactory } from './session-release-fixture';

describe('Session release fixture', () => {
  it('uses a valid 51x51 Core state with 21 human units and legal actions', () => {
    const runtime = createSessionReleaseFixtureFactory('session-release-fixture-test').createNew({ seed: 1, agentId: 'fixture-test' });
    const observation = runtime.getObservation();
    expect(observation.map).toMatchObject({ id: 'fixed-51x51-v9', width: 51, height: 51 });
    expect(observation.units).toHaveLength(21);
    const legal = runtime.getLegalActions();
    const move = legal.find((action) => action.type === 'Move');
    expect(move).toBeDefined();
    expect(runtime.step({ action: move!, decisionSummary: 'validate a Core move' }).error).toBeNull();
  });

  it('remains a quiet legal EndTurn fixture after neutral survivor expiry', () => {
    const factory = createSessionReleaseFixtureFactory('session-release-fixture-test');
    const runtime = factory.createNew({ seed: 1511, agentId: 'fixture-test' });
    const decisionsPastNeutralSurvivorExpiry = 12;
    for (let decision = 1; decision <= decisionsPastNeutralSurvivorExpiry; decision += 1) {
      const endTurn = runtime.getLegalActions().find((action) => action.type === 'EndTurn');
      expect(endTurn, `decision ${decision}`).toBeDefined();
      expect(runtime.step({ action: endTurn!, decisionSummary: `quiet EndTurn ${decision}` }).error).toBeNull();
      expect(runtime.isGameOver(), `decision ${decision}`).toBe(false);
    }
    const restored = factory.restore({
      privateState: runtime.exportPrivateState(),
      seed: 1511,
      agentId: 'fixture-test',
      sessionId: 'restored-fixture-test',
      decision: decisionsPastNeutralSurvivorExpiry,
      traceHeadHash: '0'.repeat(64),
    });
    expect(restored.getObservation()).toEqual(runtime.getObservation());
    expect(restored.getLegalActions()).toEqual(runtime.getLegalActions());
  });
});
