import { describe, expect, it } from 'vitest';
import { createSessionReleaseFixtureFactory } from './session-release-fixture';

describe('Session release fixture', () => {
  it('uses a valid 51x51 Core state with 21 human units and legal actions', () => {
    const runtime = createSessionReleaseFixtureFactory('session-release-fixture-test').createNew({ seed: 1, agentId: 'fixture-test' });
    const observation = runtime.getObservation();
    expect(observation.map).toMatchObject({ id: 'fixed-51x51-v1', width: 51, height: 51 });
    expect(observation.units).toHaveLength(21);
    const legal = runtime.getLegalActions();
    const move = legal.find((action) => action.type === 'Move');
    expect(move).toBeDefined();
    expect(runtime.step({ action: move!, decisionSummary: 'validate a Core move' }).error).toBeNull();
  });
});