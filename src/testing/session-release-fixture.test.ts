import { describe, expect, it } from 'vitest';
import { createSessionReleaseFixtureFactory } from './session-release-fixture';
import type { GameState } from '../core/types';

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

  it('remains quiet past survivor and facility objective deadlines, including after restore', () => {
    const factory = createSessionReleaseFixtureFactory('session-release-fixture-test');
    const runtime = factory.createNew({ seed: 1511, agentId: 'fixture-test' });
    // The release job used to lose its capital after 26 EndTurns: the new
    // Turn 11 objective Packs escaped this fixture's quiet-window setup.
    const decisions = 30;
    for (let decision = 1; decision <= decisions; decision += 1) {
      const endTurn = runtime.getLegalActions().find((action) => action.type === 'EndTurn');
      expect(endTurn, `decision ${decision}`).toBeDefined();
      expect(runtime.step({ action: endTurn!, decisionSummary: `quiet EndTurn ${decision}` }).error).toBeNull();
      expect(runtime.isGameOver(), `decision ${decision}`).toBe(false);
    }
    const state = runtime.exportPrivateState() as unknown as GameState;
    expect(state.units.filter(unit => !unit.isPlayerUnit)).toEqual([]);
    expect(state.statistics.packZombiesSpawned).toBe(0);
    expect(state.airBaseObjective.failureSpawn).toBe('none');
    expect(state.nuclearObjective.failureSpawn).toBe('none');
    const restored = factory.restore({
      privateState: runtime.exportPrivateState(),
      seed: 1511,
      agentId: 'fixture-test',
      sessionId: 'restored-fixture-test',
      decision: decisions,
      traceHeadHash: '0'.repeat(64),
    });
    expect(restored.getObservation()).toEqual(runtime.getObservation());
    expect(restored.getLegalActions()).toEqual(runtime.getLegalActions());
    const endTurn = restored.getLegalActions().find(action => action.type === 'EndTurn');
    expect(endTurn).toBeDefined();
    expect(restored.step({ action: endTurn!, decisionSummary: 'resume quiet fixture' }).error).toBeNull();
    expect(restored.isGameOver()).toBe(false);
    expect((restored.exportPrivateState() as unknown as GameState).statistics.packZombiesSpawned).toBe(0);
  }, 60_000); // Thirty-one real 51x51 Core turns exceed the default 20s budget.
});
