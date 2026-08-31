import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine, getCheckpointPositionCandidates } from './engine';
import { createUnit } from './state';
import type { GameAction, GameState } from './types';

function actionFor(candidate: ReturnType<typeof getCheckpointPositionCandidates>[number]): GameAction {
  return candidate.actionType === 'RelocateCheckpoint'
    ? {
        type: 'RelocateCheckpoint',
        checkpointId: candidate.checkpointId!,
        branchId: candidate.branchId,
        position: { ...candidate.position },
      }
    : { type: 'BuildCheckpoint', branchId: candidate.branchId, position: { ...candidate.position } };
}

describe('checkpoint position candidates', () => {
  it('returns every branch road tile in a stable order and agrees with legal actions', () => {
    const engine = new GameEngine(41, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const state = engine.getState();
    const first = getCheckpointPositionCandidates(state);
    const second = engine.getCheckpointPositionCandidates();
    expect(second).toEqual(first);
    expect(first).toHaveLength(state.map.roadBranches.reduce((total, branch) => total + branch.roadTiles.length, 0));
    expect(first.map((candidate) => candidate.branchId)).toEqual(
      [...state.map.roadBranches]
        .sort((left, right) => left.id.localeCompare(right.id))
        .flatMap((branch) => branch.roadTiles.map(() => branch.id)),
    );

    const legalKeys = new Set(engine.getLegalActions().map((action) => JSON.stringify(action)));
    for (const candidate of first) {
      expect(legalKeys.has(JSON.stringify(actionFor(candidate)))).toBe(candidate.legal);
      if (candidate.legal) expect(candidate.reasonCode).toBeNull();
      else expect(candidate.reasonCode).not.toBeNull();
    }
  });

  it('returns the same concrete Core reason as execution and preserves state on failure', () => {
    const engine = new GameEngine(42, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const illegal = engine.getCheckpointPositionCandidates().find((candidate) => !candidate.legal)!;
    expect(illegal).toBeDefined();
    const before = engine.getState();
    const result = engine.step(actionFor(illegal));
    expect(result.error?.code).toBe(illegal.reasonCode);
    expect(engine.getState()).toEqual(before);
  });

  it('does not change candidates or expose identity when the only blocker is hidden', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0 },
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      vision: { ownedFacility: 0, operationalCheckpoint: 0 },
    });
    const engine = new GameEngine(43, config);
    const baseline = engine.getCheckpointPositionCandidates();
    const snapshot = engine.getState() as GameState;
    snapshot.units.push(createUnit(snapshot, 'hidden-candidate-zombie', 'zombie', { q: 7, r: 0 }));
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const withHidden = engine.getCheckpointPositionCandidates();
    expect(withHidden).toEqual(baseline);
    expect(JSON.stringify(withHidden)).not.toContain('hidden-candidate-zombie');
  });

  it('offers distinct rear build and relocation candidates for the active checkpoint', () => {
    const engine = new GameEngine(44, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const build = engine.getCheckpointPositionCandidates().find(
      (candidate) => candidate.branchId === 'north' && candidate.legal,
    )!;
    expect(engine.step(actionFor(build)).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const active = engine.getState().checkpoints.find((checkpoint) => checkpoint.status === 'operational')!;
    const north = engine.getCheckpointPositionCandidates().filter((candidate) => candidate.branchId === 'north');
    expect(north.some((candidate) => candidate.actionType === 'BuildCheckpoint')).toBe(true);
    const relocations = north.filter((candidate) => candidate.actionType === 'RelocateCheckpoint');
    expect(relocations.length).toBeGreaterThan(0);
    expect(relocations.every((candidate) => candidate.checkpointId === active.id)).toBe(true);
  });
});
