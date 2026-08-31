import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import {
  GameEngine,
  getCheckpointPositionCandidates,
  getConstructibleFacilityPositionCandidates,
} from './engine';
import { hexKey } from './hex';
import { createUnit } from './state';
import { getPlayerVisibleTileKeys } from './visibility';
import type { GameAction, GameState } from './types';

function cloneState(state: Readonly<GameState>): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

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

describe('v1.4 position candidates', () => {
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
  }, 30_000);

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
    const snapshot = cloneState(engine.getState());
    snapshot.units.push(createUnit(snapshot, 'hidden-candidate-zombie', 'zombie', { q: 15, r: 0 }));
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

  it('returns all Constructible Facility candidates in stable coordinate order', () => {
    const engine = new GameEngine(45, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const candidates = getConstructibleFacilityPositionCandidates(engine.getState(), 'simpleFarm');
    expect(candidates).toHaveLength(31 * 31);
    expect(candidates.map((candidate) => `${candidate.position.q},${candidate.position.r}`)).toEqual(
      [...candidates]
        .sort((left, right) => left.position.q - right.position.q || left.position.r - right.position.r)
        .map((candidate) => `${candidate.position.q},${candidate.position.r}`),
    );
    expect(candidates.some((candidate) => candidate.legal)).toBe(true);
    expect(candidates.filter((candidate) => candidate.legal).every((candidate) => candidate.reasonCode === null)).toBe(true);
    expect(candidates.filter((candidate) => !candidate.legal).every((candidate) => candidate.reasonCode !== null)).toBe(true);
  });

  it('does not expose a hidden Zombie in Constructible candidates and accepts hidden co-location', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0 },
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      vision: { ownedFacility: 0, operationalCheckpoint: 0 },
    });
    const engine = new GameEngine(46, config);
    expect(engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 15, r: 9 } }).error).toBeNull();
    const baseline = engine.getConstructibleFacilityPositionCandidates('simpleFarm');
    const visible = getPlayerVisibleTileKeys(engine.getState());
    const legal = baseline.find((candidate) => candidate.legal && !visible.has(hexKey(candidate.position)))!;
    expect(legal).toBeDefined();
    const hidden = createUnit(engine.getState(), 'hidden-build-zombie', 'zombie', legal.position);
    const snapshot = cloneState(engine.getState());
    snapshot.units.push(hidden);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const withHidden = engine.getConstructibleFacilityPositionCandidates('simpleFarm');
    expect(withHidden).toEqual(baseline);
    expect(JSON.stringify(withHidden)).not.toContain(hidden.id);
    expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position: legal.position }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.constructible)?.position).toEqual(legal.position);
  });
});
